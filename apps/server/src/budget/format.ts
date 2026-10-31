/** Format integer cents as USD with thousands separators (e.g. −$1,234.56). */
export function formatMoneyCents(cents: number): string {
  const n = Number(cents) || 0;
  const sign = n < 0 ? "-" : "";
  const abs = (Math.abs(n) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}$${abs}`;
}
