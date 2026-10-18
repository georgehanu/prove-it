# Prove It

**Your coding agent says it's done. Make it prove it.**

By George Hanu · [@georgehanu](https://x.com/georgehanu) · [Read the lessons as a website](https://georgehanu.github.io/prove-it/)

A Claude Code plugin (four skills, six small hooks, one reviewer subagent) and seven short lessons. Install it with two commands and keep working. From then on your agent:

1. can't finish after editing code without a passing check, and ends with a Proof block,
2. can't quietly weaken a test: that edit waits for you,
3. finds the root cause before it patches,
4. is told about every shortcut it just took, with `file:line`,
5. hands over a diff with a brief that says what to read first.

## Install

**Claude Code**, inside a session:

```text
/plugin marketplace add georgehanu/prove-it
/plugin install prove-it@prove-it
```

Then `/reload-plugins` (or restart). To try it for one session without installing: clone this repo and run `claude --plugin-dir ./prove-it/plugin`.

**Codex, Cursor and other agents.** The skills follow the Agent Skills format. Copy them into a project or your home folder:

```bash
cp -r plugin/skills/* your-project/.agents/skills/   # one project
cp -r plugin/skills/* ~/.agents/skills/              # every project
```

Codex can also run the hooks: see [`codex/README.md`](codex/README.md) (test-weakening edits are denied rather than put to you, since Codex hooks can't ask). For tools without hooks, paste [`AGENTS.md.snippet`](AGENTS.md.snippet) into your `AGENTS.md`: the same five rules as plain instructions, which an agent can still ignore.

## What you get

| Piece | Type | What it stops |
| --- | --- | --- |
| [`stop-needs-proof`](plugin/hooks/stop-needs-proof.mjs) | Stop hook | finishing after a code edit with no check run since, with the last check failing, or with passing checks but no Proof block in the reply |
| [`track`](plugin/hooks/track.mjs) | PostToolUse hook | (records code edits and check results for the Stop hook; silent) |
| [`guard-tests`](plugin/hooks/guard-tests.mjs) | PreToolUse hook | removed assertions, `.skip` / `.only`, trivial assertions, changed expected values, deleted test files, existing tests rewritten from the shell: put to you first |
| [`shortcut-check`](plugin/hooks/shortcut-check.mjs) | PostToolUse hook | empty catch, `@ts-ignore`, `as any`, test-only branches, TODOs, debug logs, faked returns going unmentioned |
| [`diff-budget`](plugin/hooks/diff-budget.mjs) | PostToolUse hook | a diff growing past 400 lines without anyone noticing |
| [`remind-after-compact`](plugin/hooks/remind-after-compact.mjs) | SessionStart hook | the rules getting lost when a long session is compacted |
| [`prove-it`](plugin/skills/prove-it/SKILL.md) | skill | "Done!" without evidence: the Proof block format, every requirement mapped to evidence |
| [`fails-first`](plugin/skills/fails-first/SKILL.md) | skill | tests that never failed, mock-heavy tests, invented tests |
| [`root-cause`](plugin/skills/root-cause/SKILL.md) | skill | patching the symptom; a fourth random fix after three failed ones |
| [`review-brief`](plugin/skills/review-brief/SKILL.md) | skill | handing over a diff with no idea where to start reading |
| [`fresh-eyes`](plugin/agents/fresh-eyes.md) | subagent | reviewing your own change through your own reasoning |

The hooks are plain Node.js (22+), no dependencies, no network calls. They fail open: if a hook breaks, your agent carries on and the error is logged. Context cost: about 600 tokens per session for the skill and agent descriptions; the hooks add nothing unless they have something to say.

## Read it before you install it

Skills are prompts that run with your agent's permissions, and hooks are programs that run on every tool call. Read them first. This pack is short on purpose:

- `plugin/skills/*/SKILL.md`: four files, each under 120 lines, none pre-approving tools
- `plugin/agents/fresh-eyes.md`: the read-only reviewer
- `plugin/hooks/hooks.json`: which script runs on which event
- `plugin/hooks/*.mjs`: the scripts and their shared `lib.mjs`
- `codex/hooks.json`: the same scripts wired for Codex

## The lessons

| # | Lesson | Piece |
| --- | --- | --- |
| 1 | [Done means proven](lessons/01-done-means-proven.md) | Stop hook + `prove-it` |
| 2 | [Tests that can fail](lessons/02-tests-that-can-fail.md) | `guard-tests` + `fails-first` |
| 3 | [Find the cause, not a patch](lessons/03-find-the-cause.md) | `root-cause` |
| 4 | [Catch the shortcuts](lessons/04-catch-the-shortcuts.md) | `shortcut-check` |
| 5 | [A diff someone can review](lessons/05-a-diff-someone-can-review.md) | `review-brief` + `fresh-eyes` + `diff-budget` |
| 6 | [Rules it can't ignore](lessons/06-rules-it-cant-ignore.md) | skills vs hooks vs AGENTS.md; write your own hook |
| 7 | [Proof the pack works](lessons/07-proof-the-pack-works.md) | the test suite, the demo, tuning |

Each lesson uses [`demo/`](demo/), a small invoicing module, and one of five requests in [`tasks/`](tasks/README.md) where agents tend to come back "almost right". Copy only `demo/`, paste the request, and compare runs with and without the plugin. The task files stay out of the copy because they describe what a proven answer shows.

## Proof it works

```bash
npm test
```

Runs every hook against inputs shaped like the ones Claude Code and Codex send (stdin JSON, temp projects, git repos): more than a hundred cases, in under half a minute. No install needed.

## Config

Optional `.prove-it.json` in your project root:

```json
{
  "checks": ["\\bnpm (run )?test\\b", "\\bmake verify\\b"],
  "testGlobs": ["**/*.test.*", "e2e/**"],
  "diffBudget": 600,
  "testGuard": "ask",
  "requireProof": true,
  "disable": ["shortcut-check"]
}
```

`checks` replaces the built-in list of check commands; `testGuard: "deny"` refuses test-weakening edits instead of asking; `requireProof: false` stops the Stop hook asking for a Proof block once checks pass. All keys, including `codeGlobs` and `ignoreGlobs`, are in [lesson 7](lessons/07-proof-the-pack-works.md#3-tune-it-prove-itjson).

## Turn it off

- One hook: `"disable": ["guard-tests"]` in `.prove-it.json` (or `"all"`)
- The plugin: `/plugin disable prove-it@prove-it`
- Remove it: `/plugin uninstall prove-it@prove-it`

## License

MIT. Use it, fork it, change the rules. A link back is appreciated.
