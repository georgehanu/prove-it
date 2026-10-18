#!/usr/bin/env node
// diff-budget (PostToolUse Write|Edit|MultiEdit): when the working tree's diff against HEAD
// (tracked changes + new untracked files) grows past the budget, tell the agent once per
// threshold crossing (400, 800, 1200 ... by default). Non-blocking. Needs git; outside a
// git repository it does nothing.
// Untracked files are read on every edit, so only up to a cap: 200 files and 2 MB, skipping ignoreGlobs
// and heavy folders (node_modules, dist, build, .next, vendor, target ...). The note says when some were not counted.

import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULTS, isEditTool, matchesAny, readJson, runHook, sessionFile, writeJson } from "./lib.mjs";

const git = (cwd, args) => spawnSync("git", args, { cwd, encoding: "utf8", timeout: 5000, windowsHide: true });

export function sumNumstat(text) {
  let total = 0;
  for (const line of String(text || "").split("\n")) {
    const [add, del] = line.split("\t");
    if (/^\d+$/.test(add)) total += Number(add);
    if (/^\d+$/.test(del)) total += Number(del);
  }
  return total;
}

// Folders not worth reading for the budget, even when the project has no .gitignore for them.
const HEAVY_DIRS = ["node_modules", "dist", "build", ".next", "vendor", "target", "coverage", ".venv", "venv", "__pycache__"];
export const UNTRACKED_CAP = { files: 200, bytes: 2_000_000 };

// { total, skipped } changed lines against HEAD, or null outside a git repository.
// skipped: untracked files that were not read (past the cap, or a single file over 1 MB).
export function changedLines(cwd, config = DEFAULTS, cap = UNTRACKED_CAP) {
  const inside = git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.status !== 0 || inside.stdout.trim() !== "true") return null;
  let total;
  const head = git(cwd, ["diff", "--numstat", "HEAD"]);
  if (head.status === 0) total = sumNumstat(head.stdout);
  else total = sumNumstat(git(cwd, ["diff", "--numstat", "--cached"]).stdout) + sumNumstat(git(cwd, ["diff", "--numstat"]).stdout);
  // --exclude keeps git from walking into the heavy folders at all
  const untracked = git(cwd, ["ls-files", "--others", "--exclude-standard", "-z", ...HEAVY_DIRS.map((d) => `--exclude=${d}/`)]);
  const files = String(untracked.stdout || "")
    .split("\0")
    .filter((f) => f && !matchesAny(f, config.ignoreGlobs));
  let read = 0;
  let bytes = 0;
  let skipped = 0;
  for (const file of files) {
    if (read >= cap.files || bytes >= cap.bytes) {
      skipped++;
      continue;
    }
    try {
      const abs = join(cwd, file);
      const size = statSync(abs).size;
      if (size > 1_000_000 || bytes + size > cap.bytes) {
        skipped++;
        continue;
      }
      read++;
      bytes += size;
      const text = readFileSync(abs, "utf8");
      if (text.includes("\0")) continue;
      total += text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    } catch {
      // unreadable: skip
    }
  }
  return { total, skipped };
}

export function budget(input, { cwd, config, session }) {
  if (!isEditTool(input.tool_name)) return null;
  const counted = changedLines(cwd, config);
  if (counted === null) return null;
  const { total, skipped } = counted;
  const limit = Number(config.diffBudget);
  const file = sessionFile(session, "budget.json");
  const state = readJson(file, { notified: 0 });
  const bucket = Math.floor(total / limit);
  if (bucket <= state.notified) {
    if (bucket < state.notified) writeJson(file, { notified: bucket });
    return null;
  }
  writeJson(file, { notified: bucket });
  const notCounted = skipped
    ? ` (${skipped} untracked file${skipped === 1 ? " was" : "s were"} not counted: past the ${cap()} cap, so the real number is higher)`
    : "";
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext:
        `Prove It: the working tree now has ${total} changed lines against HEAD${notCounted} (budget ${limit}). ` +
        `A diff this size is hard to review in one pass. Before going further, check: can this be split into smaller changes? ` +
        `Are there unrelated edits to undo? If it has to be this big, say why in your summary and hand over a review brief.`,
    },
  };
}

const cap = () => `${UNTRACKED_CAP.files}-file / ${UNTRACKED_CAP.bytes / 1_000_000} MB`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runHook("diff-budget", budget);
