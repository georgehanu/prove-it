// Shared helpers for the Prove It hooks. Zero dependencies, Node 22+.
// Every hook goes through runHook(), which never throws: on any internal error the hook
// exits 0 with no output (fail open) and appends the error to <state dir>/errors.log.

import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const RULES = `Prove It rules (re-read after compaction):
1. Done means proven. Before you say a change is done, run the project's checks and end with a "## Proof" block: each requirement -> the command, its exit code and the output line that proves it. List what you did not verify under "Not verified:".
2. Tests must be able to fail. Never delete, skip or loosen a test, or change an expected value, to make it pass. If a test is wrong, say why and ask.
3. Find the cause before the fix. Reproduce, prove the cause, change one thing at a time. After 3 failed attempts, stop and report.
4. No hidden shortcuts. No empty catch, no type or lint suppressions, no test-only branches, no hardcoded results. If one is really needed, say why in your summary.
5. Hand over a diff someone can review. Keep it small, flag unrelated changes, and say which lines to read first.`;

// ---------- input, output, state ----------

export const isCodex = () => process.argv.includes("--codex");

export function stateDir() {
  const base = process.env.CLAUDE_PLUGIN_DATA || join(tmpdir(), "prove-it");
  return join(base, "sessions");
}

const safeId = (id) => String(id || "default").replace(/[^\w.-]/g, "_").slice(0, 120);

// The key for this session's state files. Without a session_id, a key derived from the transcript path
// (or else the project folder) keeps unrelated sessions from sharing one "default" log.
export function sessionKey(input) {
  if (input.session_id) return String(input.session_id);
  const basis = input.transcript_path ? `transcript:${input.transcript_path}` : `cwd:${input.cwd || process.cwd()}`;
  return `nosession-${createHash("sha256").update(basis).digest("hex").slice(0, 16)}`;
}

const DAY = 24 * 60 * 60 * 1000;

// Deletes session files untouched for 7 days. Cheap: it runs at most once a day (a stamp file's mtime
// says when it last ran), so most hook calls cost one stat.
export function pruneSessions(dir = stateDir(), now = Date.now(), maxAge = 7 * DAY) {
  if (!existsSync(dir)) return 0;
  const stamp = join(dir, ".last-prune");
  try {
    if (now - statSync(stamp).mtimeMs < DAY) return 0;
  } catch {
    // no stamp yet: prune now
  }
  writeFileSync(stamp, "");
  utimesSync(stamp, now / 1000, now / 1000);
  let removed = 0;
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const file = join(dir, name);
    try {
      const st = statSync(file);
      if (st.isFile() && now - st.mtimeMs > maxAge) {
        unlinkSync(file);
        removed++;
      }
    } catch {
      // gone already, or in use: leave it
    }
  }
  return removed;
}

export function sessionFile(sessionId, suffix) {
  return join(stateDir(), `${safeId(sessionId)}.${suffix}`);
}

export function appendEvent(sessionId, event) {
  const file = sessionFile(sessionId, "events.jsonl");
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify({ ...event, at: Date.now() }) + "\n");
}

export function readEvents(sessionId) {
  const file = sessionFile(sessionId, "events.jsonl");
  if (!existsSync(file)) return [];
  const events = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // a torn line from a crash: skip it
    }
  }
  return events;
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}

export function logError(hook, err) {
  try {
    const dir = dirname(stateDir());
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "errors.log"), `${new Date().toISOString()} ${hook}: ${err && err.stack ? err.stack : err}\n`);
  } catch {
    // nowhere left to report; stay silent
  }
}

// Runs a hook: parse stdin, load config, call handler(input, ctx), print its JSON result.
export function runHook(name, handler) {
  try {
    const raw = readFileSync(0, "utf8");
    const input = raw.trim() ? JSON.parse(raw) : {};
    const cwd = input.cwd || process.cwd();
    const config = loadConfig(cwd);
    if (config.disable.includes(name) || config.disable.includes("all")) return;
    const result = handler(input, { cwd, config, session: sessionKey(input), codex: isCodex() });
    if (result) process.stdout.write(JSON.stringify(result));
  } catch (err) {
    logError(name, err);
  }
  try {
    pruneSessions();
  } catch (err) {
    logError(name, err);
  }
}

