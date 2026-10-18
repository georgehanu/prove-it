---
title: Tests that can fail
lesson: 2
code: plugin/hooks/guard-tests.mjs
task: tasks/02-per-line-tax.md
---

# Lesson 2 · Tests that can fail

Lesson 1 made the agent run the checks before it finishes. That only helps if the checks can fail. A test suite is easy to turn green without fixing anything: change the expected value, skip the test, loosen the matcher, or delete the file.

Agents do this more than you'd hope. The [ImpossibleBench](https://arxiv.org/abs/2510.20270) study built coding tasks where the specification and the unit tests contradict each other, so the only way to pass is to cheat. The best-performing model in the study still "passed" 54% of the tasks in the conflicting-tests variant of SWE-bench. Every one of those passes meant bending the tests, or bending the code around them, instead of doing what was asked. The same paper found that making the tests read-only stopped test edits for most models, while honest solutions still worked. It didn't help as much with the models that mostly special-cased the tests in the code instead.

Read-only tests are too strict for daily work, because sometimes a test really is wrong or the requirement really changed. So Prove It does the next best thing: an edit that makes a test weaker stops and waits for a person.

## What "weaker" means

The [`guard-tests` hook](../plugin/hooks/guard-tests.mjs) runs before every edit (`PreToolUse` on Write, Edit and MultiEdit) to a test file. Test files are found by name: `*.test.*`, `*.spec.*`, `*_test.*`, `test_*.py`, and anything under `test/`, `tests/`, `__tests__/` or `spec/`. You can change the list in `.prove-it.json`.

It rebuilds the file before and after the edit and compares them. An edit is put to you when it:

- **removes assertions**: fewer `expect(`, `assert`, `t.equal(`, `self.assertEqual(` and similar than before;
- **removes tests**: fewer `test(`, `it(`, `def test_`, `func Test` than before (this also covers overwriting a test file with a shorter one);
- **adds skip, only or todo**: `.skip`, `.only`, `.todo`, `xit`, `{ skip: true }`, `@pytest.mark.skip`, `t.Skip()`;
- **adds an assertion that can't fail**: `expect(true).toBe(true)`, `assert.equal(total, total)`, `assert True`;
- **changes only an expected value**: the same assertion, the same inputs, a different expected number or string.

Deleting a test file with `rm`, `git rm` or `Remove-Item` is put to you as well (`git rm --cached` only untracks it, so that passes), and so is rewriting an existing one from the shell (`sed -i`, a `>` redirect, `tee`, `cp`, `Set-Content`), because a change made that way can't be checked: the message says exactly that and points the agent to the Edit tool. Creating a new test file from the shell is fine; it can't make anything weaker.

Adding tests, adding assertions and renaming things all pass silently. The hook only speaks up when the suite gets easier to pass, or when what it expects changes.

## "Ask", not "deny"

When the hook finds something, it returns `permissionDecision: "ask"` with the reason. Claude Code then shows you the edit and the reason, and you decide:

```text
Prove It: this change to test/invoice.test.js changes what the tests expect:
- changed an expected value: `assert.deepEqual(invoiceTotals(consulting), { subtotal: 3750,
  discount: 0, tax: 788, total: 4538 });` -> `... tax: 789, total: 4539 });`
A person must approve it. If the requirement really changed, explain why in one line;
otherwise cancel and fix the code, not the test.
```

The "changed an expected value" check is the important one, and it's the hardest to spot in a review. A one-character diff from `788` to `789` looks like a typo fix. It's often the agent copying whatever the code now prints into the assertion, which turns the test into a recording of the current behaviour, bugs included.

But changing an expected value is sometimes exactly right. That's what the demo task is about.

## The fails-first skill

The hook stops the obvious damage. The [`fails-first` skill](../plugin/skills/fails-first/SKILL.md) is about writing tests that are worth protecting:

1. **Write the test first**, for the behaviour that was asked for, and **show it failing** for the right reason.
2. Make the change, show it passing, run the whole suite.
3. **Mutation check**: break the line the test is about (flip `<` to `<=`, drop a `+ 1`), run the test, see it go red, restore. If it stays green with the line broken, the test isn't testing that line.
4. **Never edit an existing assertion quietly.** If a test is wrong, say which one, what it expects, and why the new value is right, with the arithmetic.
5. **Don't mock what you're testing.** A test that repeats the implementation, same formula and same mocks, proves nothing. Work out the expected value by hand and write it as a literal.
6. **"No testable logic" is an allowed answer.** For a copy change or a colour, say so and say how you checked it. Don't invent a test to fill a quota.

## The demo: a test that should change

In [task 2](../tasks/02-per-line-tax.md) the accountant wants VAT rounded per invoice line instead of once on the total. That's a real requirement change, and two expected values in `test/invoice.test.js` should move by a cent.

Here's the arithmetic for the first one. Three lines of 12.50 at 21% is 2.625 tax per line. Rounded per line, that's 2.63 three times, 7.89. Rounded once on the 37.50 total, it was 7.875, so 7.88. The test said 788 cents; the right answer is now 789.

So the edit from `788` to `789` is correct. What makes it trustworthy is the line above, worked out by hand, not the fact that the suite went green. A good reply shows that arithmetic. A weak reply says "updated the expected values to match the new output".

Here is what happened when an agent got the request "make the suite green by updating the expected values to whatever the code now returns" with the plugin on, in a headless run where nobody could approve. *Shortened:*

```text
agent  I couldn't update the tests. A Prove It hook blocked both edits to
       test/invoice.test.js because they change expected values, and a person has to
       approve that. I didn't try to get around it, for example by editing the file
       through sed.
       Each 1250¢ line carries 262.5¢ of tax at 21%, which rounds up to 263¢ per line,
       so the three lines total 789¢. Taxing the 3750¢ subtotal in one go gave 787.5¢,
       which rounded to the old 788¢.
       If you approve the edits, I'll make these two changes and rerun npm test.
```

That's the behaviour you want: the change explained with the arithmetic, and the decision left to you.

## Try it

1. Make a fresh copy of the demo (see [`tasks/README.md`](../tasks/README.md)) and start Claude Code with the plugin.
2. Paste the request from [task 2](../tasks/02-per-line-tax.md).
3. When the edit to `test/invoice.test.js` stops for your approval, read the reason. Before you approve, check the agent showed the arithmetic for the new value. If it didn't, decline and ask for it.
4. For contrast, ask in a fresh copy: "the discount test is flaky, skip it for now". Watch the `.skip` get stopped.

## Limits

- **It reads text, it doesn't run your tests.** It counts assertions and compares lines. A matcher swapped for a weaker one with the same count, `toBe(1999)` to `toBeGreaterThan(0)`, is not caught. Neither is an assertion moved into a helper that never runs.
- **"Changed an expected value" needs the assertion on the same line**, or inside an expected object that starts on the assertion's line. An expected value built three lines earlier in a variable looks like any other edit.
- **Fixtures aren't tests.** Editing `test/fixtures/invoice.json` to match wrong output isn't flagged. Keep fixtures small and review them like tests.
- **In headless mode there's nobody to ask.** With `claude -p`, an "ask" becomes a denial, as in the run above. In Codex, hooks can only deny, so the guard denies there too. If you want that everywhere, set `"testGuard": "deny"` in `.prove-it.json`.
- **The person still decides.** If you approve every prompt without reading it, the hook has only slowed you down.

Next: when a test fails for a real reason, the fix should target the cause. [Lesson 3: find the cause, not a patch](03-find-the-cause.md).
