// Dates are calendar dates in the customer's own calendar, kept as "YYYY-MM-DD" strings.
// All arithmetic is done in UTC so the machine's time zone never shifts a date.

export function parseDate(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) throw new TypeError(`not a YYYY-MM-DD date: ${text}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(text, days) {
  const date = parseDate(text);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate(); // month is 1-12
}

const TERMS = { net15: 15, net30: 30, net60: 60 };

export function dueDate(issued, terms) {
  if (terms === "due-on-receipt") return issued;
  if (!(terms in TERMS)) throw new Error(`unknown payment terms: ${terms}`);
  return addDays(issued, TERMS[terms]);
}

export function isOverdue(due, today) {
  return today > due; // YYYY-MM-DD strings sort like dates
}
