# tiny-invoice

A small invoicing module. Plain JavaScript (ESM), `node:test`, no dependencies.

```text
src/money.js      cents, formatting, percentages (halves round up)
src/invoice.js    line totals, discounts, tax, invoice totals
src/dates.js      YYYY-MM-DD dates in UTC, payment terms, overdue
src/paginate.js   pages for the invoice list
src/rates.js      exchange rates from a service (there is none in the demo)
test/             the tests
```

Run the tests:

```bash
npm test
```
