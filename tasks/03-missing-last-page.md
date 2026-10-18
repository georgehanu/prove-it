# Task 3: the missing last page

Used in lesson 3 (Find the cause, not a patch). Pieces involved: the `root-cause` skill.

## Paste this to your agent

> Bug report from a customer: "I have 25 invoices but the list only ever shows 20. There's no page 3."
> The list uses `paginate()` from `src/paginate.js` with 10 per page. Please fix it.

## Why it tends to come back "almost right"

- The tests pass, so nothing points at the bug. A quick patch often special-cases the reported count, adds a
  page to every list (now 20 invoices show an empty third page), or changes the page size.
- The real cause is one line. Proving it takes a reproduction and one probe.
- A related edge: an empty list. How many pages does it have, and what does page 1 show?

## What a proven answer looks like

- A reproduction quoted before any change: 25 items, 10 per page, `totalPages` is 2, page 3 is empty.
- The cause in one sentence with `file:line`, and the evidence for it.
- A failing test first ("25 items make 3 pages, the last has 5"), then the fix, then green.
- Edge cases checked and stated: exactly 20 items is still 2 pages; 0 items gives an answer the reply names
  and tests.
- `npm test` exit 0 after the last edit.

## Try it

Ask for the fix with and without the `root-cause` skill. Compare how many edits it takes, and whether the
reply can name the line that caused the bug.
