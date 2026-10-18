import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMoney, percentOf, sumCents, toCents } from "../src/money.js";

test("toCents reads strings and numbers", () => {
  assert.equal(toCents("12.34"), 1234);
  assert.equal(toCents("1,050.00"), 105000);
  assert.equal(toCents(0.1 + 0.2), 30);
});

test("toCents rejects things that are not amounts", () => {
  assert.throws(() => toCents("twelve"), TypeError);
});

test("sumCents adds integers", () => {
  assert.equal(sumCents([199, 1, 300]), 500);
  assert.equal(sumCents([]), 0);
});

test("percentOf rounds halves up", () => {
  assert.equal(percentOf(1250, 21), 263); // 262.5
  assert.equal(percentOf(1000, 21), 210);
});

test("formatMoney uses the currency", () => {
  assert.equal(formatMoney(123456, "EUR", "en-IE"), "€1,234.56");
});
