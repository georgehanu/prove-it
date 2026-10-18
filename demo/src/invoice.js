import { percentOf, sumCents } from "./money.js";

// An invoice:
// {
//   number: "INV-1042",
//   lines: [{ description, unitCents, qty }],
//   discount: { type: "percent", value: 10 } | { type: "fixed", cents: 500 } | undefined,
//   taxRate: 21,              // percent, applied after the discount
//   issued: "2026-03-14",     // calendar dates as YYYY-MM-DD strings
//   terms: "net30",
// }

export function lineTotal(line) {
  return line.unitCents * line.qty;
}

export function subtotal(lines) {
  return sumCents(lines.map(lineTotal));
}

// Never goes below zero.
export function applyDiscount(cents, discount) {
  if (!discount) return cents;
  if (discount.type === "percent") return Math.max(0, cents - percentOf(cents, discount.value));
  if (discount.type === "fixed") return Math.max(0, cents - discount.cents);
  throw new Error(`unknown discount type: ${discount.type}`);
}

export function invoiceTotals(invoice) {
  const sub = subtotal(invoice.lines);
  const discounted = applyDiscount(sub, invoice.discount);
  const tax = percentOf(discounted, invoice.taxRate ?? 0);
  return { subtotal: sub, discount: sub - discounted, tax, total: discounted + tax };
}
