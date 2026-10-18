---
title: Proof the pack works
lesson: 7
code: test/hooks.test.mjs
---

# Lesson 7 · Proof the pack works

A pack that tells your agent to prove its work had better prove its own. And there's a good reason not to trust your impression of any AI tool, this one included: in [METR's 2025 randomised trial](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/), experienced open-source developers took 19% longer on tasks when they used AI tools, while estimating afterwards that the tools had made them about 20% faster. METR has since published updated 2026 data, and the study page now says the 2025 results are out of date, so read them as a warning about impressions, not as a current speed number. The warning still stands: how a tool feels and what it does can point in opposite directions.

So this lesson gives you three ways to check Prove It: a test suite you can run in seconds, the demo tasks run with and without the plugin, and the knobs to tune or switch off each piece in your own projects.

## 1. Run the test suite

```bash
git clone https://github.com/georgehanu/prove-it.git
cd prove-it
npm test
```

No install step: the suite uses Node's built-in test runner and the hooks have no dependencies. You need Node 22 or newer. It takes under half a minute and prints more than a hundred passing tests.

There are two files:

- [`test/hooks.test.mjs`](../test/hooks.test.mjs) runs every scenario in [`test/fixtures/`](../test/fixtures/) against the real hook scripts. Each scenario gets a fresh temp project and a fresh state folder, feeds one or more JSON inputs to the hooks over stdin, exactly as Claude Code does, and checks the output: silent, `block`, `ask`, `deny`, and which words the reason contains.
- [`test/lib.test.mjs`](../test/lib.test.mjs) unit-tests the shared rules: which files count as code or tests, which commands count as checks, the Proof-block reader, path handling, the line diff, the Codex patch parser, session keys and the clean-up of old session files. One test also checks that guard-tests decides on the path before it reads a file.

The scenarios cover each decision a hook can make (block, ask, deny, add a note, stay silent), each `.prove-it.json` key, and inputs that should trigger nothing. They don't cover every command or edit an agent could come up with; the Limits section of each lesson lists the gaps I know of. What's in the fixtures:

- `stop-needs-proof`, fed by `track`: no edits; edits then a passing check; passing checks but no Proof block (blocked once), a `## Proof` heading at any level, `**Proof**` in bold, a sentence that only mentions proof, a `## Proof` inside a code block, `requireProof: false`, a Codex payload; a failing check reported as `PostToolUseFailure`; a check that ran before the last edit; `stop_hook_active` (from another hook, or after our own block for the same reason); checks then Proof block in one stop; the `Not verified:` escape hatch and the fake one (`Not verified: none`); `npm test | tail` hiding a failure; `npm test && echo OK || echo FAIL`; a background run; checks that count only where they run (`echo npm test`, `grep "npm test"`, a commit message, `--help` and `--listTests` don't; `cd pkg && npm test`, `CI=1 npx vitest run`, `pnpm -r test`, `./gradlew test`, `bundle exec rspec`, PowerShell's `npm test; "exit=$LASTEXITCODE"` and others do); custom `checks`, `codeGlobs` and `ignoreGlobs`; inputs without a `session_id`; Windows paths with a lower-case drive letter.
- `guard-tests`: a new test (silent); removed assertions; `.skip`, `.only`, `{ skip: true }`, `@pytest.mark.skip`, `t.Skip`; `expect(true).toBe(true)`; one expected value changed; several changed in one object; an edit to fixture data (silent); a file overwritten with fewer tests; `codeGlobs` that leave the tests out (still guarded); `rm`, `git rm`, `Remove-Item` and `sed -i` on test files; `git rm --cached` and a test path that only appears inside quotes (silent); a new test file created from the shell with a heredoc, `tee`, `cp` or `Set-Content` (silent) next to the same commands overwriting an existing one (asks); `rm -rf node_modules` (silent); a CRLF file; Codex patches.
- `shortcut-check`: each pattern; line numbers from Write, Edit, MultiEdit and Codex patches; the same words in comments and strings (silent) next to suppressions and TODOs in comments (flagged); test files and markdown (skipped).
- `diff-budget`: the once-per-threshold rule, untracked files, the cap on untracked files, and `node_modules` and `ignoreGlobs` never being read.
- `remind-after-compact`: after compaction, a normal start, and the `disable` switch (also tested for the Stop hook, guard-tests, shortcut-check and `"all"`).

When you change a rule, add a scenario first and watch it fail. The fixtures are plain JSON; copy one and edit it.

## 2. Run the demo tasks, with and without

The tests prove the hooks make the right decision for a given input. They don't prove an agent behaves better. For that, run the [demo tasks](../tasks/) yourself (setup in [`tasks/README.md`](../tasks/README.md)). Each takes a few minutes:

