// Money is always an integer number of cents. Never keep money in floats.

export function toCents(amount) {
  const value = typeof amount === "string" ? Number(amount.replace(/,/g, "")) : amount;
  if (!Number.isFinite(value)) throw new TypeError(`not an amount: ${amount}`);
  return Math.round(value * 100);
}

export function formatMoney(cents, currency = "EUR", locale = "en-IE") {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

export function sumCents(values) {
  return values.reduce((total, cents) => total + cents, 0);
}

// percent is a plain number: 21 means 21%. Halves round up (12.5 -> 13).
export function percentOf(cents, percent) {
  return Math.round((cents * percent) / 100);
}
