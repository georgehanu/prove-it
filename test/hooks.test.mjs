// Runs every scenario in test/fixtures/*.json against the real hook scripts.
// Each scenario gets a fresh temp project and a fresh state dir. Steps either write files
// or feed one JSON input to one hook over stdin; a step's "expect" checks that hook's output.
//
// step keys:
//   write: { "path": "content" }                      write files into the project
//   writeMany: { "pattern": "gen/f{n}.js", "count": 250, "content": "..." }   many similar files
//   hook, input, args, raw                             run one hook
//   noSession: true                                    send the input without a session_id
//
// expect keys:
//   silent: true                    no output at all
//   decision: "block"               Stop hook blocked
//   permissionDecision: "ask"|"deny"
//   includes: ["text", ...]         the reason/context contains each text
//   excludes: ["text", ...]

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const hooksDir = join(here, "..", "plugin", "hooks");
const fixturesDir = join(here, "fixtures");

const EVENTS = {
  "stop-needs-proof": "Stop",
  "guard-tests": "PreToolUse",
  "shortcut-check": "PostToolUse",
  "diff-budget": "PostToolUse",
  track: "PostToolUse",
  "remind-after-compact": "SessionStart",
};

// "$CWD/src/a.js" -> native absolute path inside the temp project.
function fill(value, cwd) {
  if (typeof value === "string") {
    if (value === "$CWD") return cwd;
    if (value.startsWith("$CWD/")) return join(cwd, ...value.slice(5).split("/"));
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, cwd));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, cwd)]));
  return value;
}

function writeFiles(cwd, files) {
  for (const [path, content] of Object.entries(files || {})) {
    const abs = join(cwd, ...path.split("/"));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof content === "string" ? content : JSON.stringify(content, null, 2));
  }
}

const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8" });

function runStep(step, ctx) {
  const input = fill(step.input ?? {}, ctx.cwd);
  if (step.noSession) delete input.session_id;
  else input.session_id ??= ctx.session;
  input.cwd ??= ctx.cwd;
  input.hook_event_name ??= EVENTS[step.hook];
  const raw = step.raw ?? JSON.stringify(input);
  // async, so scenarios can run side by side (each has its own project and state folder)
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(hooksDir, `${step.hook}.mjs`), ...(step.args || [])], {
      env: { ...process.env, CLAUDE_PLUGIN_DATA: ctx.data },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(raw);
  });
}

function check(step, res, name) {
  const e = step.expect;
  assert.equal(res.status, 0, `${name}: hooks always exit 0 (stderr: ${res.stderr})`);
  const out = res.stdout.trim();
  if (e.silent) {
    assert.equal(out, "", `${name}: expected no output, got ${out}`);
    return;
  }
  assert.notEqual(out, "", `${name}: expected output, got none`);
  const json = JSON.parse(out);
  const hso = json.hookSpecificOutput || {};
  const text = json.reason || hso.permissionDecisionReason || hso.additionalContext || "";
  if (e.decision) assert.equal(json.decision, e.decision, name);
  if (e.permissionDecision) assert.equal(hso.permissionDecision, e.permissionDecision, name);
  for (const s of e.includes || []) assert.ok(text.includes(s), `${name}: expected "${s}" in:\n${text}`);
  for (const s of e.excludes || []) assert.ok(!text.includes(s), `${name}: did not expect "${s}" in:\n${text}`);
}

let n = 0;
// Scenarios run side by side: each has its own temp project and state folder.
describe("hook scenarios", { concurrency: 8 }, () => {
  for (const file of readdirSync(fixturesDir).filter((f) => f.endsWith(".json")).sort()) {
    const scenarios = JSON.parse(readFileSync(join(fixturesDir, file), "utf8"));
    for (const sc of scenarios) {
      const id = `case-${++n}`;
      test(`${file.replace(/\.json$/, "")}: ${sc.name}`, async () => {
        const root = mkdtempSync(join(tmpdir(), "prove-it-test-"));
        const cwd = join(root, "project");
        const data = join(root, "data");
        mkdirSync(cwd, { recursive: true });
        try {
          writeFiles(cwd, sc.files);
          if (sc.config) writeFiles(cwd, { ".prove-it.json": typeof sc.config === "string" ? sc.config : sc.config });
          if (sc.git) {
            git(cwd, "init", "-q");
            git(cwd, "add", "-A");
            git(cwd, "-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-qm", "init");
          }
          const ctx = { cwd, data, session: id };
          for (const [i, step] of sc.steps.entries()) {
            if (step.write) {
              writeFiles(cwd, step.write);
              continue;
            }
            if (step.writeMany) {
              const { pattern, count, content } = step.writeMany;
              const many = {};
              for (let k = 1; k <= count; k++) many[pattern.replace("{n}", String(k).padStart(4, "0"))] = content;
              writeFiles(cwd, many);
              continue;
            }
            const res = await runStep(step, ctx);
            if (step.expect) check(step, res, `${sc.name} (step ${i + 1})`);
            else assert.equal(res.status, 0);
          }
          if (sc.expectErrorLog) assert.ok(existsSync(join(data, "errors.log")), "fail-open errors are logged");
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      });
    }
  }
});