// ---------- config ----------

export const DEFAULTS = {
  checks: null, // regex strings; when set they replace the built-in check detection
  testGlobs: [
    "**/*.test.*",
    "**/*.spec.*",
    "**/*_test.*",
    "**/test_*.py",
    "**/__tests__/**",
    "**/test/**",
    "**/tests/**",
    "**/spec/**",
    "**/*Test.java",
    "**/*Tests.cs",
  ],
  codeGlobs: null, // when set, replaces the built-in list of code extensions
  ignoreGlobs: [
    "**/node_modules/**",
    "**/.git/**",
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/vendor/**",
    "**/.prove-it/**",
    "**/*.min.js",
  ],
  diffBudget: 400,
  testGuard: "ask", // "ask" (a person decides) or "deny"
  requireProof: true, // the Stop hook asks for a "## Proof" block once checks have passed
  disable: [],
};

export function findConfig(cwd) {
  let dir = cwd;
  for (let i = 0; i < 40 && dir; i++) {
    const file = join(dir, ".prove-it.json");
    if (existsSync(file)) return file;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function loadConfig(cwd) {
  const file = findConfig(cwd);
  let user = {};
  if (file) {
    try {
      user = JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
      logError("config", `${file}: ${err.message}`);
    }
  }
  const config = { ...DEFAULTS, ...user };
  config.disable = Array.isArray(config.disable) ? config.disable : [];
  if (!Array.isArray(config.testGlobs)) config.testGlobs = DEFAULTS.testGlobs;
  if (!Array.isArray(config.ignoreGlobs)) config.ignoreGlobs = DEFAULTS.ignoreGlobs;
  if (!(Number(config.diffBudget) > 0)) config.diffBudget = DEFAULTS.diffBudget;
  if (config.testGuard !== "deny") config.testGuard = "ask";
  config.requireProof = config.requireProof !== false;
  return config;
}

// ---------- paths and globs ----------

export const toPosix = (p) => String(p ?? "").replace(/\\/g, "/");

// Project-relative, forward-slash path. Works for Windows paths on any OS.
export function relPath(file, cwd) {
  const f = toPosix(file);
  const c = toPosix(cwd).replace(/\/+$/, "");
  if (!/^([a-zA-Z]:)?\//.test(f)) return f.replace(/^\.\//, "");
  const insensitive = /^[a-zA-Z]:/.test(f);
  const fk = insensitive ? f.toLowerCase() : f;
  const ck = insensitive ? c.toLowerCase() : c;
  if (ck && fk.startsWith(ck + "/")) return f.slice(c.length + 1);
  return f;
}

export function globToRegExp(glob) {
  let re = "";
  let depth = 0;
  const g = toPosix(glob);
  for (let i = 0; i < g.length; i++) {
    const ch = g[i];
    if (ch === "*") {
      if (g[i + 1] === "*") {
        const slashAfter = g[i + 2] === "/";
        re += slashAfter ? "(?:.*/)?" : ".*";
        i += slashAfter ? 2 : 1;
      } else re += "[^/]*";
    } else if (ch === "?") re += "[^/]";
    else if (ch === "{") (depth++, (re += "(?:"));
    else if (ch === "}" && depth) (depth--, (re += ")"));
    else if (ch === "," && depth) re += "|";
    else re += ch.replace(/[.+^$()|[\]{}\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i");
}

// A glob without a slash matches the file name anywhere, like .gitignore.
export function matchesAny(rel, globs) {
  const path = toPosix(rel);
  const base = path.split("/").pop();
  return globs.some((glob) => globToRegExp(glob).test(toPosix(glob).includes("/") ? path : base));
}

const CODE_EXT = new Set(
  "js mjs cjs jsx ts tsx mts cts vue svelte astro py go rs java kt kts scala rb php cs fs swift m mm c h cc cpp hpp dart ex exs erl lua".split(" "),
);

function hasCodeExtension(path) {
  const base = path.split("/").pop();
  if (/\.d\.ts$/i.test(base)) return false;
  const ext = base.includes(".") ? base.split(".").pop().toLowerCase() : "";
  return CODE_EXT.has(ext);
}

export function isCodeFile(rel, config) {
  const path = toPosix(rel);
  if (matchesAny(path, config.ignoreGlobs)) return false;
  if (config.codeGlobs) return matchesAny(path, config.codeGlobs);
  return hasCodeExtension(path);
}

// A test file matches testGlobs and is code: a built-in code extension, or a match for codeGlobs.
// codeGlobs only widens this. Setting "codeGlobs": ["src/**"] must not leave test/ unguarded.
export function isTestFile(rel, config) {
  const path = toPosix(rel);
  if (matchesAny(path, config.ignoreGlobs) || !matchesAny(path, config.testGlobs)) return false;
  return hasCodeExtension(path) || Boolean(config.codeGlobs && matchesAny(path, config.codeGlobs));
}

// ---------- edits: which files, old and new text ----------

// Parses a Codex apply_patch body into per-file changes.
export function parseApplyPatch(text) {
  const files = [];
  let cur = null;
  for (const line of String(text || "").replace(/\r\n/g, "\n").split("\n")) {
    const m = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/);
    if (m) {
      cur = { op: m[1].toLowerCase(), path: m[2].trim(), removed: [], added: [], oldText: [], newText: [] };
      files.push(cur);
      continue;
    }
    const mv = line.match(/^\*\*\* Move to: (.+)$/);
    if (mv && cur) {
      cur.moveTo = mv[1].trim();
      continue;
    }
    if (!cur || line.startsWith("***") || line.startsWith("@@")) continue;
    if (line.startsWith("+")) {
      cur.added.push(line.slice(1));
      cur.newText.push(line.slice(1));
    } else if (line.startsWith("-")) {
      cur.removed.push(line.slice(1));
      cur.oldText.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      cur.oldText.push(line.slice(1));
      cur.newText.push(line.slice(1));
    }
  }
  return files.map((f) => ({ ...f, oldText: f.oldText.join("\n"), newText: f.newText.join("\n") }));
}

const patchText = (ti) => {
  const patch = typeof ti === "string" ? ti : ti.command ?? ti.patch ?? ti.input ?? "";
  return Array.isArray(patch) ? patch.join("\n") : patch;
};

// The files an edit tool call touches, without reading any of them.
export function editedPaths(input) {
  const tool = input.tool_name;
  const ti = input.tool_input || {};
  if (["Write", "Edit", "MultiEdit"].includes(tool)) return ti.file_path ? [ti.file_path] : [];
  if (tool === "apply_patch") return parseApplyPatch(patchText(ti)).map((f) => f.path);
  return [];
}

// Normalises Write / Edit / MultiEdit / apply_patch into [{ file, oldText, newText, kind }].
// oldText for Write is read from disk (PreToolUse) or taken from tool_response.originalFile.
// keep(file) filters the files first, so nothing is read for a file the caller doesn't care about.
export function editsFromInput(input, keep = () => true) {
  const tool = input.tool_name;
  const ti = input.tool_input || {};
  if (["Write", "Edit", "MultiEdit"].includes(tool) && !keep(ti.file_path)) return [];
  if (tool === "Write") {
    let oldText = input.tool_response?.originalFile;
    if (oldText === undefined) oldText = readIfExists(ti.file_path);
    return [{ file: ti.file_path, oldText: oldText ?? null, newText: ti.content ?? "", kind: "write" }];
  }
  if (tool === "Edit") {
    return [{ file: ti.file_path, oldText: ti.old_string ?? "", newText: ti.new_string ?? "", kind: "edit" }];
  }
  if (tool === "MultiEdit") {
    return (ti.edits || []).map((e) => ({ file: ti.file_path, oldText: e.old_string ?? "", newText: e.new_string ?? "", kind: "edit" }));
  }
  if (tool === "apply_patch") {
    return parseApplyPatch(patchText(ti)).filter((f) => keep(f.path)).map((f) => ({
      file: f.path,
      oldText: f.op === "add" ? null : f.op === "delete" ? readIfExists(f.path, input.cwd) ?? f.oldText : f.oldText,
      newText: f.op === "delete" ? "" : f.newText,
      kind: f.op === "add" ? "write" : f.op === "delete" ? "delete" : "edit",
      patchAdded: f.added,
    }));
  }
  return [];
}

export function readIfExists(file, cwd) {
  if (!file) return null;
  try {
    const abs = /^([a-zA-Z]:)?[\\/]/.test(file) || !cwd ? file : join(cwd, file);
    return existsSync(abs) ? readFileSync(abs, "utf8") : null;
  } catch {
    return null;
  }
}

// The command line of a shell tool call. An argv array such as ["bash", "-lc", "npm test"] is reduced
// to the script it runs, so joining it does not glue "bash -lc" in front of the real command.
export function shellCommandOf(toolInput) {
  const ti = toolInput || {};
  const cmd = typeof ti === "string" ? ti : ti.command ?? "";
  if (!Array.isArray(cmd)) return String(cmd);
  const flag = cmd[cmd.length - 2];
  return cmd.length >= 3 && /^(?:-\w*c|-command|\/c)$/i.test(String(flag)) ? String(cmd[cmd.length - 1]) : cmd.join(" ");
}

export const isEditTool = (tool) => ["Write", "Edit", "MultiEdit", "apply_patch"].includes(tool);
export const isShellTool = (tool) => ["Bash", "PowerShell", "shell", "exec_command"].includes(tool);

// ---------- line diff ----------

const splitLines = (text) => (text == null || text === "" ? [] : String(text).replace(/\r\n/g, "\n").split("\n"));

// Returns [{ op: " " | "-" | "+", text, oldNo, newNo }] using an LCS over lines.
export function lineDiff(oldText, newText) {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const ops = [];
  for (let i = 0; i < start; i++) ops.push({ op: " ", text: a[i], oldNo: i + 1, newNo: i + 1 });

  const n = midA.length;
  const m = midB.length;
  if (n * m > 4_000_000) {
    midA.forEach((text, i) => ops.push({ op: "-", text, oldNo: start + i + 1 }));
    midB.forEach((text, j) => ops.push({ op: "+", text, newNo: start + j + 1 }));
  } else {
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        ops.push({ op: " ", text: midA[i], oldNo: start + i + 1, newNo: start + j + 1 });
        i++;
        j++;
      } else if (i < n && (j >= m || dp[i + 1][j] >= dp[i][j + 1])) {
        ops.push({ op: "-", text: midA[i], oldNo: start + i + 1 });
        i++;
      } else {
        ops.push({ op: "+", text: midB[j], newNo: start + j + 1 });
        j++;
      }
    }
  }
  for (let k = 0; k < a.length - endA; k++)
    ops.push({ op: " ", text: a[endA + k], oldNo: endA + k + 1, newNo: endB + k + 1 });
  return ops;
}

// Groups changed lines into hunks: [{ removed: [ops], added: [ops] }].
export function hunks(ops) {
  const out = [];
  let cur = null;
  for (const o of ops) {
    if (o.op === " ") {
      cur = null;
      continue;
    }
    if (!cur) out.push((cur = { removed: [], added: [] }));
    (o.op === "-" ? cur.removed : cur.added).push(o);
  }
  return out;
}

// ---------- shell commands ----------

// Heredoc bodies (<<'EOF' ... EOF) and PowerShell here-strings (@' ... '@) are content, not commands:
// drop them so a "=>" or "npm test" inside a file body is not read as a redirect or a check.
export function stripHeredocs(command) {
  const lines = String(command || "").replace(/\r\n/g, "\n").replace(/@(['"])\n[\s\S]*?\n\1@/g, "''").split("\n");
  const out = [];
  let until = null;
  for (const line of lines) {
    if (until !== null) {
      if (line.replace(/^\t+/, "").trim() === until) until = null;
      continue;
    }
    out.push(line);
    const m = line.match(/(?<![<\d])<<(?!<)-?\s*(['"]?)([A-Za-z_][\w.-]*)\1/);
    if (m) until = m[2];
  }
  return out.join("\n");
}

// Walks a command line and calls visit(ch, i, where) for every character. where is "quote" for a quote
// mark, "in" inside quotes and null outside. visit may return "skip" to skip the next character.
function walkQuotes(text, visit) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (quote === '"' && ch === "\\" && text[i + 1] === '"') {
        visit(ch, i, "in");
        visit(text[i + 1], ++i, "in");
      } else if (ch === quote) {
        quote = null;
        visit(ch, i, "quote");
      } else visit(ch, i, "in");
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      visit(ch, i, "quote");
      continue;
    }
    if (visit(ch, i, null) === "skip") i++;
  }
}

// Splits a command line into simple commands at &&, ||, ;, |, &, newlines and ( ), outside quotes.
// "2>&1" and "&>" are redirects, not separators.
export function splitShell(command) {
  const s = String(command ?? "");
  const out = [];
  let cur = "";
  const push = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = "";
  };
  walkQuotes(s, (ch, i, where) => {
    if (where) {
      cur += ch;
      return;
    }
    if (ch === "\\" && /[;&|()\n]/.test(s[i + 1] ?? "")) {
      cur += ch + s[i + 1]; // an escaped separator (find -exec ... \;) or a line continuation
      return "skip";
    }
    if (ch === "&" && (/[<>]/.test(s[i - 1] ?? "") || s[i + 1] === ">")) {
      cur += ch;
      return;
    }
    if (";\n()|&".includes(ch)) {
      push();
      return (ch === "|" || ch === "&") && s[i + 1] === ch ? "skip" : undefined;
    }
    cur += ch;
  });
  push();
  return out;
}

// The same text with everything inside quotes replaced by "_", so positions still line up with the original.
export function maskQuotes(text) {
  let out = "";
  walkQuotes(String(text ?? ""), (ch, i, where) => {
    out += where === "in" ? "_" : ch;
  });
  return out;
}

// `bash -c "npm test"`: the quoted text is the command that runs.
const SHELL_C = /\b(?:bash|sh|zsh|dash|pwsh|powershell)(?:\.exe)?(?:\s+-\w+)*?\s+-(?:l?c|command)\s+(["'])((?:\\.|(?!\1)[^\\])*)\1/gi;
// The text after -m / --message / -e / --eval is a message or a script, not a command.
// `python -m pytest` is the exception: there -m names the module that runs.
const MESSAGE_ARG = /(?<!\b(?:python[\d.]*(?:\.exe)?|py)\s+)(?<!\S)(?:-m|--message|-e|--eval)(?:=|\s+)(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s;&|()]+)/g;
const QUOTED = /"(?:\\.|[^"\\])*"|'[^']*'/g;

// A command line with everything that is text rather than command taken out: heredoc bodies, the
// -m/-e arguments and quoted strings. `git commit -m "npm test"` becomes `git commit`.
export function stripCommand(command) {
  return stripHeredocs(command)
    .replace(SHELL_C, (m, q, body) => ` ; ${body} ; `)
    .replace(MESSAGE_ARG, " ")
    .replace(QUOTED, " ");
}

const OPTS = String.raw`(?:\s+-{1,2}[\w-]+(?:=\S+)?)*`;
// What can stand in front of the real command: env assignments, shell keywords, and runners.
const LEAD = new RegExp(
  String.raw`^(?:\w+=\S*|(?:env|time|command|exec|nohup|sudo|then|do|else|if|elif|while|until|!|\{)(?=\s)` +
    String.raw`|(?:npx|pnpx|bunx)${OPTS}|(?:npm|pnpm|yarn)\s+(?:exec|dlx)${OPTS}|(?:uv|poetry|pipenv|hatch|pdm|rye)\s+run${OPTS}` +
    String.raw`|bundle\s+exec|python[\d.]*(?:\.exe)?\s+-m|py\s+-m)\s+`,
);

// One simple command reduced to the tool and its arguments: `CI=1 npx vitest run` -> `vitest run`,
// `./node_modules/.bin/jest` -> `jest`, `.\gradlew.bat test` -> `gradlew test`.
function toolCall(segment) {
  let s = segment.trim();
  for (let prev = null; prev !== s; ) {
    prev = s;
    s = s.replace(LEAD, "").trim();
  }
  return s.replace(/^\S*[\\/](?=[^\s\\/])/, "").replace(/^(\S+?)\.(?:cmd|bat|exe|ps1)(?=\s|$)/i, "$1");
}

// The simple commands a command line runs, each reduced to its tool call.
export function commandParts(command) {
  return splitShell(stripCommand(command)).map(toolCall).filter(Boolean);
}

// ---------- check commands ----------

// Package-manager prefix: `npm`, `pnpm -r`, `npm --prefix demo`, `yarn workspace web`, then an optional `run`.
const PM = String.raw`(?:npm|pnpm|yarn|bun)(?:\s+-{1,2}[\w-]+(?:=\S+|\s+(?!-)\S+)?|\s+workspace\s+\S+)*\s+(?:run(?:-script)?\s+)?`;

// Each pattern must match at the start of a tool call (see commandParts), so `echo npm test`,
// `grep "npm test" README.md` and `ls src/tsc` are not checks.
export const BUILTIN_CHECKS = [
  PM + String.raw`(?:test|t|lint|typecheck|type-check|check|build|verify)(?::[\w:-]+)?(?![\w.])`,
  String.raw`node(?:\s+\S+)*?\s+--test(?![\w-])`,
  String.raw`deno\s+(?:test|check|lint)\b`,
  String.raw`(?:vitest|jest|mocha|ava|tap|tsc|vue-tsc|svelte-check|eslint|oxlint|biome\s+(?:check|lint|ci)|playwright\s+test|cypress\s+run|stylelint)(?![\w.-])`,
  String.raw`(?:pytest|py\.test|mypy|pyright|ruff\s+check|ruff\s+format\s+--check|flake8|pylint|black\s+--check|tox|nox|unittest)(?![\w.-])`,
  String.raw`python[\d.]*\s+manage\.py\s+test\b`,
  String.raw`go\s+(?:test|vet|build)\b`,
  String.raw`golangci-lint\b`,
  String.raw`cargo\s+(?:\+\S+\s+)?(?:test|check|clippy|build|nextest)\b`,
  String.raw`(?:mvnw?|gradlew?)(?:\s+\S+)*?\s+(?:\S*:)?(?:test|verify|check|build|package|install)(?![\w-])`,
  String.raw`dotnet\s+(?:test|build)\b`,
  String.raw`(?:rspec|phpunit|phpstan|pest|psalm)(?![\w.-])`,
  String.raw`(?:rake|rails)\s+(?:test|spec)\b`,
  String.raw`make(?:\s+-\S+)*\s+(?:test|check|lint|verify)\b`,
];

// Flags that make a check tool print something instead of checking anything.
const NOT_A_RUN = /(?:^|\s)(?:--help|-h|--version|--listTests|--list-tests|--collect-only|--co|--showConfig|--show-config|-list)(?=[\s=]|$)/;

const PLACEHOLDER_TEST = /no test specified/i;

export function readPackageJson(cwd) {
  return readJson(join(cwd, "package.json"), null);
}

function packageManager(cwd) {
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"))) return "bun";
  return "npm";
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The built-in patterns plus one per check-like package.json script (each anchored by isCheckCommand).
export function checkPatterns(cwd) {
  const patterns = [...BUILTIN_CHECKS];
  const scripts = readPackageJson(cwd)?.scripts || {};
  for (const name of Object.keys(scripts)) {
    if (/test|lint|check|build|verify|validate|tsc/i.test(name)) patterns.push(PM + `${escapeRe(name)}(?![\\w:.-])`);
  }
  return patterns;
}

const compile = (source, flags) => {
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
};

// Does this command line run a check? Built-in patterns only count when the tool is in command position.
// User "checks" regexes from .prove-it.json replace the built-in list. They are matched against the command
// with quoted text, heredoc bodies and -m/-e arguments removed, and against each simple command in it
// (so "^make verify" also matches `cd api && make verify`).
export function isCheckCommand(command, cwd, config) {
  const stripped = stripCommand(command);
  const parts = splitShell(stripped).map(toolCall).filter(Boolean);
  if (Array.isArray(config.checks) && config.checks.length) {
    const user = config.checks.map((p) => compile(p, "m")).filter(Boolean);
    return user.some((re) => re.test(stripped) || parts.some((part) => re.test(part)));
  }
  const builtin = checkPatterns(cwd).map((p) => compile(`^(?:${p})`)).filter(Boolean);
  return parts.some((part) => !NOT_A_RUN.test(part) && builtin.some((re) => re.test(part)));
}

const readText = (file) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
};

// Human-readable suggestions for the Stop message. Each one is itself a command isCheckCommand accepts.
export function suggestedChecks(cwd, config) {
  if (Array.isArray(config.checks) && config.checks.length)
    return config.checks.map((p) => `a command matching /${p}/`);
  const out = [];
  const has = (f) => existsSync(join(cwd, f));
  const scripts = readPackageJson(cwd)?.scripts || {};
  const pm = packageManager(cwd);
  for (const name of ["test", "lint", "typecheck", "type-check", "check", "build"]) {
    if (!scripts[name] || (name === "test" && PLACEHOLDER_TEST.test(scripts[name]))) continue;
    if (name === "test") out.push(`${pm} test`);
    else out.push(pm === "yarn" ? `yarn ${name}` : `${pm} run ${name}`);
  }
  if (["pyproject.toml", "pytest.ini", "setup.cfg", "tox.ini"].some(has)) out.push("pytest");
  if (has("go.mod")) out.push("go test ./...");
  if (has("Cargo.toml")) out.push("cargo test");
  if (has("deno.json") || has("deno.jsonc")) out.push("deno test");
  if (has("pom.xml")) out.push(has("mvnw") ? "./mvnw test" : "mvn test");
  if (has("build.gradle") || has("build.gradle.kts")) out.push(has("gradlew") ? "./gradlew test" : "gradle test");
  let names = [];
  try {
    names = readdirSync(cwd);
  } catch {
    // unreadable folder: no .NET suggestion
  }
  if (names.some((n) => /\.(?:csproj|fsproj|sln)$/i.test(n))) out.push("dotnet test");
  if (has(".rspec") || /\brspec\b/.test(readText(join(cwd, "Gemfile")))) out.push("bundle exec rspec");
  if (/\bphpunit\b/.test(readText(join(cwd, "composer.json")))) out.push("vendor/bin/phpunit");
  return out;
}

// A pipe such as `npm test | tail` reports the exit code of `tail`, not the tests.
// When the command could hide a failure, look for the usual failure lines in the output.
const FAILURE_MARKERS = [
  /^#\s*fail\s+[1-9]/m, // node --test (TAP)
  /^\s*not ok \d+/m, // any TAP producer
  /^\s*✖ /m, // node --test (spec reporter)
  /^\S*\s*fail\s+[1-9]\d*\s*$/m, // node --test (spec reporter: "ℹ fail 1")
  /\bTests?:\s+\d+\s+failed/i, // jest
  /\b[1-9]\d*\s+(?:failed|failing)\b/i, // vitest, mocha, pytest
  /^FAIL\b/m, // jest, vitest, go
  /^--- FAIL/m, // go
  /test result: FAILED/, // cargo
  /\berror TS\d+:/, // tsc
  /\b[1-9]\d* problems? \([1-9]\d* errors?/, // eslint
  /^npm ERR!|^npm error\b/m,
];

// force: the exit code is unknown (Codex sends shell output as plain text), so always read the output.
export function outputShowsFailure(command, output, force = false) {
  // a pipe, "|| anything" or ";" can each end the command with someone else's exit code
  // (only real ones: a "|" inside quotes or a commit message is text)
  const canHide = force || /[|;]/.test(stripCommand(command));
  if (!canHide) return false;
  const text = String(output || "");
  return FAILURE_MARKERS.some((re) => re.test(text));
}

// Exit status from a tool_response we do not know the exact shape of (Codex, future versions).
export function exitCodeFrom(response) {
  if (response == null) return null;
  if (typeof response === "object") {
    for (const key of ["exit_code", "exitCode", "exit_status", "returncode", "code"]) {
      if (Number.isInteger(response[key])) return response[key];
    }
    if (response.metadata && Number.isInteger(response.metadata.exit_code)) return response.metadata.exit_code;
    return null;
  }
  const m = String(response).match(/(?:exit(?:ed)?(?: with)? code|exit status)\D{0,3}(-?\d+)/i);
  return m ? Number(m[1]) : null;
}

// The escape hatch for the Stop hook: an explicit "Not verified:" section that says something.
// "Not verified: none" does not count; a section that admits nothing is not an admission.
export function hasNotVerifiedSection(message) {
  const text = stripFences(message);
  const re = /^[ \t]*(?:[-*][ \t]*)?(?:#{1,6}[ \t]*)?(?:\*\*|__)?not verified(?:\*\*|__)?[ \t]*:?(?:\*\*|__)?[ \t]*(.*)$/gim;
  let m;
  while ((m = re.exec(text))) {
    let body = m[1].trim();
    if (!body) {
      const rest = text.slice(m.index + m[0].length).split("\n").slice(1);
      const items = [];
      for (const line of rest) {
        if (/^\s*([-*]|\d+\.)\s+\S/.test(line)) items.push(line.replace(/^\s*([-*]|\d+\.)\s+/, ""));
        else if (line.trim() === "" && items.length === 0) continue;
        else break;
      }
      body = items.join(" ").trim();
    }
    const plain = body.replace(/[*_`.]/g, "").trim().toLowerCase();
    if (plain && !/^(none|nothing|n\/a|na|-|—|no|nil)$/.test(plain)) return true;
  }
  return false;
}

// Removes fenced code blocks (``` or ~~~): a heading quoted inside one is not a heading.
// An unclosed fence runs to the end, as in CommonMark.
export function stripFences(message) {
  const out = [];
  let fence = null;
  for (const line of String(message || "").replace(/\r\n/g, "\n").split("\n")) {
    const m = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && /^[ \t]*[`~]+[ \t]*$/.test(line)) fence = null;
      continue;
    }
    if (m) fence = m[1];
    else out.push(line);
  }
  return out.join("\n");
}

// A Proof block: a markdown heading whose text is "Proof" at any level ("## Proof", "### proof:"),
// or "**Proof**" / "__Proof__" alone on its line. Case-insensitive; a trailing colon is fine.
// "Proof of concept", a sentence that mentions proof, or a heading inside a code block does not count.
export function hasProofBlock(message) {
  const text = stripFences(message);
  return /^[ \t]{0,3}(?:#{1,6}[ \t]+proof[ \t]*:?[ \t]*#*|(?:\*\*|__)[ \t]*proof[ \t]*:?[ \t]*(?:\*\*|__)[ \t]*:?)[ \t]*$/im.test(text);
}

export function listFiles(files, max = 5) {
  const unique = [...new Set(files)];
  const shown = unique.slice(0, max).join(", ");
  return unique.length > max ? `${shown} and ${unique.length - max} more` : shown;
}
