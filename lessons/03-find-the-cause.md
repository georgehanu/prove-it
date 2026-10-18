---
title: Find the cause, not a patch
lesson: 3
code: plugin/skills/root-cause/SKILL.md
task: tasks/03-missing-last-page.md
---

# Lesson 3 · Find the cause, not a patch

A bug report comes in. You paste it to the agent. It reads two files, says "I found the issue", and changes something. The report goes away. A week later a different report comes in, caused by that change.

Debugging is where agents waste the most of your time, because a plausible patch is cheap to generate and expensive to check. In the [Stack Overflow 2025 Developer Survey](https://survey.stackoverflow.co/2025/ai), 45% of developers said "debugging AI-generated code is more time-consuming". Part of that is that the agent's fix often treats the symptom: it special-cases the input from the report, adds a retry, or wraps the failing call in a try/catch.

There's no hook for "think before you patch". This lesson is a skill, a written procedure the agent follows when something is broken.

## The root-cause skill

The [`root-cause` skill](../plugin/skills/root-cause/SKILL.md) is eight steps and a stop rule. The steps are ordinary debugging discipline, written down so the agent can't skip them:

1. **Checkpoint.** Commit or stash before touching anything, or at least note the commit and `git status`. Every later step is an experiment, and experiments need a way back.
2. **Reproduce.** Find the exact command or input that shows the bug, run it, and quote the wrong output. No reproduction, no fix: ask for details instead.
3. **Shrink it.** Cut the input down to the smallest case that still fails. Ideally that becomes the failing test.
4. **Hypotheses.** Write two to four possible causes in a scratch file, `.prove-it/debug.md` (gitignored), each with what you'd expect to see if it were true.
5. **Test one at a time.** One probe or one change per run. Write the result next to the hypothesis: confirmed or ruled out, with the evidence.
6. **Prove the cause.** You've found it when you can explain the wrong output exactly and switching the cause on and off makes the bug come and go.
7. **Fix the cause**, at the place where things first go wrong, not where the symptom shows.
8. **Prove the fix.** The reproduction now gives the right answer, the new test is green, the whole suite is green, and the probes are gone.

And the stop rule: **after three fixes that didn't work, stop.** Revert to the checkpoint and report what was reproduced, what was ruled out, and what's needed. The fourth patch in a row is rarely the one that works. It's usually built on top of the first three, which were wrong.

### Why a scratch file

Writing hypotheses down sounds like ceremony. It does two jobs. It keeps the agent from going round in circles, because "H2: ruled out, the UI sends page=1" is on the page and won't be tried again ten minutes later. And it gives you a record you can read in thirty seconds when the agent comes back with a fix: which causes were considered, and what evidence settled each one.

It also survives compaction. Long debugging sessions are exactly the ones where the conversation gets summarised and details get lost. A file on disk doesn't.

### Red flags the skill names

- **"This is a known bug in library X"**, based on one old issue. Ask for matching symptoms and the version you're on.
- **A confident cause that needs a big rewrite.** Prove it on the small case first. Rewrites are expensive to review and often move the bug instead of fixing it.
- **A fix that hides the failure**: try/catch around the call, a retry, or an `if` for the exact input from the report. Lesson 4's hook catches some of these after the fact. The skill tries to stop them being written.

## The demo: the missing last page

[Task 3](../tasks/03-missing-last-page.md) is a real-looking bug report: *"I have 25 invoices but the list only ever shows 20. There's no page 3."*

The tests in the demo pass. They only cover a list of exactly 20 invoices, which is why the bug got through. That's typical: the report is the first evidence you have.

A patch that makes the report go away without finding the cause looks like this:

```js
// "Fix": always add a page
const totalPages = Math.floor(items.length / perPage) + 1;
```

25 invoices now show three pages. 20 invoices also show three pages now, the last one empty. Nobody tests that case, so it ships.

Following the skill, the reply looks different:

```text
Repro: paginate(25 items, page 3, 10 per page) -> items: [], totalPages: 2
H1 totalPages rounds down -> confirmed: Math.floor(25 / 10) = 2 at src/paginate.js:4
H2 pages start at 0 somewhere -> ruled out: (page - 1) * perPage gives 20 for page 3, correct
Fix: Math.ceil at src/paginate.js:4
Proof: new test "25 items make 3 pages, the last has 5" red before, green after
       existing "20 items make 2 pages" still green; npm test exit 0
Edge: 0 items -> totalPages 0, page 1 empty, hasNext false (stated and tested)
```

Seven lines, and you can check each one. The cause is named with `file:line`. The fix is one character. The edge cases that a careless fix would break are in the test suite now.

The empty-list case is worth a moment. With `Math.ceil`, zero invoices gives zero pages, and the page asks for page 1 of 0. Is that right? It depends on your UI. The skill doesn't answer that for you. It makes the agent notice the question and say what it chose, which is the part you'd otherwise discover in production.

## Try it

1. Make a fresh copy of the demo (see [`tasks/README.md`](../tasks/README.md)).
2. Paste the bug report from [task 3](../tasks/03-missing-last-page.md) to your agent **without** the plugin. Count the edits, and check whether the reply names the line that caused the bug.
3. Make a fresh copy, start Claude Code with the plugin, and paste the report again. To be sure the skill loads, ask for it by name: `/prove-it:root-cause` followed by the report.
4. Compare the two diffs. Then add 20 invoices to each version and check page 3.

In Codex, copy the skills to `.agents/skills/` and start with `$root-cause`.

## Limits

- **A skill is instructions, not enforcement.** Nothing stops the agent from skipping the reproduction. You'll see it skipped, though: there's no quoted wrong output and no `debug.md`. The Stop hook from lesson 1 still makes sure the final suite ran.
- **Skills load when the request matches the description**, and matching is fuzzy. "Fix this" might not trigger it, while "bug", "broken" and "error" usually do. Ask for it by name when it matters.
- **Some bugs don't reproduce on demand**: race conditions, data that only exists in production. The skill's answer is to stop and ask for what's needed, which is correct but not satisfying.
- **The three-attempt rule counts attempts the agent admits to.** If the session is long and messy, the count gets fuzzy. The checkpoint from step 1 is what saves you either way.

Next: fixes that hide a failure are one kind of shortcut. [Lesson 4: catch the shortcuts](04-catch-the-shortcuts.md).
