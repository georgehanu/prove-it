#!/usr/bin/env node
// track: records what the Stop hook needs to know, in a per-session event log.
//   PostToolUse  Write|Edit|MultiEdit   -> {t:"edit", file} for each code file changed
//   PostToolUse  Bash|PowerShell        -> {t:"check", cmd, ok} when the command is a check
//   PostToolUseFailure Bash|PowerShell  -> {t:"check", cmd, ok:false}
// In Claude Code a shell command that exits non-zero arrives as PostToolUseFailure
// (error: "Exit code N"); a zero exit arrives as PostToolUse. Both are handled here.
// It never prints anything: tracking is silent.

import {
  appendEvent,
  editedPaths,
  exitCodeFrom,
  isCheckCommand,
  isCodeFile,
  isEditTool,
  isShellTool,
  outputShowsFailure,
  relPath,
  runHook,
  shellCommandOf,
  stripCommand,
} from "./lib.mjs";

runHook("track", (input, { cwd, config, session }) => {
  const tool = input.tool_name;
  const event = input.hook_event_name;

  if (isEditTool(tool)) {
    if (event === "PostToolUseFailure") return null; // the edit did not happen
    for (const path of editedPaths(input)) {
      const file = relPath(path, cwd);
      if (file && isCodeFile(file, config)) appendEvent(session, { t: "edit", file });
    }
    return null;
  }

  if (isShellTool(tool)) {
    const ti = input.tool_input || {};
    const command = shellCommandOf(ti);
    if (!isCheckCommand(command, cwd, config)) return null;
    if (ti.run_in_background) return null; // no result yet, so it proves nothing

    let ok;
    let detail = "";
    if (event === "PostToolUseFailure") {
      ok = false;
      detail = String(input.error || "failed").slice(0, 200);
    } else {
      const res = input.tool_response;
      const code = exitCodeFrom(res);
      const output = typeof res === "string" ? res : `${res?.stdout ?? ""}\n${res?.stderr ?? ""}${res?.output ?? ""}`;
      if (res && typeof res === "object" && res.interrupted) {
        ok = false;
        detail = "interrupted";
      } else if (code !== null && code !== 0) {
        ok = false;
        detail = `Exit code ${code}`;
      } else if (outputShowsFailure(command, output, code === null && typeof res === "string")) {
        ok = false;
        detail = /[|;]/.test(stripCommand(command)) ? "the output reports failures (a pipe hid the exit code)" : "the output reports failures";
      } else ok = true;
    }
    appendEvent(session, { t: "check", cmd: command.slice(0, 300), ok, detail });
  }
  return null;
});
