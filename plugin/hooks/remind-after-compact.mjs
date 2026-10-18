#!/usr/bin/env node
// remind-after-compact (SessionStart, matcher "compact"): compaction summarises the
// conversation and rules given earlier can get lost. This puts the five rules back.

import { RULES, runHook } from "./lib.mjs";

runHook("remind-after-compact", (input) => {
  if (input.source && input.source !== "compact") return null;
  return { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: RULES } };
});
