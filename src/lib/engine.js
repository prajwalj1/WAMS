// §32 Progress engine (server-only). Events queue a recompute collapsed by
// job ID (work:{id} / unit:{id}); the nightly run handles time passing and
// writes the day's snapshots to Mongo (snapshots collection). Past snapshots
// are never rewritten — reports stay reproducible. Dashboards read snapshots
// (secondary in prod). The queue itself stays in-process (BullMQ in prod).
import { calcExpected, calcFinancial, healthOf, round2 } from "./progress";
import { calcPhysical } from "./progress";
import { avgPhysical, avgExpected, utilisation } from "./metrics";
import { dbConnect } from "./db";
import { getModel } from "./models";

export const statusHistory = []; // health-change entries (AUD-bound in prod)
const queue = new Map(); // jobId → { kind: "work"|"unit", id }

async function Snapshots() {
  await dbConnect();
  return getModel("snapshots");
}

// Collapsed enqueue: repeated events become one job.
export function enqueueRecompute(kind, id) {
  const key = `${kind}:${id}`;
  if (!queue.has(key)) queue.set(key, { kind, id, jobId: key });
  return key;
}
export function queueSize() {
  return queue.size;
}
export function drainQueue() {
  const jobs = [...queue.values()];
  queue.clear();
  return jobs;
}
export async function snapshotCount() {
  return (await Snapshots()).countDocuments();
}

// One work: deepest-first tasks → bulk physical → method/expected/financial →
// works.progress → health-change history + alert flag → ancestor roll-ups.
export function recomputeWork(work, tasks, contracts, verifiedSpent, today, thresholds) {
  const active = (tasks || []).filter((t) => t.status !== "CANCELLED").sort((a, b) => (b.depth || 1) - (a.depth || 1));
  const bulk = active.map((t) => ({ ref: t.ref, physical: round2(Number(t.physical) || 0) }));
  const physical = calcPhysical({ mode: work.progressMethod || work.physicalMode, children: active, confirmed: work.physical });
  const expected = calcExpected({ start: work.startDate, deadline: work.deadline, today, onHoldDays: work.onHoldDays || 0 });
  const financial = calcFinancial({ spentPaisa: verifiedSpent, contracts, contractPaisa: work.contractPaisa, budgetPaisa: work.budgetPaisa });
  const gap = physical - expected;
  const health = healthOf({ expected, physical, start: work.startDate, deadline: work.deadline, today, thresholds });
  const flags = [];
  if ((financial - physical > 20) && work.paymentMode === "STAGED") flags.push("SPEND_AHEAD");
  const prev = work.progress?.health;
  const progress = { expected: round2(expected), physical: round2(physical), financial: round2(financial), gap: round2(gap), health, flags, asOf: today };
  const changed = prev && prev !== health;
  if (changed) statusHistory.push({ entityType: "WORK", entityId: work.id, from: prev, to: health, action: "health-change", at: new Date().toISOString() });
  for (const u of work.orgAncestors || []) enqueueRecompute("unit", u);
  return { bulk, progress, healthChanged: !!changed };
}

// Unit roll-up: aggregation over works where orgAncestors contains the unit.
export function rollupUnit(unitId, enrichedWorks, budgetLines, date) {
  const ws = enrichedWorks.filter((w) => (w.orgAncestors || []).includes(unitId));
  const byStatus = {};
  const byHealth = {};
  for (const w of ws) {
    byStatus[w.status] = (byStatus[w.status] || 0) + 1;
    byHealth[w.health] = (byHealth[w.health] || 0) + 1;
  }
  const lines = (budgetLines || []).filter((b) => (b.orgAncestors || []).includes(unitId));
  const revised = lines.reduce((a, b) => a + b.revised, 0);
  const spent = lines.reduce((a, b) => a + b.spent, 0);
  return {
    entityType: "UNIT", entityId: unitId, orgAncestors: [unitId], date,
    expected: round2(avgExpected(ws)), physical: round2(avgPhysical(ws)), financial: round2(utilisation(spent, revised)),
    gap: 0, health: "—", flags: [],
    counts: { works: ws.length, byStatus, byHealth },
    budget: { revised, spent },
  };
}

export async function writeSnapshot(snap) {
  const S = await Snapshots();
  const existing = await S.findOne({ entityType: snap.entityType, entityId: snap.entityId, date: snap.date }).lean();
  if (existing) return existing; // never rewrite the past
  return (await S.create(snap)).toObject();
}

// Nightly 00:30 NPT: recompute all works (time passed), write the day's
// work + unit snapshots, return alert-worthy health changes.
export async function nightlyRun({ works, tasksByWork, contractsByWork, spentByWork, budgetLines, today, thresholds }) {
  const out = { date: today, works: 0, healthChanges: [], snapshots: 0 };
  const enriched = [];
  for (const w of works) {
    const r = recomputeWork(w, tasksByWork[w.id] || [], contractsByWork[w.id], spentByWork[w.id] || 0, today, thresholds);
    w.progress = r.progress;
    enriched.push({ ...w, ...r.progress });
    await writeSnapshot({ entityType: "WORK", entityId: w.id, orgAncestors: w.orgAncestors || [], date: today, ...r.progress });
    out.works += 1;
    if (r.healthChanged) out.healthChanges.push({ work: w.id, health: r.progress.health });
  }
  drainQueue();
  const units = new Set();
  for (const w of works) for (const u of w.orgAncestors || []) units.add(u);
  for (const u of units) {
    const snap = rollupUnit(u, enriched, budgetLines, today);
    await writeSnapshot(snap);
    out.snapshots += 1;
  }
  out.snapshots += out.works;
  return out;
}
