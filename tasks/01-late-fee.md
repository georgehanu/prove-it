# Task 1: a late fee

Used in lesson 1 (Done means proven). Pieces involved: the `stop-needs-proof` hook and the `prove-it` skill.

## Paste this to your agent

> Add a late fee to tiny-invoice. When an invoice is paid late, charge 2% of the invoice total for every
> started month it is overdue, capped at 10% of the total. Export `lateFee(invoice, today)` from
> `src/fees.js`, returning cents. Use the invoice's due date from its terms. Add one line about it to the README.

## Why it tends to come back "almost right"

- "Every **started** month": one day late is already one month. Many first attempts count whole months only.
- Months are not 30 days. Overdue from 31 January to 1 March is two started months.
- 2% of an odd number of cents needs rounding, and the cap must apply to the rounded fee.
- The README line is the part most often skipped without a word.

## What a proven answer looks like

Not the code: the evidence. A good final reply shows:

- A test per rule, with exact values: not overdue on the due date (0), one day late (2%), exactly one month
  late, a long-overdue invoice hitting the 10% cap, and an odd total that needs rounding.
- `npm test` run after the last edit, with exit code 0 and the pass count quoted.
- A `## Proof` block with one line per requirement, including "README updated" (or "not done, because...").
- Anything not checked under "Not verified:", for example invoices with a discount, if the agent did not test them.

## Try it

Copy only `demo/` (see [tasks/README.md](README.md)) and paste only the request above: this file stays
outside the copy, because an agent that reads the checklist above first makes the comparison mean nothing.
Run it once without Prove It and once with it, on fresh copies. Without it, the agent may or may not run the
tests, and it usually ends with a summary. With it, it can't finish until a check has passed after its last
edit, and it's sent back until the reply ends with a Proof block that maps each requirement, the README line
included, to evidence.
