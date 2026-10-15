// WMAMS metric definitions (§ Metrics table). Pure functions over scoped data.
// Every dashboard KPI and report column uses these — one definition each.
import { workHealth } from "./progress";

export const COUNTED_WORK_STATUSES = (s) => !["DRAFT", "REJECTED", "CANCELLED"].includes(s);

// Working days between two YYYY-MM-DD dates (excludes Saturdays + holidays).
// Nepal weekly holiday is Saturday (getDay() === 6).
export function workingDaysBetween(a, b, holidays = []) {
  const d0 = new Date(a + "T00:00:00");
  const d1 = new Date(b + "T00:00:00");
  if (d1 <= d0) return 0;
  const hol = new Set(holidays);
  let n = 0;
  for (let d = new Date(d0); d < d1; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    if (d.getDay() !== 6 && !hol.has(key)) n += 1;
  }
  return n;
}

export const isOngoing = (w) => ["ONGOING", "ON_HOLD"].includes(w.status);
export const isCompleted = (w) => ["VERIFIED", "CLOSED"].includes(w.status);

export function enrichWorks(works, today) {
  return works.map((w) => ({ ...w, ...workHealth(w, today) }));
}

// Total works: status not in DRAFT, REJECTED, CANCELLED.
export const totalWorks = (works) => works.filter((w) => COUNTED_WORK_STATUSES(w.status));
// Ongoing: ONGOING or ON_HOLD.
export const ongoingWorks = (works) => works.filter(isOngoing);
// Delayed: health BEHIND or OVERDUE.
export const delayedWorks = (enriched) => enriched.filter((w) => ["BEHIND", "OVERDUE"].includes(w.health));
// Completed: VERIFIED or CLOSED.
export const completedWorks = (works) => works.filter(isCompleted);

// Average physical / expected — budget-weighted mean over budgeted works
// (toggle: simple mean over all).
export function avgPhysical(enriched, weighted = true) {
  if (!enriched.length) return 0;
  if (!weighted) return enriched.reduce((a, w) => a + w.physical, 0) / enriched.length;
  const b = enriched.filter((w) => Number(w.budgetPaisa) > 0);
  if (!b.length) return 0;
  return b.reduce((a, w) => a + w.physical * w.budgetPaisa, 0) / b.reduce((a, w) => a + w.budgetPaisa, 0);
}
export function avgExpected(enriched, weighted = true) {
  if (!enriched.length) return 0;
  if (!weighted) return enriched.reduce((a, w) => a + w.expected, 0) / enriched.length;
  const b = enriched.filter((w) => Number(w.budgetPaisa) > 0);
  if (!b.length) return 0;
  return b.reduce((a, w) => a + w.expected * w.budgetPaisa, 0) / b.reduce((a, w) => a + w.budgetPaisa, 0);
}

// Budget allocated / revised: Σ lines (OWN + ministry, no double counting —
// each sub-head counted once; pass already-deduped lines).
export const budgetAllocated = (lines) => lines.reduce((a, l) => a + (Number(l.allocated) || 0), 0);
export const budgetRevised = (lines) => lines.reduce((a, l) => a + (Number(l.revised) || 0), 0);
// Spent · utilisation: Σ VERIFIED-or-later expenditure · spent ÷ revised.
// APPROVED (incl. paid) bills must keep counting — stopping at VERIFIED
// made every spending figure drop to zero the moment a bill was approved.
/** Bills that count as spent: verified, approved (paid or not). */
export const SPENT_STATUSES = ["VERIFIED", "APPROVED"];
export const isSpentBill = (e) => SPENT_STATUSES.includes(e?.status);
export function spentVerified(expenditures) {
  return expenditures.filter(isSpentBill).reduce((a, e) => a + (Number(e.net ?? e.spent) || 0), 0);
}
// Live spent per budget sub-head: Σ VERIFIED-or-later expenditures joined
// through works (expenditure.work → work.subhead). Stored line.spent is never trusted.
export function verifiedSpentBySubhead(expenditures = [], works = []) {
  const subheadOf = Object.fromEntries((works || []).map((w) => [w.id, w.subhead]));
  const out = {};
  (expenditures || []).filter(isSpentBill).forEach((e) => {
    const sh = subheadOf[e.work];
    if (!sh) return;
    out[sh] = (out[sh] || 0) + (Number(e.net ?? e.spent) || 0);
  });
  return out;
}
// Live spent per work id: Σ VERIFIED-or-later expenditures for that work.
export function verifiedSpentByWork(expenditures = []) {
  const out = {};
  (expenditures || []).filter(isSpentBill).forEach((e) => {
    if (!e.work) return;
    out[e.work] = (out[e.work] || 0) + (Number(e.net ?? e.spent) || 0);
  });
  return out;
}
export const utilisation = (spent, revised) => (revised ? (spent / revised) * 100 : 0);
// Committed: Σ open commitments (budget lines' committed field).
export const committedTotal = (lines) => lines.reduce((a, l) => a + (Number(l.committed) || 0), 0);

// Pending approvals: Tippani IN_REVIEW + work SUBMITTED + revisions
// REQUESTED + completions submitted.
export function pendingApprovals({ tippanis = [], works = [], revisions = [] }) {
  const tip = tippanis.filter((x) => x.status === "IN_REVIEW").length;
  const sub = works.filter((w) => w.status === "SUBMITTED").length;
  const rev = revisions.filter((r) => r.status === "REQUESTED").length;
  const comp = works.filter((w) => w.status === "COMPLETION_SUBMITTED").length;
  return { tippani: tip, submitted: sub, revisions: rev, completions: comp, total: tip + sub + rev + comp };
}

// Update compliance: updates submitted by due date ÷ updates due, in period.
export function updateCompliance(updates = []) {
  if (!updates.length) return 100;
  return (updates.filter((u) => u.onTime).length / updates.length) * 100;
}

// Tippani waiting: working days since current step started (mean and max).
export function tippaniWaiting(tippanis = [], today, holidays = []) {
  const waits = tippanis.filter((x) => x.status === "IN_REVIEW").map((x) =>
    x.stepSince ? workingDaysBetween(x.stepSince, today, holidays) : (Number(x.waitDays) || 0)
  );
  if (!waits.length) return { mean: 0, max: 0 };
  return { mean: waits.reduce((a, b) => a + b, 0) / waits.length, max: Math.max(...waits) };
}

// Trimester target vs actual: Σ line trimester targets vs spent in trimester.
export function trimesterTargetVsActual(targets = []) {
  return targets.map((x) => ({ ...x, variance: x.actual == null ? null : x.actual - x.target }));
}

// SPEND_AHEAD flag on a progressive (staged) work: financial runs >20pts past physical.
export const isSpendAhead = (h) => h.financialConsidered && (h.financial ?? 0) - h.physical > 20;
