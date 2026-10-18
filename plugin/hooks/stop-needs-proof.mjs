#!/usr/bin/env node
// stop-needs-proof (Stop): the agent may not finish after changing code without proof.
// Looks at what happened since the last allowed stop. If code files were edited:
//   1. no check ran after the last edit           -> block (names the files and the checks it found)
//   2. the last check after the last edit failed  -> block (names the command)
//   3. checks passed, but the last reply has no Proof block -> block once, asking for "## Proof"
// Cases 1 and 2 come first; their reasons already ask for the Proof block.
// Each case blocks at most once per stop (logged as "block" events), so the agent can be sent back for
// the checks and then for the Proof block, but never loops. When stop_hook_active is set by another
// hook and this one hasn't blocked, it allows. In cases 1 and 2 it also
// allows a reply with a real "Not verified:" section (the honest way out). Case 3 has no such way
// out: once checks pass, "Not verified:" lines belong inside the Proof block.
// Proof block = a markdown heading whose text is "Proof" (any level, any case), or **Proof** alone
// on its line, outside code blocks. ".prove-it.json" "requireProof": false turns off case 3 only.
// Codex sends the same fields (stop_hook_active, last_assistant_message), so it behaves the same.

import {
  appendEvent,
  hasNotVerifiedSection,
  hasProofBlock,
  listFiles,
  readEvents,
  runHook,
  suggestedChecks,
} from "./lib.mjs";

runHook("stop-needs-proof", (input, { cwd, config, session }) => {
  const events = readEvents(session);
  let since = 0;
  events.forEach((e, i) => {
    if (e.t === "ack") since = i + 1;
  });
  const recent = events.slice(since);
  let lastEdit = -1;
  recent.forEach((e, i) => {
    if (e.t === "edit") lastEdit = i;
  });
  if (lastEdit === -1) return null; // no code changed: nothing to prove

  const allow = (why) => {
    appendEvent(session, { t: "ack", why });
    return null;
  };
  // Each kind of block fires at most once per stop, so the agent can be sent back for the checks and
  // then again for the Proof block, but never loops (three kinds, at most three blocks).
  const asked = new Set(recent.filter((e) => e.t === "block").map((e) => e.kind));
  // Continuing because of another hook, not ours: leave it alone.
  if (input.stop_hook_active && asked.size === 0) return allow("stop_hook_active");
  const block = (kind, reason) => {
    if (asked.has(kind)) return allow(`asked-before:${kind}`);
    appendEvent(session, { t: "block", kind });
    return { decision: "block", reason };
  };

  const checksAfter = recent.slice(lastEdit + 1).filter((e) => e.t === "check");
  const last = checksAfter[checksAfter.length - 1];
  const message = input.last_assistant_message;

  if (last && last.ok) {
    if (!config.requireProof || hasProofBlock(message)) return allow("checked");
    return block(
      "proof",
      `Prove It: the checks passed (\`${last.cmd}\`), but your reply has no Proof block. ` +
        `End it with a "## Proof" section (plain markdown, not inside a code block) in the prove-it skill's format: one line per requirement -> its evidence ` +
        `(command, exit code, the output line that proves it), a "Checks:" line, and a "Not verified:" line for anything you did not check.`,
    );
  }
  if (hasNotVerifiedSection(message)) return allow("not-verified");

  if (last) {
    return block(
      "failed",
      `Prove It: the last check failed: \`${last.cmd}\`${last.detail ? ` (${last.detail})` : ""}. ` +
        `Fix the cause, run it again and end with a "## Proof" block. If it still fails, say what fails and why under "Not verified:".`,
    );
  }
  const files = recent.filter((e) => e.t === "edit").map((e) => e.file);
  const found = suggestedChecks(cwd, config);
  const how = found.length
    ? `Run the project's checks (found: ${found.join(", ")}) and show the result`
    : `I found no check command in this project. Run whatever proves the change works and show the result`;
  return block(
    "no-check",
    `Prove It: you changed ${listFiles(files)} and no check has run since the last edit. ` +
      `${how}, then end with a "## Proof" block. If you cannot run checks, say exactly what you did not verify under "Not verified:".`,
  );
});
