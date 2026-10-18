# Task 5: "net 1 month" payment terms

Used in lesson 5 (A diff someone can review). Pieces involved: the `review-brief` skill, the `fresh-eyes`
subagent and the `diff-budget` hook.

## Paste this to your agent

> Add a "net-1-month" payment term: the invoice is due on the same day of the next month. If the next month
> has no such day (31 January), it is due on that month's last day. Then write a review brief for me.

## Why it tends to come back "almost right"

- `Date#setMonth` overflows: 31 January plus one month becomes 3 March.
- Local-time getters shift dates in time zones west of UTC. `src/dates.js` works in UTC for that reason.
- Leap years: 31 January 2028 is due 29 February 2028.
- December rolls into the next year.
- It is easy to tidy up `src/dates.js` while you are in there, which buries a three-line change in a big diff.

## What a proven answer looks like

- Tests with exact dates: 2026-01-31 -> 2026-02-28, 2028-01-31 -> 2028-02-29, 2026-03-31 -> 2026-04-30,
  2026-12-15 -> 2027-01-15, and an ordinary mid-month date.
- The suite run once more in a different time zone, quoted. For example `TZ=America/Los_Angeles npm test`
  (in PowerShell: `$env:TZ="America/Los_Angeles"; npm test`).
- A review brief: intent, files by risk, the 2 or 3 lines to read first, what was and was not tested,
  and "Unrelated changes: none" (or a list).
- The `fresh-eyes` findings, each with `file:line` and a confidence, and a count of any that were dropped.

## Try it

Ask for the review brief with the plugin on. Then read only the "Read first" lines and decide whether you
would merge. That is the point of the brief: the reviewer starts in the right place.
