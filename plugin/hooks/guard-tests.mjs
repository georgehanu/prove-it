#!/usr/bin/env node
// guard-tests (PreToolUse Write|Edit|MultiEdit, plus Bash|PowerShell):
// an edit that makes a test file weaker is put to a person ("ask") instead of going through.
// Weaker means: fewer assertions, fewer tests, a new skip/only/todo, a new trivial assertion
// (expect(true).toBe(true)), or deleting a test file. An expected value changed and nothing else
// on that line also asks ("changes what the tests expect"). Adding tests passes silently.
// From the shell: deleting test files asks, and so does rewriting an existing test file (sed -i, >,
// tee, cp, Set-Content...), because the change can't be checked. Creating a new test file is fine.
// In Codex (--codex) or with "testGuard": "deny", the edit is denied with the same reason.

import { pathToFileURL } from "node:url";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  editedPaths,
  editsFromInput,
  hunks,
  isEditTool,
  isShellTool,
  isTestFile,
  lineDiff,
  listFiles,
  maskQuotes,
  readIfExists,
  relPath,
  runHook,
  shellCommandOf,
  splitShell,
  stripHeredocs,
  toPosix,
} from "./lib.mjs";

const ASSERT_RE =
  /\bexpect\s*\(|\bassert(?:\.\w+)*\s*\(|^\s*assert\s|\bself\.assert\w*\s*\(|\.should\b|\bt\.(?:is|not|equal|deepEqual|true|false|truthy|falsy|throws|rejects|snapshot)\s*\(|\bt\.(?:Error|Errorf|Fatal|Fatalf)\s*\(|\bassert_(?:eq|ne)!|\bassert!\s*\(|\brequire\.\w+\s*\(/gm;
const TEST_RE =
  /\b(?:it|test|specify)(?:\.\w+)?\s*\(\s*['"`]|^\s*(?:async\s+)?def\s+test_\w*|\bfunc\s+Test\w*\s*\(|#\[test\]|@Test\b/gm;
const SKIP_RE =
  /\b(?:it|test|describe|suite|context|specify)\.(?:skip|only|todo|fixme)\b|\b(?:xit|xdescribe|xtest|xcontext|fit|fdescribe)\s*\(|\bt\.(?:skip|todo)\s*\(|[{,]\s*(?:skip|todo|only)\s*:\s*(?:true|['"`])|@pytest\.mark\.(?:skip|skipif|xfail)\b|\bpytest\.skip\s*\(|@unittest\.skip|\bt\.Skip(?:Now|f)?\s*\(|#\[ignore\]|@(?:Disabled|Ignore)\b/gm;
const LIT = String.raw`(?:true|false|null|undefined|None|True|False|-?\d+(?:\.\d+)?|'[^']*'|"[^"]*"|[\w.$]+)`;
const TRIVIAL_RE = new RegExp(
  [
    String.raw`\bexpect\s*\(\s*(${LIT})\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\s*\(\s*\1\s*\)`,
    String.raw`\bexpect\s*\(\s*(?:true|1)\s*\)\s*\.\s*toBeTruthy\s*\(\s*\)`,
    String.raw`\bassert(?:\.ok)?\s*\(\s*(?:true|1|!0)\s*\)`,
    String.raw`\bassert(?:\.strict)?\.(?:strictEqual|equal|deepStrictEqual|deepEqual)\s*\(\s*(${LIT})\s*,\s*\2\s*\)`,
    String.raw`^\s*assert\s+(?:True|1)\s*$`,
    String.raw`\bself\.assertTrue\s*\(\s*True\s*\)`,
    String.raw`\bself\.assertEqual\s*\(\s*(${LIT})\s*,\s*\3\s*\)`,
  ].join("|"),
  "gm",
);

const count = (text, re) => (String(text || "").match(new RegExp(re.source, re.flags)) || []).length;

const STRING_RE = /(['"`])(?:\\.|(?!\1)[^\\])*\1/g;
const NUMBER_RE = /(?<![\w.])\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?n?(?![\w])/gi;

// Literals in line order, with their positions. Strings are masked (same length) before numbers are found.
function literals(line) {
  const found = [...line.matchAll(STRING_RE)].map((m) => ({ text: m[0], at: m.index }));
  const masked = line.replace(STRING_RE, (s) => "S".repeat(s.length));
  for (const m of masked.matchAll(NUMBER_RE)) found.push({ text: m[0], at: m.index });
  return found.sort((a, b) => a.at - b.at);
}
const skeleton = (line) => line.replace(STRING_RE, "S").replace(NUMBER_RE, "N").replace(/\s+/g, " ").trim();

// Where the expected value starts on an assertion line, or -1 if we cannot tell.
//   expect(actual).toBe(EXPECTED)        -> at ".toBe("
//   assert.equal(actual, EXPECTED)       -> at the first top-level comma
//   assert actual == EXPECTED (python)   -> at "=="
export function expectedStart(line) {
  const matcher = line.search(/\)\s*\.\s*(?:not\s*\.\s*)?(?:to\w*|should\w*)\s*\(/);
  if (matcher >= 0) return matcher;
  const call = /\b(?:assert(?:\.\w+)*|self\.assert\w+|t\.(?:is|not|equal|deepEqual)|assert_(?:eq|ne)!|require\.\w+)\s*\(/.exec(line);
  if (call) {
    let depth = 0;
    let quote = null;
    for (let i = call.index + call[0].length; i < line.length; i++) {
      const ch = line[i];
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = null;
      } else if (ch === "'" || ch === '"' || ch === "`") quote = ch;
      else if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) {
        if (depth === 0) return -1;
        depth--;
      } else if (ch === "," && depth === 0) return i;
    }
    return -1;
  }
  const py = /^\s*assert\s.*?(==)/.exec(line);
  return py ? py.index + py[0].length - 2 : -1;
}

// Assertion lines where only the expected side changed: same shape, different literals,
// and every changed literal sits after the point where the expected value starts.
// A line inside a multi-line assertion (a "  tax: 788," line of an expected object) counts when the
// assertion that opens above it has already started its expected value on its first line.
function changedExpectations(oldText, newText) {
  const out = [];
  const newLines = String(newText ?? "").replace(/\r\n/g, "\n").split("\n");
  const isAssert = (line) => new RegExp(ASSERT_RE.source, "m").test(line);
  for (const h of hunks(lineDiff(oldText, newText))) {
    if (h.removed.length !== h.added.length) continue;
    h.removed.forEach((r, i) => {
      const a = h.added[i];
      let insideExpected = false;
      if (!isAssert(a.text)) {
        for (let k = a.newNo - 2; k >= 0 && k >= a.newNo - 9; k--) {
          if (!isAssert(newLines[k])) continue;
          insideExpected = expectedStart(newLines[k]) >= 0;
          break;
        }
        if (!insideExpected) return;
      }
      if (skeleton(r.text) !== skeleton(a.text)) return;
      const before = literals(r.text);
      const after = literals(a.text);
      if (before.length !== after.length) return;
      const changed = after.filter((lit, k) => lit.text !== before[k].text);
      if (!changed.length) return;
      const start = insideExpected ? -1 : expectedStart(a.text);
      const onlyExpected = insideExpected || (start >= 0 ? changed.every((lit) => lit.at > start) : changed.length === 1);
      if (onlyExpected) out.push({ from: r.text.trim(), to: a.text.trim() });
    });
  }
  return out;
}

// Returns a list of plain-English findings for one change to a test file.
export function analyseTestEdit(oldText, newText) {
  const findings = [];
  const oldA = count(oldText, ASSERT_RE);
  const newA = count(newText, ASSERT_RE);
  if (newA < oldA) findings.push(`removes ${oldA - newA} assertion(s) (${oldA} -> ${newA})`);
  const oldT = count(oldText, TEST_RE);
  const newT = count(newText, TEST_RE);
  if (newT < oldT) findings.push(`removes ${oldT - newT} test(s) (${oldT} -> ${newT})`);
  const skipsAdded = count(newText, SKIP_RE) - count(oldText, SKIP_RE);
  if (skipsAdded > 0) {
    const kinds = [...new Set((String(newText).match(new RegExp(SKIP_RE.source, SKIP_RE.flags)) || []).map((s) => s.replace(/\s+/g, "").replace(/[({,]$/, "")))];
    findings.push(`adds skip/only/todo (${kinds.slice(0, 3).join(", ")}): some tests will not run`);
  }
  const trivialAdded = count(newText, TRIVIAL_RE) - count(oldText, TRIVIAL_RE);
  if (trivialAdded > 0) findings.push(`adds ${trivialAdded} assertion(s) that cannot fail (the value is compared with itself)`);
  for (const c of changedExpectations(oldText, newText).slice(0, 3))
    findings.push(`changed an expected value: \`${c.from}\` -> \`${c.to}\``);
  return findings;
}

// Paths a shell command deletes: rm, git rm, del, Remove-Item, rimraf, unlink.
// Commands are split outside quotes, so `git commit -m "rm test/a.test.js"` deletes nothing.
// `git rm --cached` only untracks: the file stays on disk.
export function deletedPaths(command) {
  const out = [];
  for (const segment of splitShell(command)) {
    const words = segment.match(/"[^"]*"|'[^']*'|\S+/g) || [];
    let i = 0;
    while (i < words.length && /^\w+=/.test(words[i])) i++;
    const head = (words[i] || "").toLowerCase().replace(/\.exe$/, "");
    let args = [];
    if (["rm", "del", "erase", "rimraf", "unlink", "remove-item", "ri", "rd", "rmdir"].includes(head)) args = words.slice(i + 1);
    else if (head === "npx" && words[i + 1] === "rimraf") args = words.slice(i + 2);
    else if (head === "git" && words[i + 1] === "rm" && !words.includes("--cached")) args = words.slice(i + 2);
    for (const a of args) if (!a.startsWith("-")) out.push(a.replace(/^["']|["']$/g, ""));
  }
  return out;
}

const unquote = (p) => p.replace(/^["']|["']$/g, "");
const isAbs = (p) => /^([a-zA-Z]:)?[\\/]/.test(p);
function resolveFrom(dir, p) {
  const posix = toPosix(p);
  return isAbs(posix) || !dir ? posix : join(dir, ...posix.split("/"));
}

// Paths a shell command writes to, each with the directory it is relative to (after any `cd`):
// sed -i / perl -i (inPlace: they only edit files that exist), > and >> redirects, tee, cp/mv targets,
// Set-Content / Add-Content / Out-File / New-Item. A test written this way skips every check above.
export function shellWrittenPaths(command, cwd = "") {
  const out = [];
  let dir = cwd;
  for (const segment of splitShell(stripHeredocs(command))) {
    const words = segment.match(/"[^"]*"|'[^']*'|\S+/g) || [];
    const head = (words[0] || "").toLowerCase().replace(/\.exe$/, "");
    if (["cd", "pushd", "set-location", "sl", "chdir"].includes(head)) {
      const target = words.slice(1).find((w) => !w.startsWith("-") && w.toLowerCase() !== "/d");
      if (target) dir = resolveFrom(dir, unquote(target));
      continue;
    }
    // a ">" inside quotes (echo "a > b", node -e "x => y") is text: find redirects in the masked copy,
    // then read the target from the original at the same position
    const masked = maskQuotes(segment);
    for (const m of masked.matchAll(/(?:^|[^\d&>])>>?\s*("[^"]+"|'[^']+'|[^\s;&|<>]+)/g)) {
      const at = m.index + m[0].length - m[1].length;
      out.push({ path: unquote(segment.slice(at, at + m[1].length)), dir });
    }
    const args = words.slice(1).filter((w) => !w.startsWith(">") && !/^\d?>/.test(w));
    const plain = args.filter((w) => !w.startsWith("-"));
    const named = (...names) => {
      const i = args.findIndex((w) => names.includes(w.toLowerCase()));
      return i >= 0 && args[i + 1] ? args[i + 1] : null;
    };
    if ((head === "sed" || head === "perl") && args.some((w) => /^-[a-z]*i/.test(w) || w === "--in-place"))
      out.push(...plain.slice(1).map((p) => ({ path: unquote(p), dir, inPlace: true })));
    else if (head === "tee") out.push(...plain.map((p) => ({ path: unquote(p), dir })));
    else if (["cp", "mv", "copy-item", "move-item", "copy", "move"].includes(head) && plain.length >= 2)
      out.push({ path: unquote(plain[plain.length - 1]), dir, sources: plain.slice(0, -1).map(unquote) });
    else if (["set-content", "add-content", "out-file", "sc", "ac", "new-item", "ni"].includes(head)) {
      const target = named("-path", "-literalpath", "-filepath") ?? plain[0];
      if (target) out.push({ path: unquote(target), dir });
    }
  }
  return out;
}

// Does the shell target already exist? A glob counts as existing (it matches files that are there).
// cp/mv into an existing folder writes <folder>/<source name>.
function existing(target) {
  const shown = (p) => resolveFrom(target.dir, p);
  if (target.inPlace || /[*?]/.test(target.path)) return { exists: true, path: shown(target.path) };
  const abs = shown(target.path);
  try {
    if (target.sources && existsSync(abs) && statSync(abs).isDirectory()) {
      const inside = target.sources.map((s) => `${toPosix(target.path).replace(/\/+$/, "")}/${toPosix(s).split("/").pop()}`);
      const hit = inside.find((p) => existsSync(shown(p)));
      return { exists: Boolean(hit), path: shown(hit ?? inside[0]) };
    }
    return { exists: existsSync(abs), path: abs };
  } catch {
    return { exists: true, path: abs }; // cannot tell: treat it as a rewrite
  }
}

// heading: what the change does, in one line. lines: the details. how: what to do instead.
function decide(heading, lines, how, ctx) {
  const deny = ctx.codex || ctx.config.testGuard === "deny";
  const reason =
    `Prove It: ${heading}${lines.length ? `:\n- ${lines.join("\n- ")}` : "."}\n` +
    (deny ? `It was blocked. ${how.deny}` : `A person must approve it. ${how.ask}`);
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: deny ? "deny" : "ask",
      permissionDecisionReason: reason,
    },
  };
}

const FIX_CODE = {
  ask: "If the requirement really changed, explain why in one line; otherwise cancel and fix the code, not the test.",
  deny: "If the requirement really changed, say so to the person and let them make or approve the test change; otherwise fix the code, not the test.",
};
const USE_EDIT = {
  ask: "To change a test, use the Edit tool so the change can be checked; if you mean to replace the file, explain why in one line.",
  deny: "To change a test, use the Edit tool so the change can be checked.",
};

// Agents often edit a tiny fragment ("tax: 788" -> "tax: 789") with no assertion in it. To judge it,
// rebuild the whole file before and after the Edit/MultiEdit from what is on disk.
// keep(file) decides first which files matter, so a non-test file is never read.
export function withWholeFile(input, cwd, keep = () => true) {
  const edits = editsFromInput(input, keep);
  if ((input.tool_name !== "Edit" && input.tool_name !== "MultiEdit") || !edits.length) return edits;
  const ti = input.tool_input || {};
  const lf = (t) => String(t ?? "").replace(/\r\n/g, "\n");
  const raw = readIfExists(ti.file_path, cwd);
  if (raw == null) return edits;
  const current = lf(raw);
  let next = current;
  for (const e of input.tool_name === "Edit" ? [ti] : ti.edits || []) {
    const from = lf(e.old_string);
    const to = lf(e.new_string);
    if (!from || !next.includes(from)) return edits;
    next = e.replace_all ? next.split(from).join(to) : next.replace(from, () => to);
  }
  return [{ file: ti.file_path, oldText: current, newText: next, kind: "edit" }];
}

export function guard(input, ctx) {
  const { cwd, config } = ctx;
  const tool = input.tool_name;

  if (isShellTool(tool)) {
    const ti = input.tool_input || {};
    const command = shellCommandOf(ti);
    const show = (list) => [...new Set(list.map((p) => toPosix(relPath(p, cwd))))].join(", ");
    const deleted = deletedPaths(stripHeredocs(command)).filter((p) => {
      const plain = toPosix(relPath(p, cwd)).replace(/\/+$/, "");
      if (/[*?]/.test(plain)) {
        const probe = plain.replace(/\*+/g, "x").replace(/\?/g, "x");
        return isTestFile(/\.\w+$/.test(probe) ? probe : `${probe}.js`, config);
      }
      // a test file, or a folder that holds tests (test/, tests/, __tests__/ ...)
      return isTestFile(plain, config) || isTestFile(`${plain}/x.js`, config);
    });
    // A new test file written from the shell weakens nothing: allowed. Rewriting one that exists is not.
    const rewritten = [];
    for (const target of shellWrittenPaths(command, cwd)) {
      const { exists, path } = existing(target);
      const plain = toPosix(relPath(path, cwd));
      const probe = /[*?]/.test(plain) ? plain.replace(/\*+/g, "x").replace(/\?/g, "x") : plain;
      if (exists && isTestFile(probe, config)) rewritten.push(path);
    }
    const rewrites = `${rewritten.length > 1 ? "existing test files" : "an existing test file"} from the shell, where the change can't be checked: ${show(rewritten)}`;
    if (deleted.length && rewritten.length)
      return decide(`this command deletes test files (${show(deleted)}) and rewrites ${rewrites}`, [], FIX_CODE, ctx);
    if (deleted.length) return decide(`this command deletes test files: ${show(deleted)}`, [], FIX_CODE, ctx);
    if (rewritten.length) return decide(`this command rewrites ${rewrites}`, [], USE_EDIT, ctx);
    return null;
  }

  if (!isEditTool(tool)) return null;
  // decide on the path before reading anything: most edits are not to tests
  const isTest = (f) => Boolean(f) && isTestFile(relPath(f, cwd), config);
  if (!editedPaths(input).some(isTest)) return null;
  const byFile = new Map();
  for (const e of withWholeFile(input, cwd, isTest)) {
    const file = relPath(e.file, cwd);
    const findings =
      e.kind === "delete" ? ["deletes the test file"] : e.oldText == null ? [] : analyseTestEdit(e.oldText, e.newText);
    if (findings.length) byFile.set(file, [...(byFile.get(file) || []), ...findings]);
  }
  if (!byFile.size) return null;
  const all = [...byFile.values()].flat();
  const reasons = [...byFile.entries()].flatMap(([f, list]) => (byFile.size > 1 ? list.map((r) => `${f}: ${r}`) : list));
  const expectChanges = all.filter((r) => r.startsWith("changed an expected value")).length;
  const what =
    expectChanges === all.length
      ? "changes what the tests expect"
      : expectChanges
        ? "makes the tests weaker and changes what they expect"
        : "makes the tests weaker";
  return decide(`this change to ${listFiles([...byFile.keys()])} ${what}`, reasons, FIX_CODE, ctx);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runHook("guard-tests", guard);
