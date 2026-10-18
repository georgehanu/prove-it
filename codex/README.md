# Prove It for Codex

The same hook scripts as the Claude Code plugin, wired to Codex's hook events. One difference: Codex hooks
can only **deny** a tool call, not ask you about it, so a test-weakening edit is blocked with a reason and the
agent has to tell you instead.

## Install

1. Put the repository where the hook commands expect it:

   ```bash
   git clone https://github.com/georgehanu/prove-it.git ~/.codex/prove-it
   ```

   On Windows (PowerShell): `git clone https://github.com/georgehanu/prove-it.git $env:USERPROFILE\.codex\prove-it`

2. Copy the hooks file, for every project or for one:

   ```bash
   cp ~/.codex/prove-it/codex/hooks.json ~/.codex/hooks.json             # every project
   cp ~/.codex/prove-it/codex/hooks.json your-project/.codex/hooks.json  # one project
   ```

   If you already have a `hooks.json`, merge the entries by hand.

3. Copy the skills so Codex can use them:

   ```bash
   mkdir -p ~/.agents/skills && cp -r ~/.codex/prove-it/plugin/skills/* ~/.agents/skills/
   ```

   For one project, use `your-project/.agents/skills/` instead. Invoke them with `$prove-it`, `$fails-first`,
   `$root-cause` and `$review-brief`, or let Codex pick them from their descriptions.

4. Start Codex and run `/hooks`. Codex only runs hooks you have reviewed and trusted, and it asks again
   whenever a hook changes. Read the scripts in `plugin/hooks/` before you trust them: they are short.

## What runs

| Event | Matcher | Script | Effect |
| --- | --- | --- | --- |
| PreToolUse | `apply_patch\|Bash` | `guard-tests.mjs --codex` | denies edits that weaken tests, `rm` of test files, and shell rewrites of existing ones (new test files are fine) |
| PostToolUse | `apply_patch\|Bash` | `track.mjs --codex` | records code edits and check commands with their result |
| PostToolUse | `apply_patch` | `shortcut-check.mjs --codex` | tells the agent about shortcuts in lines it just added |
| PostToolUse | `apply_patch` | `diff-budget.mjs --codex` | tells the agent when the diff passes the budget |
| Stop | | `stop-needs-proof.mjs --codex` | sends the agent back if it changed code and no check ran since, the last check failed, or checks passed but the reply has no Proof block |
| SessionStart | `compact` | `remind-after-compact.mjs --codex` | puts the five rules back after compaction |

Codex sends a shell command's output to hooks as plain text, without a separate exit code. `track` reads the
usual failure lines (`not ok`, `# fail 1`, `FAIL`, `2 failed` ...) to tell a failing run from a passing one.

State goes to your temp folder (`prove-it/sessions/`); files untouched for 7 days are deleted. `.prove-it.json` in your project works the same as in
Claude Code.

## If a hook does not fire

The `$HOME` / `%USERPROFILE%` paths in `hooks.json` are the documented way to point at the scripts, but a
live `codex exec` run on Windows was done with absolute paths. If a hook doesn't fire, check it with
`/hooks` and replace the path with an absolute one. That run confirmed the events and matchers above: a
test-weakening edit was denied, and the Stop hook sent the agent back to run `npm test`. Everything else is
covered by the fixture tests in `test/`, which use the payloads Codex sends.
