---
title: A diff someone can review
lesson: 5
code: plugin/skills/review-brief/SKILL.md
task: tasks/05-month-end-terms.md
---

# Lesson 5 · A diff someone can review

The agent finished. The checks passed. Now a person has to read the change, and that's where the time goes. Agents write fast and they write a lot: a three-line fix arrives with a reformatted file, two renamed helpers and a new utility nobody asked for.

The numbers say this is the new bottleneck. [Faros AI's 2026 "Acceleration Whiplash" report](https://faros.ai/research/ai-acceleration-whiplash), built on telemetry from about 22,000 developers, compares low and high AI adoption within the same organisations. Its headline figures: pull requests 51% bigger, median review time five times longer, and 28% more bugs per PR. Bigger diffs, read more slowly, with more in them to miss.

You can't make review free. You can make it start in the right place. This lesson has three pieces: a budget that notices when a diff is getting too big, a brief that tells the reviewer where to look, and a second reviewer with fresh eyes.

## diff-budget: notice early

The [`diff-budget` hook](../plugin/hooks/diff-budget.mjs) runs after each edit. In a git repository it adds up changed lines against `HEAD` with `git diff --numstat`, plus the lines of new untracked files (up to 200 files and 2 MB, never inside `node_modules`, `dist`, `build` and the like; the note says when it left some out). When the total passes the budget (400 lines by default), it tells the agent once:

```text
Prove It: the working tree now has 412 changed lines against HEAD (budget 400).
A diff this size is hard to review in one pass. Before going further, check: can
this be split into smaller changes? Are there unrelated edits to undo? If it has
to be this big, say why in your summary and hand over a review brief.
```

It speaks again only at the next multiple (800, 1200...), and again after the diff has shrunk and grown back. It doesn't nag on every edit. Set your own number with `diffBudget` in `.prove-it.json`.

Why tell the agent and not you? Because the agent is the one who can still change direction cheaply. At 400 lines it can stop reformatting, undo the drive-by rename, or propose splitting the work. At the end, all it can do is apologise.

## review-brief: where to look first

The [`review-brief` skill](../plugin/skills/review-brief/SKILL.md) turns the diff into a one-screen brief for a human:

```text
## Review brief
Intent: invoices can use "net-1-month" terms, due the same day next month or that month's last day.
Size: 46 changed lines in 2 files (budget 400)

Files by risk
- high  src/dates.js - date arithmetic used for every due date
- low   test/dates.test.js - new tests only

Read first
1. src/dates.js:31 - clamping to the last day: check February and leap years
2. src/dates.js:27 - month arithmetic: check December rolls into the next year

Tested
- month-end clamping -> `npm test` exit 0 ("ok 7 - 31 Jan is due 28 Feb")
- time zone -> `TZ=America/Los_Angeles npm test` exit 0

Not tested
- terms on invoices created before this change (no migration in scope)

Unrelated changes
- none

Independent review (fresh-eyes)
- [medium] src/dates.js:29 - daysInMonth called with a 0-based month - the call passes month + 1, checked: fine
- Dropped 1 finding without evidence.
```

Each section answers a question a reviewer has. *What is this for?* Intent. *Where can it hurt?* Files by risk. *Where do I start?* Read first, with `file:line`. *What can I stop worrying about?* Tested, with commands. *What do I still have to think about?* Not tested. *Is anything sneaking in?* Unrelated changes.

The "Read first" list is the heart of it. A reviewer who reads those three lines carefully and skims the rest does a better review than one who reads 400 lines at the same speed.

## fresh-eyes: a second reader without the author's story

The agent that wrote the code is the worst one to review it. It knows what it meant to do, and it reads its diff through that. The skill's last step hands the change to the [`fresh-eyes` subagent](../plugin/agents/fresh-eyes.md), which starts with an empty context and gets only the user's original request, word for word.

fresh-eyes is deliberately narrow:

- **Read-only.** It has Read, Grep, Glob and Bash, and its instructions limit Bash to `git diff`, `git status`, `git log`, `git show` and `git ls-files`.
- **The diff is the scope.** It opens other files only to understand a changed line.
- **Evidence or nothing.** Every finding needs `file:line`, a reason and a confidence. Before claiming, say, that a secret was committed, it has to check `git ls-files` and `.gitignore`.
- **Request coverage first.** It goes through the request sentence by sentence: done, missing, or partly done.

And the brief filters its findings again. A finding without a line and a reason is dropped, and the brief says how many were dropped. That rule exists because automated reviewers are confidently wrong often enough to cost you time. A false "critical" finding sends you hunting for a problem that isn't there. A reviewer's claims need receipts too.

## Try it

1. Make a fresh copy of the demo **and commit it** (see [`tasks/README.md`](../tasks/README.md)). The budget and the brief both read `git diff`.
2. To see the budget fire on a small task, add a `.prove-it.json` with `{ "diffBudget": 30 }`.
3. Start Claude Code with the plugin and paste the request from [task 5](../tasks/05-month-end-terms.md). It ends with "write a review brief for me", which loads the skill. You can also run `/prove-it:review-brief` yourself.
4. Read only the "Read first" lines, then decide whether you'd merge. Then read the whole diff and see whether you'd have decided differently.

## Limits

- **The budget counts lines, not risk.** A 20-line change to how money is rounded can matter more than 600 lines of tests. Lines are a cheap signal that a change is getting hard to review, nothing more.
- **Generated files and lockfiles count** if they're tracked. Exclude them from git diff with a `.gitattributes` entry like `package-lock.json -diff`, or raise the budget.
- **No git, no budget.** Outside a repository the hook does nothing.
- **fresh-eyes is still a model.** It will miss things and occasionally invent them. The evidence rule makes the invented ones cheap to dismiss; it doesn't make the reviewer complete.
- **The brief is written by the author.** "Not tested" is only as honest as the agent writing it. The independent check and your own read of the "Read first" lines are what keep it honest.
- **Read-only is an instruction for Bash.** The subagent's tools include Bash, and the rule to use only read-only git commands is written in its instructions. A model can ignore an instruction. Lesson 6 is about that difference.

Next: why some of these rules are hooks and others are just text. [Lesson 6: rules it can't ignore](06-rules-it-cant-ignore.md).
