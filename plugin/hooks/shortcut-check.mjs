#!/usr/bin/env node
// shortcut-check (PostToolUse Write|Edit|MultiEdit, code files that are not tests):
// scans only the lines the agent just ADDED for shortcuts that make code look done.
// Non-blocking: findings go back to the agent as additionalContext with file:line,
// and the agent is asked to fix them or say why they are intentional.
// Test files are skipped here; guard-tests covers them.

import { pathToFileURL } from "node:url";
import { editsFromInput, isCodeFile, isEditTool, isTestFile, lineDiff, readIfExists, relPath, runHook } from "./lib.mjs";

// [pattern, what, where]. where says which version of the line the pattern reads:
//   raw   the whole line: suppression comments and TODOs live in comments
//   code  the line without its trailing comment: `// treat it as any other` is not `as any`
//   bare  code with string contents blanked: `"call console.log() first"` is not a debug log
const SINGLE_LINE = [
  [/\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/, "empty catch block: the error is swallowed", "bare"],
  [/\.catch\s*\(\s*(?:\(\s*\w*\s*\)|\w+)\s*=>\s*(?:\{\s*\}|null|undefined|void 0)\s*\)/, "empty .catch(): the error is swallowed", "bare"],
  [/^\s*except\b[^:]*:\s*(?:pass|\.\.\.)\s*$/, "except: pass swallows the error", "bare"],
  [/@ts-ignore|@ts-nocheck/, "@ts-ignore silences the type checker", "raw"],
  [/@ts-expect-error/, "@ts-expect-error silences the type checker", "raw"],
  [/eslint-disable/, "eslint-disable silences the linter", "raw"],
  [/biome-ignore|oxlint-disable/, "a lint suppression", "raw"],
  [/\bas\s+any\b/, "`as any` switches off type checking for this value", "bare"],
  [/#\s*type:\s*ignore/, "# type: ignore silences the type checker", "raw"],
  [/#\s*noqa\b|#\s*pylint:\s*disable/, "a lint suppression (noqa / pylint: disable)", "raw"],
  [/\/\/\s*nolint\b/, "//nolint silences the linter", "raw"],
  [
    /process\.env\.NODE_ENV\s*[!=]==?\s*['"`]test['"`]|['"`]test['"`]\s*[!=]==?\s*process\.env\.NODE_ENV|process\.env\.(?:VITEST|JEST_WORKER_ID|NODE_TEST_CONTEXT)\b|import\.meta\.env\.(?:VITEST|MODE\s*[!=]==?\s*['"`]test)/,
    "a test-environment branch: code that behaves differently under test",
    "code",
  ],
  [
    /\bif\b.*\b(?:isTest|isTesting|IS_TEST|TESTING|IN_TEST|PYTEST_CURRENT_TEST|testing\.Testing\(\))\b|["']pytest["']\s+in\s+sys\.modules/,
    "a test-environment branch: code that behaves differently under test",
    "code",
  ],
  [/\b(?:TODO|FIXME|XXX|HACK)\b/, "a TODO/FIXME left in: unfinished work", "raw"],
  [/\bconsole\.(?:log|debug|trace|dir)\s*\(|^\s*debugger\s*;?\s*$/, "leftover debug output (console.log / debugger)", "bare"],
  [/\b(?:dbg!|var_dump|print_r)\s*\(|\bdd\s*\(/, "leftover debug output", "bare"],
];

const HASH_COMMENTS = /\.(?:py|rb|ex|exs|php)$/i; // languages where # starts a comment
const NO_SLASH_COMMENTS = /\.(?:py|rb|ex|exs)$/i; // languages where // is not a comment

// Splits one line into { code, bare }: code drops trailing // or # comments and inline /* */ (not
// inside strings); bare also blanks the inside of every string. A line that continues a /* */ block
// (" * ...") has no code.
export function codeOf(line, file = "") {
  if (/^\s*\*(?:\s|\/|$)/.test(line)) return { code: "", bare: "" };
  const hash = HASH_COMMENTS.test(file);
  const slashes = !NO_SLASH_COMMENTS.test(file);
  let code = "";
  let bare = "";
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      code += ch;
      if (ch === quote) {
        quote = null;
        bare += ch;
      } else if (ch === "\\" && i + 1 < line.length) {
        code += line[++i];
        bare += "  ";
      } else bare += " ";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (slashes && ch === "/" && line[i + 1] === "/") break;
    else if (hash && ch === "#") break;
    else if (slashes && ch === "/" && line[i + 1] === "*") {
      const end = line.indexOf("*/", i + 2);
      if (end < 0) break;
      code += " ";
      bare += " ";
      i = end + 1;
      continue;
    }
    code += ch;
    bare += ch;
  }
  return { code, bare };
}

const PY_PRINT = /^\s*print\s*\(/;
const CATCH_OPEN = /\bcatch\s*(?:\([^)]*\))?\s*\{\s*$/;
const EXCEPT_OPEN = /^\s*except\b[^:]*:\s*$/;
const COMMENT_ONLY = /^\s*(?:\/\/|#|\/\*|\*|$)/;
const RETURN_LITERAL =
  /(?:^\s*|[;{)]\s*|\belse\s+)return\s+(?:-?\d[\d_.]*|'[^']*'|"[^"]*"|`[^`$]*`|true|false|null|None|True|False|\[.*\]|\{.*\})\s*;?\s*(?:(?:\/\/|#).*)?$/;
const MOCK_NOTE = /(?:\/\/|#|\/\*|^\s*\*).*\b(?:mock(?:ed)?|fake|stub(?:bed)?|placeholder|hard-?coded|dummy|for now|temporar(?:y|ily))\b/i;

// added: [{ no, text }] in file order. Returns [{ no, what }].
export function scanAdded(added, file) {
  const findings = [];
  const isPython = /\.py$/i.test(file);
  added.forEach((line, i) => {
    const text = line.text;
    const forms = { raw: text, ...codeOf(text, file) };
    for (const [re, what, where] of SINGLE_LINE) {
      if (re.test(forms[where])) {
        findings.push({ no: line.no, what });
        break;
      }
    }
    if (isPython && PY_PRINT.test(forms.bare)) findings.push({ no: line.no, what: "leftover debug output (print)" });
    // A block opener followed only by comments, then the close: the block does nothing.
    const firstCode = () => {
      for (let k = i + 1; k < added.length; k++) {
        const prev = added[k - 1];
        if (prev.no && added[k].no && added[k].no !== prev.no + 1) return null; // not contiguous
        if (!COMMENT_ONLY.test(added[k].text)) return added[k].text;
      }
      return null;
    };
    if (CATCH_OPEN.test(forms.bare) && /^\s*\}/.test(firstCode() ?? ""))
      findings.push({ no: line.no, what: "empty catch block: the error is swallowed" });
    if (EXCEPT_OPEN.test(forms.bare) && /^\s*(?:pass|\.\.\.)\s*$/.test(firstCode() ?? ""))
      findings.push({ no: line.no, what: "except: pass swallows the error" });
    if (RETURN_LITERAL.test(forms.code)) {
      const near = added.slice(Math.max(0, i - 2), i + 3);
      if (near.some((l) => MOCK_NOTE.test(l.text)) || MOCK_NOTE.test(text))
        findings.push({ no: line.no, what: "a hardcoded return next to a mock/fake/stub note: the result is faked" });
    }
  });
  const seen = new Set();
  return findings.filter((f) => {
    const key = `${f.no}:${f.what}`;
    return seen.has(key) ? false : seen.add(key);
  });
}

// Finds the added lines with their line numbers in the new file.
export function addedLines(input) {
  const tool = input.tool_name;
  const ti = input.tool_input || {};
  const res = input.tool_response && typeof input.tool_response === "object" ? input.tool_response : null;

  if (res && Array.isArray(res.structuredPatch) && res.structuredPatch.length) {
    const out = [];
    for (const h of res.structuredPatch) {
      let n = h.newStart || 1;
      for (const l of h.lines || []) {
        if (l.startsWith("+")) out.push({ no: n++, text: l.slice(1) });
        else if (l.startsWith(" ")) n++;
      }
    }
    return out;
  }
  if (tool === "Write") {
    const before = res && typeof res.originalFile === "string" ? res.originalFile : "";
    return lineDiff(before, ti.content ?? "")
      .filter((o) => o.op === "+")
      .map((o) => ({ no: o.newNo, text: o.text }));
  }
  const pieces =
    tool === "Edit" ? [{ o: ti.old_string, n: ti.new_string }] : tool === "MultiEdit" ? (ti.edits || []).map((e) => ({ o: e.old_string, n: e.new_string })) : [];
  if (pieces.length) {
    const current = readIfExists(ti.file_path, input.cwd);
    const out = [];
    for (const { o, n } of pieces) {
      const at = current && n ? current.indexOf(n) : -1;
      const base = at >= 0 ? current.slice(0, at).split("\n").length : null;
      for (const op of lineDiff(o ?? "", n ?? "")) if (op.op === "+") out.push({ no: base ? base + op.newNo - 1 : null, text: op.text });
    }
    return out;
  }
  return [];
}

export function check(input, { cwd, config }) {
  if (!isEditTool(input.tool_name)) return null;
  const perFile = [];
  // decide on the path before reading anything: only code files that are not tests are scanned
  const wanted = (file) => {
    const rel = file ? relPath(file, cwd) : "";
    return Boolean(rel) && isCodeFile(rel, config) && !isTestFile(rel, config);
  };
  if (input.tool_name === "apply_patch") {
    // Codex: per-file added lines from the patch; find each line in the new file for its number.
    for (const e of editsFromInput(input, wanted)) {
      if (!e.patchAdded?.length) continue;
      const current = (readIfExists(e.file, cwd) || "").split(/\r?\n/);
      perFile.push({ file: e.file, added: e.patchAdded.map((text) => ({ no: current.indexOf(text) + 1 || null, text })) });
    }
  } else if (wanted(input.tool_input?.file_path)) {
    perFile.push({ file: input.tool_input.file_path, added: addedLines(input) });
  }

  const lines = [];
  for (const { file, added } of perFile) {
    const rel = relPath(file, cwd);
    for (const f of scanAdded(added, rel)) lines.push(`- ${rel}${f.no ? `:${f.no}` : ""} ${f.what}`);
  }
  if (!lines.length) return null;
  const shown = lines.slice(0, 8);
  if (lines.length > 8) shown.push(`- and ${lines.length - 8} more`);
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext:
        `Prove It noticed shortcuts in lines you just added:\n${shown.join("\n")}\n` +
        `If one is intentional, say why in your summary. If not, fix it now.`,
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runHook("shortcut-check", check);
