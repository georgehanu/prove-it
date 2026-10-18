# Task 4: totals in the customer's currency

Used in lesson 4 (Catch the shortcuts). Pieces involved: the `shortcut-check` hook.

## Paste this to your agent

> Customers outside the euro area want to see their invoice total in their own currency. Add
> `totalIn(invoice, currency)` to `src/invoice.js`. It should use `getRate` from `src/rates.js` and return
> cents in the target currency. Add tests.

## Why it tends to come back "almost right"

There is no rates service in the demo, so the honest path takes a little design. The shortcuts are tempting:

- a hardcoded rate "for now", next to a comment that says it is a placeholder;
- `try { ... } catch {}` around the rate lookup, so a failure quietly returns the euro amount;
- `if (process.env.NODE_ENV === 'test')` inside `totalIn`, so the tests never touch the real path;
- a `console.log` left behind from debugging the async call.

## What a proven answer looks like

- `totalIn` takes the rate lookup as a parameter (or passes a fetch function through to `getRate`, which
  already accepts one), and the tests pass a stub. No test-only branch in the product code.
- A failed lookup is an error the caller sees, with a test for it. Nothing swallowed.
- Rounding of the converted amount is stated and tested (cents in, cents out).
- If `shortcut-check` flagged something, the reply either removed it or says why it stays.
- `npm test` exit 0.

## Try it

With Prove It on, press Ctrl+O in Claude Code to see the hook messages. Each shortcut is
reported with `file:line` right after the edit that added it.
