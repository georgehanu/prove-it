---
title: Rules it can't ignore
lesson: 6
code: plugin/hooks/hooks.json
---

# Lesson 6 · Rules it can't ignore

Everyone who uses a coding agent for long enough writes the same rule twice. "Always run the tests before saying you're done" goes into `CLAUDE.md`. A week later the agent says "Done!" without running them, you add **IMPORTANT** in front of the rule, and a week after that it happens again.

That isn't a bug you can report away. A long-running issue titled ["Claude Code continually ignores CLAUDE.MD file"](https://github.com/anthropics/claude-code/issues/34197) was closed as not planned, and the thread arrives at the right explanation: `CLAUDE.md` is context the model reads, not a rule anything enforces, and the way to get a hard constraint is a hook. Developers feel the difference. In the [Stack Overflow 2025 survey](https://survey.stackoverflow.co/2025/ai), more developers distrusted the accuracy of AI tools (46%) than trusted it (33%). Asking more firmly in a markdown file doesn't move that number. Checks that run every time do.

This lesson is about choosing where a rule should live, writing a hook of your own, and reading other people's skills and hooks before you let them run.

## Four places to put a rule

| | Where it lives | When it acts | Can the agent skip it? | Use it for |
| --- | --- | --- | --- | --- |
| `CLAUDE.md` | repo root, `~/.claude/` | loaded into context every session (Claude Code) | yes: it's text the model reads | facts and conventions: commands, structure, style |
| `AGENTS.md` | repo root, subfolders | read at the start by Codex, Cursor and others | yes: same as above | the same, for tools other than Claude Code |
| Skill | `skills/<name>/SKILL.md` | the body loads when the request matches its description, or when you invoke it | yes, and it may not load at all | procedures: how to debug, what a proof block looks like |
| Hook | `hooks/hooks.json` + a script | on events, every time, outside the model | no, but it can only check what code can see | hard rules: no finishing without checks, no weakening tests |

Prove It uses all four on purpose. The rules themselves are in the [`AGENTS.md.snippet`](../AGENTS.md.snippet), for tools without hooks, labelled honestly as instructions. The procedures are skills. The parts a script can check are hooks. And because compaction can drop instructions from a long session, a small hook, [`remind-after-compact.mjs`](../plugin/hooks/remind-after-compact.mjs), puts the five rules back whenever Claude Code compacts the conversation (`SessionStart` with the `compact` matcher).

A rule of thumb: if you can write the check as code that looks at a tool call, a file or a command result, make it a hook. If it needs judgment ("is this the root cause?"), write it as a skill and let a hook check its traces (did a test run? is there a Not verified section?).

## Write your own hook in 20 lines

A hook is a program that reads one JSON object on stdin and may print one JSON object on stdout. Here's a complete `PreToolUse` hook that stops the agent editing secrets, migrations that may already have run, and the npm lockfile:

```js
#!/usr/bin/env node
// .claude/hooks/protect-paths.mjs: some files are changed by people, not by the agent.
import { readFileSync } from "node:fs";

const PROTECTED = [
  /(^|\/)\.env(\.[\w-]+)?$/, // secrets
  /(^|\/)migrations\/.+\.sql$/, // migrations that may already have run
  /(^|\/)package-lock\.json$/, // let npm write the lockfile
];

const input = JSON.parse(readFileSync(0, "utf8"));
const file = String(input.tool_input?.file_path ?? "").replace(/\\/g, "/");

if (PROTECTED.some((re) => re.test(file))) {
  const reason = `${file} is protected. Explain the change you need and let a person make it.`;
  console.log(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
  }));
}
```

