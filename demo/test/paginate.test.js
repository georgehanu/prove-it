import { test } from "node:test";
import assert from "node:assert/strict";
import { paginate } from "../src/paginate.js";

const invoices = Array.from({ length: 20 }, (_, i) => `INV-${1001 + i}`);

test("first page", () => {
  const p = paginate(invoices, 1, 10);
  assert.deepEqual(p.items, invoices.slice(0, 10));
  assert.equal(p.totalPages, 2);
  assert.equal(p.hasNext, true);
});

test("second page is the last", () => {
  const p = paginate(invoices, 2, 10);
  assert.equal(p.items[0], "INV-1011");
  assert.equal(p.hasNext, false);
});
