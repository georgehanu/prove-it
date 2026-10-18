---
name: fails-first
description: Write a test, add tests, TDD, regression test, "make the test pass", failing test - use whenever you add or change tests. Red before green - show the new test failing before the fix and passing after, never edit an existing assertion silently, prove the test can fail with a quick mutation check, and say "no testable logic" when that is the honest answer.
license: MIT
---

# Fails first

A test that has never failed has never proved anything. These rules keep tests honest.

## Steps for new behaviour or a bug fix

1. **Write the test first,** against the behaviour the user asked for, not against your planned implementation. Name it after the behaviour: `ships free at exactly 50.00`, not `test calculateShipping`.
2. **Run it and show it failing.** Paste the failing line. It must fail for the right reason (wrong value, missing function), not a typo or an import error.
3. **Make the change.** The smallest change that makes the test pass.
4. **Run it again and show it passing,** then run the whole suite.
5. **Mutation check.** Break the line your test is about (flip a `<` to `<=`, change a `+ 1`, return early). Run the test. It must go red. Restore the line and run again. If the test stays green with the line broken, the test is not testing it: fix the test.

## Existing tests

- **Never change an assertion, an expected value, or a fixture just to make a test pass.** If you believe the test is wrong, stop and say: which test, what it expects, what the code now does, and why the new value is right. Let the person decide.
- Never add `.skip`, `.only`, `.todo`, `xit`, `@pytest.mark.skip` or `t.Skip` to get to green.
- Never delete a failing test. Never weaken a matcher (`toBe(1999)` to `toBeGreaterThan(0)`).
- If the requirement really changed, say so in one line next to the test change.

## Good tests

- Test behaviour through the public function or endpoint, with real inputs and exact expected outputs.
- Cover the edges the request implies: zero, one, many, the boundary, the month end, the rounding half-cent, the empty page.
- Mock only what you do not own and cannot run (network, clock, payment provider). Do not mock the code under test or its close collaborators.
- A test that repeats the implementation line by line (same formula, same mocks in the same order) proves nothing. Compute the expected value by hand and write it as a literal.

## When there is nothing to test

If a change has no testable logic (copy text, a colour, a config rename), say "no testable logic" and how you checked it instead (built it, looked at the page). Do not invent a test to fill the gap.

## Output

Report it like this:

```
Test: test/shipping.test.js "ships free at exactly 50.00"
Red:   `node --test test/shipping.test.js` exit 1: "expected 0, got 490"
Green: `node --test test/shipping.test.js` exit 0: "ok 3 - ships free at exactly 50.00"
Mutation: changed `>=` to `>` in src/shipping.js:9 -> red ("expected 0, got 490"), restored -> green
Existing assertions changed: none
```
