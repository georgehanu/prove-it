// Exchange rates come from the finance team's rates service.
// In production RATES_URL points at it; there is no service in this demo.

const RATES_URL = process.env.RATES_URL ?? "https://rates.invalid/latest";

export async function getRate(from, to, fetchImpl = globalThis.fetch) {
  if (from === to) return 1;
  const res = await fetchImpl(`${RATES_URL}?from=${from}&to=${to}`);
  if (!res.ok) throw new Error(`rate lookup failed: ${res.status}`);
  const body = await res.json();
  return body.rate;
}
