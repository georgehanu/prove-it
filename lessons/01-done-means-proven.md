---
title: Done means proven
lesson: 1
code: plugin/hooks/stop-needs-proof.mjs
task: tasks/01-late-fee.md
---

# Lesson 1 · Done means proven

You ask for a change. The agent edits three files and says "Done! The late fee is implemented and handles all edge cases." It reads well. Then you run the tests, or you open the page, and it's almost right: the fee is off for invoices that are one day late, and the README line you asked for isn't there.

That gap is the most common complaint about AI coding tools. In the [Stack Overflow 2025 Developer Survey](https://survey.stackoverflow.co/2025/ai), 66% of developers cited "AI solutions that are almost right, but not quite" as a frustration, more than any other. And the habit that would catch it is rare: in [Sonar's 2026 State of Code survey](https://www.sonarsource.com/blog/state-of-code-developer-survey-report-the-current-reality-of-ai-coding/), 96% of developers said they don't fully trust AI-generated code, yet only 48% said they always verify it before committing.

So most of us know we should check, and about half of us do it every time. This lesson makes the agent do the first round of checking for you, every time, and show its work.

## The idea: "done" is a claim that needs evidence

When a colleague says "it's done", you trust it because you know what they did to get there. With an agent, you see a confident summary and a diff. The summary is generated text. It can say "all tests pass" whether or not a test ran.

So we change the definition of done. Done means:

1. the checks ran **after the last edit**, and passed, and
2. every part of the request points to evidence, or says plainly that it isn't done or wasn't checked.

Two pieces of Prove It work together on this. A **hook** enforces what code can check: the agent cannot finish after editing code until a check has passed since its last edit, and its reply ends with a Proof block. A **skill** shapes what goes in that block: one line of evidence per requirement, so the reader can verify it.

## The Stop hook

Claude Code runs a `Stop` hook whenever the agent is about to finish its turn. The hook can block that and send the agent back with a reason. Prove It's [`stop-needs-proof.mjs`](../plugin/hooks/stop-needs-proof.mjs) uses a small event log that another hook, [`track.mjs`](../plugin/hooks/track.mjs), keeps for each session:

- every edit to a code file (docs, JSON config, lockfiles and anything in `node_modules` or `dist` are ignored), and
- every check command with its result: `npm test`, `pnpm lint`, `npx tsc`, `pytest`, `go test`, `cargo test` and friends, plus any test-like script in your `package.json`.

When the agent tries to stop, the hook looks at what happened since the last time it was allowed to stop:

- **No code edits since it was last allowed to stop?** Fine, stop. A turn that only answers a question needs no proof.
- **Edits, then a passing check, and the reply ends with a Proof block?** Fine, stop.
- **Edits and no check since the last one?** Blocked, with the files and the checks it found:

```text
Prove It: you changed src/fees.js and no check has run since the last edit.
Run the project's checks (found: npm test) and show the result, then end with
a "## Proof" block. If you cannot run checks, say exactly what you did not
verify under "Not verified:".
```

- **The last check failed?** Blocked: `Prove It: the last check failed: npm test (Exit code 1)`. The reason asks it to fix the cause, run the check again and end with a Proof block.
- **The checks passed, but the reply has no Proof block?** Blocked once, with a pointer to the format:

```text
Prove It: the checks passed (`npm test`), but your reply has no Proof block.
End it with a "## Proof" section (plain markdown, not inside a code block) in
the prove-it skill's format: one line per requirement -> its evidence (command,
exit code, the output line that proves it), a "Checks:" line, and a
"Not verified:" line for anything you did not check.
```

The hook counts a Proof block when the reply has a markdown heading whose text is "Proof" (`## Proof`, `### proof:`, any level, any case), or `**Proof**` alone on its line, outside code blocks. "Here is proof that it works" doesn't count, and neither does a `## Proof` the agent quotes inside a code block. If you don't want this rule, set `"requireProof": false` in `.prove-it.json`; the check rules stay on.

Two rules keep it from becoming a nuisance. Each reason blocks at most once per stop: the agent can be sent back to run the checks and then once more for the Proof block, but never twice for the same thing, so it can never loop. And there's an honest way out: a real `Not verified:` section in the last message. Sometimes the agent genuinely can't run the checks, because the database isn't there or you told it not to. Then it should say what is unverified, and the hook accepts that instead of a passing check. `Not verified: none` doesn't count. Once the checks have passed, there's nothing to escape from: the `Not verified:` line goes inside the Proof block.

A detail that matters more than it looks: `npm test | tail -20` reports the exit code of `tail`, not of the tests, and agents pipe output like that all the time. So when a command has a pipe, `;` or `||`, `track` also reads the output for the usual failure lines (`not ok`, `# fail 1`, `2 failed`, `FAIL`) before it counts the run as passing.

## The prove-it skill

The hook makes sure something ran and that the reply has a Proof block. The [`prove-it` skill](../plugin/skills/prove-it/SKILL.md) makes that block useful. Claude loads a skill when it judges it relevant, so it may not load on its own; the hook's message names it, and you can always ask for it with `/prove-it:prove-it`. It asks the agent to:

1. list each requirement from your request, including the small ones;
2. find and run the project's checks after its last edit;
3. map each requirement to evidence: the command, the exit code, and the line of output that proves it;
4. put everything it didn't do or couldn't check under "Not verified:", with the reason.

The output is a fixed block at the end of the reply:

```text
## Proof
- Late fee is 2% per started month -> `node --test test/fees.test.js` exit 0: "ok 2 - one day late is one month"
- Capped at 10% -> `node --test test/fees.test.js` exit 0: "ok 4 - caps at 10%"
- README line -> not done, because I could not find where fees are documented
- Checks: `npm test` exit 0 (23 passed, 0 failed)
- Not verified: invoices with a discount (no test for that combination)
```

The point isn't the formatting. It's that every line can be checked by you in seconds, and the gaps are written down instead of hidden behind "should work".

## Before and after

*An illustrative exchange, shortened.* Same request, a quick edit to the pagination helper. Without Prove It:

```text
you    Make paginate() also return from and to (e.g. "showing 11-20"). Keep it quick.
agent  [edits src/paginate.js]
agent  Done! paginate() now returns `from` and `to` alongside the page items.
```

With Prove It:

```text
agent  [edits src/paginate.js]
agent  Done! paginate() now returns `from` and `to`.
hook   Prove It: you changed src/paginate.js and no check has run since the last edit. ...
agent  [runs npm test]  # tests 17  # pass 17  # fail 0
agent  ## Proof
       - paginate() returns from/to -> edited src/paginate.js; existing tests still pass
       - Checks: `npm test` exit 0 (17 passed, 0 failed)
       Not verified:
       - the from/to values themselves: no test asserts them yet
```

The second reply is less satisfying to read and much more useful. It tells you the suite is green and that the new fields have no test, which is exactly what you need to know before you merge.

## Try it

1. Copy only the `demo/` folder to a temp folder and make it a git repo (the commands are in [`tasks/README.md`](../tasks/README.md)).
2. Open Claude Code there **without** the plugin and paste the request from [task 1, the late fee](../tasks/01-late-fee.md). Paste only the request: the task file stays outside the copy because it also lists what a proven answer shows, and an agent that reads the checklist first makes the comparison meaningless.
3. Make a fresh copy, start Claude Code with the plugin (`claude --plugin-dir path/to/prove-it/plugin`, or install it), and paste the same request.
4. Compare the endings. Press Ctrl+O to see the hook's messages.

What to expect. Without the pack, the agent may or may not run the tests, and it usually ends with a summary: you work out for yourself whether each part of the request, the README line included, got done. With the pack, the hooks guarantee two things the model can't skip quietly: it can't finish until a check has passed after its last edit, and if its reply has no Proof block it's sent back for one that maps each requirement, the README line included, to evidence. The hook asks for that mapping; whether every line holds up is what you read, and the block puts the gaps on the page instead of hiding them in a summary.

## Limits

Be clear about what a hook can and can't know.

- **It knows a check ran, not that the check covers the change.** A green suite with no test for the late fee still passes the hook. That's why the skill asks for evidence per requirement, and why lesson 2 is about tests that can fail.
- **It knows a Proof block is there, not that it's true.** The hook checks for the heading. Whether each line quotes real output and every requirement has a line is for you to read; the block makes that a quick read.
- **It only sees edits made through the edit tools.** A file changed with `sed -i` in the shell isn't recorded as a code edit.
- **It recognises common check commands, where they run.** `npm test` counts when it is the command being run (also after `cd x &&`, `CI=1` or `npx`); `echo npm test`, `grep "npm test"` or a commit message saying the tests pass don't. If yours is `just ci` or `./scripts/ci.sh`, add it to `checks` in `.prove-it.json` (lesson 7).
- **The escape hatch is text.** An agent could write "Not verified: the tests" to get out. It then has to admit it in writing, in front of you, which is the point.
- **A side question can be blocked once.** If code was edited and no check has run since (you interrupted that turn, say), the next stop is blocked once even when the agent only answered a question, because the hook looks at everything since the last allowed stop and that edit still has no check behind it.
- **One block per stop.** If the agent ignores the reason and stops again, it's allowed through. The hook makes skipping visible; it doesn't make it impossible.

Next: a green suite only means something if the tests can fail. [Lesson 2: tests that can fail](02-tests-that-can-fail.md).
