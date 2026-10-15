// WMAMS progress engine — §10 spec. Pure functions, shared by UI + (later) API.
//
// Three separate questions per work:
//   Expected %  — where should it be by now? (time)
//   Physical %  — where is it really? (work done)
//   Financial % — how much money has gone out? (spending, staged payments only)
//
// Rounding: store 2 decimals, display whole numbers, health uses stored values.
// "Today" is the date in Asia/Kathmandu.

export const THRESHOLDS = { ON_TRACK_MIN: -5, AT_RISK_MIN: -15 };

export function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function fmtPct(n) {
  return `${Math.round(n)}%`;
}

export function fmtMoney(npr) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(npr || 0);
}

// ── Time zone: calendar day in Asia/Kathmandu ────────────────────────────────
export function kathmanduDayKey(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kathmandu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(d));
  return parts; // YYYY-MM-DD
}

function dayKeyOf(v) {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return kathmanduDayKey(v);
}

function dayToUtcMs(dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function daysBetween(a, b) {
  const ms = dayToUtcMs(dayKeyOf(b)) - dayToUtcMs(dayKeyOf(a));
  return Math.max(0, ms / 86400000);
}

// Expected % = (today − start − onHoldDays) ÷ (deadline − start − onHoldDays) × 100, clamp 0–100.
// ON_HOLD days freeze expected progress (removed from both elapsed and planned).
// Before start date → 0. Zero/negative plan length → 100 (instant milestone).
export function calcExpected({ start, deadline, today = kathmanduDayKey(new Date()), onHoldDays = 0 }) {
  const s = dayKeyOf(start);
  const d = dayKeyOf(deadline);
  const td = dayKeyOf(today);
  if (td < s) return 0;
  const hold = Math.max(0, Number(onHoldDays) || 0);
  const total = daysBetween(s, d) - hold;
  if (total <= 0) return 100;
  const elapsed = daysBetween(s, td) - hold;
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
}

// ── Physical % by mode ───────────────────────────────────────────────────────
// WEIGHTED_TASKS: Σ(child.weight × child.physical) ÷ 100 (leaf = last confirmed %).
// Cancelled tasks excluded; surviving sibling weights rescaled to 100 (stored weights unchanged).
export function calcPhysicalByTasks(children = []) {
  const active = children.filter((c) => c.status !== "CANCELLED");
  const sum = active.reduce((a, c) => a + (Number(c.weight) || 0), 0);
  if (!sum) return 0;
  return active.reduce((a, c) => a + (((Number(c.weight) || 0) / sum) * 100 * (Number(c.physical) || 0)) / 100, 0);
}

// QUANTITY: Σ qtyDone ÷ Σ qtyPlanned × 100
export function calcPhysicalByQuantity(items = []) {
  const done = items.reduce((a, c) => a + (Number(c.qtyDone) || 0), 0);
  const planned = items.reduce((a, c) => a + (Number(c.qtyPlanned) || 0), 0);
  if (!planned) return 0;
  return (done / planned) * 100;
}

// MILESTONE: Σ weight of milestones marked done
export function calcPhysicalByMilestone(milestones = []) {
  return milestones.filter((m) => m.done).reduce((a, m) => a + (Number(m.weight) || 0), 0);
}

// HYBRID: (wP·physical + wF·financial + wM·milestone) ÷ 100
export function calcPhysicalHybrid({ physical = 0, financial = 0, milestone = 0, wP = 0, wF = 0, wM = 0 }) {
  return ((Number(wP) || 0) * (Number(physical) || 0) + (Number(wF) || 0) * (Number(financial) || 0) + (Number(wM) || 0) * (Number(milestone) || 0)) / 100;
}

// Dispatch: parent with no children behaves as a leaf (own updates).
// No confirmed update yet → 0. QUALITATIVE = reviewer-assessed % on last confirmed update.
export function calcPhysical(input = {}) {
  if (Array.isArray(input)) return calcPhysicalByTasks(input); // backwards compat: children array
  const mode = input.mode || input.progressMode || "WEIGHTED_TASKS";
  switch (mode) {
    case "QUANTITY":
      return calcPhysicalByQuantity(input.items || []);
    case "MILESTONE":
      return calcPhysicalByMilestone(input.milestones || []);
    case "QUALITATIVE":
      return Number(input.confirmed ?? input.physical ?? 0) || 0;
    case "HYBRID":
      return calcPhysicalHybrid(input);
    case "LEAF":
      return Number(input.confirmed ?? input.physical ?? 0) || 0;
    case "WEIGHTED_TASKS":
    default: {
      const children = input.children || input.tasks || [];
      if (!children.length) return Number(input.confirmed ?? input.physical ?? 0) || 0;
      return calcPhysicalByTasks(children);
    }
  }
}

// ── Financial % ──────────────────────────────────────────────────────────────
// Σ verified expenditure ÷ Σ active contract amounts (else ÷ work budget) × 100.
// Store the real value (may exceed 100 on variations); display "100%+" with warning; charts cap at 100.
export function calcFinancial({ spentPaisa = 0, spentVerifiedPaisa, contractPaisa = 0, contracts, budgetPaisa = 0 } = {}) {
  const spent = Number(spentVerifiedPaisa ?? spentPaisa) || 0;
  let base = Number(contractPaisa) || 0;
  if (Array.isArray(contracts)) {
    const active = contracts.filter((c) => c.status !== "CANCELLED");
    if (active.length) base = active.reduce((a, c) => a + (Number(c.amountPaisa ?? c.amount) || 0), 0);
  }
  if (!base) base = Number(budgetPaisa) || 0;
  if (!base) return 0;
  return (spent / base) * 100;
}

export function describeFinancial(stored) {
  const value = Number(stored) || 0;
  if (value > 100) return { value, display: "100%+", capped: 100, warn: true };
  return { value, display: fmtPct(value), capped: value, warn: false };
}

// ── Health ───────────────────────────────────────────────────────────────────
// gap = physical − expected (stored values). Thresholds −5/−15 configurable via THRESHOLDS.
export function healthOf({ expected, physical, start, deadline, today = kathmanduDayKey(new Date()), thresholds = THRESHOLDS } = {}) {
  const t = dayKeyOf(today);
  const s = start ? dayKeyOf(start) : null;
  const d = deadline ? dayKeyOf(deadline) : null;
  if (s && t < s) return physical > 0 ? "ON_TRACK" : "NOT_STARTED";
  if (d && t > d && physical < 100) return "OVERDUE";
  const onTrackMin = thresholds?.ON_TRACK_MIN ?? -5;
  const atRiskMin = thresholds?.AT_RISK_MIN ?? -15;
  const gap = physical - expected;
  if (gap >= onTrackMin) return "ON_TRACK";
  if (gap >= atRiskMin) return "AT_RISK";
  return "BEHIND";
}

// Full per-work assessment. paymentMode NONE → financial not shown (null); HYBRID not allowed with NONE.
export function workHealth(work = {}, today = kathmanduDayKey(new Date()), thresholds = THRESHOLDS) {
  const start = work.startDate || work.start;
  const deadline = work.deadline || work.end;
  const expectedRaw = calcExpected({ start, deadline, today, onHoldDays: work.onHoldDays || 0 });
  const physicalRaw =
    work.physicalMode || work.progressMode || work.children || work.tasks || work.items || work.milestones
      ? calcPhysical({
          mode: work.physicalMode || work.progressMode,
          children: work.children || work.tasks,
          items: work.items,
          milestones: work.milestones,
          confirmed: work.physical,
          physical: work.physical,
          financial: work.financial,
          milestone: work.milestonePct,
          wP: work.wP,
          wF: work.wF,
          wM: work.wM,
        })
      : Number(work.physical) || 0;
  const paymentMode = work.paymentMode || (work.contractPaisa ? "STAGED" : "AFTER_COMPLETION");
  const financialHidden = paymentMode === "NONE" || (!work.contractPaisa && !work.budgetPaisa && !work.contracts);
  const financialRaw = financialHidden
    ? 0
    : calcFinancial({ spentPaisa: work.spentPaisa || 0, spentVerifiedPaisa: work.spentVerifiedPaisa, contractPaisa: work.contractPaisa, contracts: work.contracts, budgetPaisa: work.budgetPaisa });
  const expected = round2(expectedRaw);
  const physical = round2(physicalRaw);
  const financial = round2(financialRaw);
  const gap = round2(physicalRaw - expectedRaw);
  const health = healthOf({ expected: expectedRaw, physical: physicalRaw, start, deadline, today, thresholds });
  const fin = describeFinancial(financialRaw);
  return {
    expected,
    physical,
    financial: financialHidden ? null : financial,
    financialDisplay: financialHidden ? null : fin.display,
    financialCapped: financialHidden ? null : round2(fin.capped),
    financialOverrun: fin.warn,
    gap,
    health,
    paymentMode,
    // Spending is only judged when work is paid in stages.
    financialConsidered: paymentMode === "STAGED",
  };
}

// ── Unit roll-up ─────────────────────────────────────────────────────────────
// Budget-weighted average uses only budgeted works; count-based average uses all.
export function unitRollup(works = []) {
  const count = works.length;
  const countAvg = (key) => (count ? works.reduce((a, w) => a + (Number(w[key]) || 0), 0) / count : 0);
  const budgeted = works.filter((w) => Number(w.budgetPaisa) > 0);
  const bTotal = budgeted.reduce((a, w) => a + Number(w.budgetPaisa), 0);
  const weightedAvg = (key) => (bTotal ? budgeted.reduce((a, w) => a + (Number(w[key]) || 0) * Number(w.budgetPaisa), 0) / bTotal : 0);
  return {
    count: countAvg,
    weighted: weightedAvg,
    budgetedCount: budgeted.length,
    totalCount: count,
  };
}

export const HEALTH_META = {
  ON_TRACK: { ne: "ट्रयाकमा", en: "On track", cls: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  AT_RISK: { ne: "जोखिममा", en: "At risk", cls: "bg-amber-100 text-amber-800 border-amber-300" },
  BEHIND: { ne: "ढिलो", en: "Behind", cls: "bg-red-100 text-red-800 border-red-300" },
  OVERDUE: { ne: "म्याद नाघेको", en: "Overdue", cls: "bg-red-600 text-white border-red-700" },
  NOT_STARTED: { ne: "सुरु नभएको", en: "Not started", cls: "bg-slate-200 text-slate-700 border-slate-300" },
};