Register it in `.claude/settings.json` (shared with the team) or `.claude/settings.local.json` (just you):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [{ "type": "command", "command": "node", "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/protect-paths.mjs"] }]
      }
    ]
  }
}
```

This is the exec form: with `args` set, Claude Code starts `node` directly, with no shell in between, and fills in `${CLAUDE_PROJECT_DIR}` inside each argument. A path with spaces needs no quoting, and the same line works on macOS, Linux and Windows. Prove It's own [`hooks.json`](../plugin/hooks/hooks.json) uses it too, with `${CLAUDE_PLUGIN_ROOT}`.

A few things that took me a while to learn:

- **Give a reason.** The reason is what the model reads. "Blocked" makes it try another route to the same file. "Explain the change and let a person make it" gives it something useful to do instead.
- **Normalise paths.** On Windows, `file_path` arrives with backslashes. Hence the `replace(/\\/g, "/")`.
- **Exit 0 when unsure.** If your script crashes, the agent gets an error it can't act on. Prove It's hooks wrap everything in `try`, fail open, and log errors to a file instead.
- **Pre for prevention, Post for feedback.** `PreToolUse` runs before the tool and can deny it. `PostToolUse` runs after and can only add context: the edit is already on disk.
- **Hook output is quiet by default.** Press Ctrl+O in Claude Code to see what your hooks said. For a headless run, `claude -p --debug-file hooks.log` writes every hook decision to the log.
- **Test it without the agent.** Pipe a JSON file in: `node protect-paths.mjs < sample.json`. Prove It's [test suite](../test/hooks.test.mjs) does exactly that for every hook, with [fixtures](../test/fixtures/) shaped like the real inputs Claude Code and Codex send.

## Read it before you install it

A skill is a prompt that runs with your agent's permissions. A hook is a program that runs on your machine on every tool call. Installing either from a stranger's repository is like adding a dependency with a `postinstall` script. Read it first. Things to look for:

- **`allowed-tools` in a skill's frontmatter.** It pre-approves tools while the skill is active, so the agent won't ask you. Know what it approves and why.
- **Scripts a skill tells the agent to run**, and anything that fetches from the network.
- **Instructions aimed at the agent rather than the task**: "ignore previous instructions", "don't mention this", hidden text, odd Unicode.
- **Hook commands.** What they run, what they read, where they write, whether they call out to anything.

Prove It is written to make that reading quick:

- [`plugin/skills/`](../plugin/skills/): four `SKILL.md` files, each under 120 lines, none using `allowed-tools`.
- [`plugin/agents/fresh-eyes.md`](../plugin/agents/fresh-eyes.md): the reviewer subagent and its tool list.
- [`plugin/hooks/hooks.json`](../plugin/hooks/hooks.json): which script runs on which event.
- [`plugin/hooks/*.mjs`](../plugin/hooks/): plain Node, no dependencies, no network. They read the hook input, your `.prove-it.json`, your `package.json` and, for the budget, `git diff`. They write only to a state folder (`${CLAUDE_PLUGIN_DATA}` or your temp folder).

## Codex hooks

Codex has hooks too, configured in `~/.codex/hooks.json` or a project's `.codex/hooks.json`, with similar events. The [`codex/`](../codex/README.md) folder wires the same scripts to them. Three differences matter:

- **Deny only.** Codex's `PreToolUse` can deny a call but not ask you about it, so guard-tests denies there, with the same reason. The agent has to come to you.
- **Edits arrive as patches.** Codex edits files with `apply_patch`; the scripts read the patch to find files, added lines and removed assertions.
- **Trust is explicit.** Codex runs only hooks you've reviewed with `/hooks`, and asks again when one changes. That's the reading step above, built in.

Skills work in both. Copy `plugin/skills/*` into `.agents/skills/` in a project, or `~/.agents/skills/`, and Codex picks them up.

## Try it

1. Save the 20-line hook above as `.claude/hooks/protect-paths.mjs` in a copy of the demo and register it.
2. Ask the agent to "add a migration file `migrations/001_fees.sql` and then fix a typo in it". Watch the second edit get denied with your reason.
3. Open [`plugin/hooks/hooks.json`](../plugin/hooks/hooks.json) and follow one event to its script. It should take a few minutes to read the lot.

## Limits

- **Hooks only see tool calls.** They don't see the model's reasoning, and can't check a claim made in prose, only its traces.
- **A hook is only as good as its matcher.** A file changed through Bash with `sed` or a script never passes through an Edit hook. Prove It's test guard checks shell commands that delete or rewrite test files, but no list of commands is complete.
- **Hooks can be turned off.** Anyone with access to the settings can disable them, including, in principle, an agent with write access to `.claude/`. Protect that folder with a hook like the one above if it matters to you.
- **Instructions still matter.** Hooks enforce the floor. The skills and the snippet are what get you above it.

Next: does all this actually work? [Lesson 7: proof the pack works](07-proof-the-pack-works.md).
