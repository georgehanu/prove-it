---
name: review-brief
description: Review brief, PR description, hand over, "ready for review", summarise the diff, code review - use when a change is finished and a person will review it. Builds a brief from git diff - intent in one sentence, files by risk, the lines to read first (file:line), what was tested and how, what was not, unrelated changes, size against the budget - and asks the fresh-eyes reviewer for an independent check.
license: MIT
---

# Review brief

Make the reviewer's job small: tell them what to read first and what you did not check.

## Steps

1. **Collect the diff.** `git status`, `git diff --stat HEAD`, `git diff HEAD`. Include new untracked files (`git ls-files --others --exclude-standard`). If there is a base branch, use `git diff <base>...HEAD` as well.
2. **Intent.** One sentence: what this change does for the user, in their words.
3. **Rank files by risk.** High: money, auth, data writes, migrations, concurrency, public APIs, anything deleted. Medium: business logic. Low: tests, docs, formatting. Give one reason per file.
4. **Lines to read first.** 3 to 7 `file:line` pointers where a mistake would hurt most, each with what to check there.
5. **Tested.** Each check with the command and result. Which requirement each test covers.
6. **Not tested.** Be specific: paths, inputs, environments.
7. **Unrelated changes.** Anything in the diff that the request did not ask for (formatting, renames, drive-by fixes, lockfile churn). Offer to split them out.
8. **Size.** Changed lines from `git diff --numstat HEAD` against the budget (400 by default, or `diffBudget` in `.prove-it.json`). Over budget: say how it could be split.
9. **Independent check.** In Claude Code, ask the `fresh-eyes` subagent: give it the user's original request word for word and nothing else of your reasoning. Elsewhere, start a fresh session with only the request and the diff.
10. **Filter the findings.** Keep a finding only if it has `file:line`, a reason, and a confidence. Drop findings without evidence and say how many you dropped. Check each kept finding yourself before you report or fix it.

## Output format

```
## Review brief
Intent: <one sentence>
Size: <n> changed lines in <k> files (budget <b>)

Files by risk
- high  <file> - <why>
- med   <file> - <why>
- low   <file> - <why>

Read first
1. <file:line> - <what to check>

Tested
- <requirement> -> `<command>` exit <code>

Not tested
- <what> (<why>)

Unrelated changes
- <file:line> - <what>  (or "none")

Independent review (fresh-eyes)
- [<high|medium|low> confidence] <file:line> - <finding> - <reason>
- Dropped <n> findings without evidence.
```
