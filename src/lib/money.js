// Money utils (§31 packages/shared/money). Integer paisa (NPR × 100) in
// Number fields; conversion happens ONLY here. Never floats for arithmetic.

/** NPR → paisa integer. Throws AMOUNT_POSITIVE / AMOUNT_INT / AMOUNT_MAX. */
export function toPaisa(npr) {
  const n = Number(npr);
  if (!Number.isFinite(n) || n <= 0) throw { code: "AMOUNT_POSITIVE" };
  const p = Math.round(n * 100);
  if (!Number.isInteger(p)) throw { code: "AMOUNT_INT" };
  if (n > 10000000000) throw { code: "AMOUNT_MAX" };
  return p;
}

/** paisa integer → NPR (float only at the display boundary). */
export function fromPaisa(paisa) {
  return (Number(paisa) || 0) / 100;
}

/** Display: lakh/crore grouping, no decimals. */
export function fmtNpr(npr) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(npr || 0);
}

/** Display from paisa. */
export function fmtPaisa(paisa) {
  return fmtNpr(fromPaisa(paisa));
}
