import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDiscount, invoiceTotals, lineTotal, subtotal } from "../src/invoice.js";

const consulting = {
  number: "INV-1042",
  lines: [
    { description: "Workshop day", unitCents: 1250, qty: 1 },
    { description: "Follow-up call", unitCents: 1250, qty: 1 },
    { description: "Slides", unitCents: 1250, qty: 1 },
  ],
  taxRate: 21,
  issued: "2026-03-14",
  terms: "net30",
};

test("line total is unit price times quantity", () => {
  assert.equal(lineTotal({ unitCents: 499, qty: 3 }), 1497);
});

test("subtotal adds the lines", () => {
  assert.equal(subtotal(consulting.lines), 3750);
});

test("percent and fixed discounts", () => {
  assert.equal(applyDiscount(10000, { type: "percent", value: 10 }), 9000);
  assert.equal(applyDiscount(10000, { type: "fixed", cents: 2500 }), 7500);
  assert.equal(applyDiscount(10000, undefined), 10000);
});

test("a discount never makes the total negative", () => {
  assert.equal(applyDiscount(1000, { type: "fixed", cents: 5000 }), 0);
});

test("invoice totals: tax on the discounted subtotal", () => {
  assert.deepEqual(invoiceTotals(consulting), { subtotal: 3750, discount: 0, tax: 788, total: 4538 });
});

test("invoice totals with a discount", () => {
  const totals = invoiceTotals({ ...consulting, discount: { type: "percent", value: 10 } });
  assert.deepEqual(totals, { subtotal: 3750, discount: 375, tax: 709, total: 4084 });
});
