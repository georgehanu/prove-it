---
name: root-cause
description: Bug, error, broken, failing, flaky, regression, "it doesn't work", stack trace, debugging - use when something is wrong and the cause is not yet proven. Checkpoint, reproduce, shrink to a minimal failing case, test one hypothesis at a time with evidence in a scratch file, prove the cause before fixing, prove the fix, stop after 3 failed attempts and report.
license: MIT
---

# Root cause

Patch the cause, not the symptom. Guessing in a loop makes the code worse each round.

## Steps

1. **Checkpoint.** Before touching anything: `git stash` or a commit on a branch, or at least note the current `git rev-parse HEAD` and `git status`. You must be able to get back here.
2. **Reproduce.** Find the exact command, input or click path that shows the bug. Run it and quote the wrong output. If you cannot reproduce it, say so and ask for details; do not fix a bug you have not seen.
3. **Shrink it.** Cut the reproduction down to the smallest input that still fails. Ideally a failing test (see the fails-first skill).
4. **Hypotheses.** Write 2 to 4 possible causes in `.prove-it/debug.md` (add `.prove-it/` to `.gitignore`). For each: what you would expect to see if it were true.
5. **Test one at a time.** Add a log line, a breakpoint or a probe. Change one thing per run. Record each result next to the hypothesis: confirmed, ruled out, with the evidence line.
6. **Prove the cause.** You know the cause when you can explain the wrong output exactly, and flipping the cause on and off makes the bug come and go.
7. **Fix the cause.** The smallest change at the place where things first go wrong, not where the symptom shows.
8. **Prove the fix.** The reproduction from step 2 now gives the right output; the failing test is green; the whole suite is green. Remove the probes you added.

## Stop rule

After **3 attempted fixes** that did not work, stop. Revert to the checkpoint and report instead of trying a fourth patch:

- what you reproduced,
- the hypotheses you ruled out and how,
- what you think is left, and what you need (access, data, a decision).

## Red flags

- "This is a known bug in library X" based on one old issue. Ask for matching symptoms and the version.
- A confident cause that would require rewriting a large part of the code. Prove it on the small case first.
- The fix wraps the failing call in a try/catch, adds a retry, or special-cases the failing input. That hides the bug.

## The scratch file

```
# debug: customer search finds nothing for "Zoë"
Repro: `curl "localhost:3000/api/customers?q=zoe"` -> [] (expected 1 result)
H1 the query is not lower-cased -> ruled out: logged q = "zoe" at src/search.js:12
H2 stored names keep the accent, the query has none -> confirmed: name = "Zoë", "zoë".includes("zoe") is false
H3 the index is stale -> ruled out: same result after a rebuild
Fix: compare with accents removed (normalize("NFD") + strip marks) at src/search.js:14
Proof: test "finds Zoë when searching zoe" red before, green after; npm test exit 0
```

## Output

End with: cause (one sentence, with file:line), the evidence that proves it, the fix, and the proof the fix works (command, exit code, output line).
