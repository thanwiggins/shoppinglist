/**
 * Turning a shelf price into the price Aisle saves.
 *
 * Saved prices include tax and are rounded to a 50¢ step, so totals budget a little high:
 *   1. shelf price × (1 + tax rate)
 *   2. round UP to the next 50¢ step,
 *      unless it is within 10¢ above the step below, in which case round DOWN to that step.
 *   A non-zero price never rounds down to $0.00 (it becomes $0.50).
 *
 * Example at 3% tax: 3.29 → 3.39 → $3.50;  2.00 → 2.06 → $2.00;  5.45 → 5.61 → $6.00.
 */
export const STEP = 0.5;
export const ROUND_DOWN_WITHIN = 0.1;

export function savedPrice(shelf: number, taxPercent: number): number {
  if (!(shelf > 0) || !isFinite(shelf)) return 0;
  const withTax = Math.round(shelf * (1 + (taxPercent || 0) / 100) * 10000) / 10000; // tame float noise
  const lower = Math.floor(withTax / STEP + 1e-9) * STEP;
  const over = Math.round((withTax - lower) * 10000) / 10000;
  let result = over <= ROUND_DOWN_WITHIN ? lower : lower + STEP;
  if (result <= 0) result = STEP;
  return Math.round(result * 100) / 100;
}

/** Parses what someone typed as a price ("3.29", "$3.29", "3,29"). Returns NaN if it isn't one. */
export function parsePrice(text: string): number {
  const clean = text.trim().replace(/[$\s]/g, '').replace(',', '.');
  if (!/^\d*\.?\d+$/.test(clean)) return NaN;
  return parseFloat(clean);
}
