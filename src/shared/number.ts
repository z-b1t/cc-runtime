/**
 * Round floats for inspector display (Creator-like).
 * Collapses binary noise (-89.9999999 → -90) and drops trailing zeros (90.00 → 90).
 */
export function cleanFloat(n: number, maxDecimals = 3): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  // First kill long binary tails, then clamp display decimals.
  const v = parseFloat(parseFloat(n.toPrecision(12)).toFixed(maxDecimals));
  return Object.is(v, -0) ? 0 : v;
}

/**
 * InputNumber display: strip trailing zeros (1.00 → "1").
 * Keep raw text while the user is typing.
 */
export function formatFloatDisplay(
  value: string | number | undefined | null,
  userTyping?: boolean,
): string {
  if (value === "" || value == null) return "";
  if (userTyping) return String(value);
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return String(cleanFloat(n));
}
