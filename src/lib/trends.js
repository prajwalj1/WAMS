// Monthly trend helpers (§14): spent (paisa per YYYY-MM) + trimester
// targets (lakh). The gold target line extends DYNAMICALLY into upcoming
// months by carrying the latest entered target forward — no manual entry
// needed for every future month. Projected points carry `projected: true`
// so the chart can render them distinctly (no spent dot, hollow marker).
export const PROJECTED_MONTHS_AHEAD = 3;

export function nextMonths(lastM, count = PROJECTED_MONTHS_AHEAD) {
  const out = [];
  let [y, m] = String(lastM || "").split("-").map(Number);
  if (!y || !m) return out;
  for (let k = 0; k < count; k++) {
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    out.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return out;
}

export function trendWithTargets(monthlyPaisa, targetRows, futureN = PROJECTED_MONTHS_AHEAD) {
  const tByM = {};
  (targetRows || []).forEach((r) => { if (r && r.m) tByM[r.m] = Number(r.target) || 0; });
  const months = [...new Set([...Object.keys(monthlyPaisa || {}), ...Object.keys(tByM)])].sort();
  const rows = months.map((m) => ({
    m,
    spent: Math.round(((monthlyPaisa[m] || 0) / 100000) * 10) / 10,
    ...(tByM[m] ? { target: Math.round(tByM[m] * 10) / 10 } : {}),
  }));
  // Forward line: carry the latest entered target into the next months.
  // (nextMonths() only yields months past the series end, so these are new.)
  const lastTargetM = Object.keys(tByM).sort().pop();
  if (lastTargetM && futureN > 0 && months.length) {
    const carry = Math.round(tByM[lastTargetM] * 10) / 10;
    for (const fm of nextMonths(months[months.length - 1], futureN)) {
      months.push(fm);
      rows.push({ m: fm, spent: 0, target: carry, projected: true });
    }
  }
  return rows;
}
