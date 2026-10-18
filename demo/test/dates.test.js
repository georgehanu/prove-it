import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, daysInMonth, dueDate, isOverdue } from "../src/dates.js";

test("addDays crosses months and years", () => {
  assert.equal(addDays("2026-01-25", 10), "2026-02-04");
  assert.equal(addDays("2026-12-30", 3), "2027-01-02");
});

test("daysInMonth knows leap years", () => {
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29);
});

test("due dates for net terms", () => {
  assert.equal(dueDate("2026-03-14", "net30"), "2026-04-13");
  assert.equal(dueDate("2026-03-14", "due-on-receipt"), "2026-03-14");
});

test("overdue starts the day after the due date", () => {
  assert.equal(isOverdue("2026-04-13", "2026-04-13"), false);
  assert.equal(isOverdue("2026-04-13", "2026-04-14"), true);
});