1. Copy only `demo/` to a temp folder, `git init`, commit. Do this twice. The task files stay outside the copy: they list what a proven answer shows, and an agent that reads that first makes the comparison worthless.
2. In the first copy, start your agent **without** Prove It and paste only a task's request.
3. In the second, start it **with** Prove It (`claude --plugin-dir path/to/prove-it/plugin`, or installed) and paste the same request.
4. Compare the endings against the task's "What a proven answer looks like" list. Did it run the checks after its last edit? Did the reply map each requirement to evidence? Did a test change get past you?

Run each pair more than once if you can. Agents vary from run to run; one good run without the plugin, or one bad run with it, tells you little.

### What a headless run does

You can script the comparison with `claude -p` (non-interactive). Two things behave differently there, and it's worth knowing before you read the results:

- **The Stop hook works the same.** The agent is sent back with the reason, runs the checks, and is asked to end with a Proof block, or with a "Not verified:" section if you told it not to run anything. Each reason blocks at most once per stop: sent back for the checks, then once more if the Proof block is still missing, never a third time for the same thing.
- **"Ask" becomes "deny".** Nobody is there to approve, so a test-weakening edit is refused, and the agent has to explain in its reply what it wanted to change and why. That's usually what you want in CI anyway.

Add `--debug-file hooks.log` to see every hook decision. The per-session event log that the Stop hook reads is at `<CLAUDE_PLUGIN_DATA>/sessions/<session id>.events.jsonl`, where `CLAUDE_PLUGIN_DATA` is the plugin's folder under `~/.claude/plugins/data/`. Files untouched for 7 days are deleted.

## 3. Tune it: `.prove-it.json`

Put a `.prove-it.json` in your project root. Every key is optional:

```json
{
  "checks": ["\\bnpm (run )?test\\b", "\\bmake verify\\b"],
  "testGlobs": ["**/*.test.*", "e2e/**"],
  "codeGlobs": ["src/**/*.{js,ts,tsx}"],
  "ignoreGlobs": ["**/node_modules/**", "**/generated/**"],
  "diffBudget": 600,
  "testGuard": "ask",
  "requireProof": true,
  "disable": ["shortcut-check"]
}
```

| Key | Default | What it does |
| --- | --- | --- |
| `checks` | built-in list | Regexes for commands that count as a check. When set, they **replace** the built-in list, and the Stop hook's message lists them. They are matched against the command with quoted text, heredoc bodies and `-m`/`-e` arguments removed, and against each part between `&&`, `;` and pipes, so `^make verify` also matches `cd api && make verify`, and `git commit -m "make verify"` matches nothing. |
| `testGlobs` | `*.test.*`, `*.spec.*`, `*_test.*`, `test_*.py`, `test/`, `tests/`, `__tests__/`, `spec/` ... | Which files guard-tests protects. Replaces the default list. |
| `codeGlobs` | common code extensions | Which edits count as code for the Stop hook and shortcut-check. It doesn't narrow `testGlobs`: a test outside `codeGlobs` is still guarded. |
| `ignoreGlobs` | `node_modules`, `dist`, `build`, `coverage`, `vendor`, `.git`, `*.min.js` | Never treated as code. Replaces the default list. |
| `diffBudget` | `400` | Changed lines (against `HEAD`, plus new files) before the budget note. New untracked files count up to 200 files and 2 MB, never inside `ignoreGlobs`, `node_modules`, `dist`, `build`, `.next`, `vendor` or `target`; the note says when some were left out. |
| `testGuard` | `"ask"` | `"deny"` refuses weakening edits instead of asking. |
| `requireProof` | `true` | Once checks have passed, the Stop hook also wants a Proof block in the reply (a heading named "Proof", or `**Proof**` on its own line). `false` turns off only this rule; the check rules stay on. |
| `disable` | `[]` | Hook names to switch off, or `"all"`. |

A glob without a `/` matches the file name anywhere, like `.gitignore`. The file is read on every hook call, so changes apply straight away. If it isn't valid JSON, the defaults are used and the error is logged.

## Turning things off

- **One hook, one project:** `"disable": ["diff-budget"]` in `.prove-it.json`. The names are `track`, `stop-needs-proof`, `guard-tests`, `shortcut-check`, `diff-budget` and `remind-after-compact`. Disabling `track` leaves the Stop hook with nothing to read, so it stays quiet too.
- **Everything, one project:** `"disable": ["all"]`.
- **The plugin, for now:** `/plugin disable prove-it@prove-it`, and `/plugin enable prove-it@prove-it` to bring it back.
- **For good:** `/plugin uninstall prove-it@prove-it`. The state folder can be deleted; it holds only the per-session logs.

## What's left to you

The pack makes the agent run checks, protects the tests, flags shortcuts, and hands you a brief. It can't decide whether a test checks the right thing, whether the root cause is really the root cause, or whether the change is what your users needed. Those are still your calls. The aim is that you spend your review time on them, and not on finding out whether the tests were run.

If the pack helped, or got in your way, I'd like to hear which piece and why.
