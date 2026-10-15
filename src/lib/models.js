// Mongoose models (§31 collections). Every business document carries the
// common scoped fields; optimisticConcurrency backs BR-16 (__v checks).
import mongoose from "mongoose";

const { Schema } = mongoose;

const COMMON = {
  orgUnitId: { type: String, index: true },
  orgAncestors: { type: [String], index: true },
  orgPath: { type: String, index: true },
  fiscalYearId: { type: String },
  createdBy: { type: String },
  updatedBy: { type: String },
  archivedAt: { type: Date, default: null },
};

const opts = { versionKey: "__v", optimisticConcurrency: true, strict: false };

function model(name, definition, indexes = []) {
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new Schema(definition, opts);
  for (const idx of indexes) schema.index(idx.fields, idx.opts || {});
  return mongoose.model(name, schema);
}

// §31 key collections. strict:false keeps seed extras (ne titles, subheads…)
export const Unit = () => model("Unit", { ...COMMON, id: String, code: String, nameNe: String, nameEn: String, type: String, parent: String, mode: String, works: Number, head: String }, [{ fields: { code: 1 }, opts: { unique: true } }]);
export const User = () => model("User", { ...COMMON, username: String, name: String, nameEn: String, unit: String, unitId: String, scopeUnitIds: [String], role: String, status: String, mfa: Boolean, mobile: String, passwordHash: String }, [{ fields: { username: 1 }, opts: { unique: true } }]);
// Roles & permissions (§5): one doc per role code. Static PERMS_BY_ROLE in
// scope.js is the compiled fallback; SUPER_ADMIN-managed overrides + custom
// roles persist here (SUPER_ADMIN-only writes, enforced in the
// data API route). `role` is unique so POST-then-PATCH upserts stay idempotent.
export const RolePerms = () => model("RolePerms", { role: String, permissions: [String], description: String, system: Boolean }, [{ fields: { role: 1 }, opts: { unique: true } }]);
const SCOPE_IDX = { fields: { archivedAt: 1, orgAncestors: 1 } };
export const Work = () => model("Work", { ...COMMON, id: String, titleNe: String, titleEn: String, unit: String, fy: String, status: String, startDate: String, deadline: String, physical: Number, spentPaisa: Number, contractPaisa: Number, budgetPaisa: Number, owner: String, subhead: String, paymentMode: String, turnedBehindAt: String, delayReason: String, onHoldDays: Number }, [{ fields: { id: 1 }, opts: { unique: true } }, { fields: { status: 1 } }, SCOPE_IDX]);
export const Task = () => model("Task", { ...COMMON, ref: String, workId: String, title: String, titleEn: String, description: String, tor: String, parentRef: String, assignees: Schema.Types.Mixed, weight: Number, physical: Number, owner: String, deadline: String, status: String, lastUpdate: String }, [{ fields: { ref: 1 }, opts: { unique: true } }, { fields: { workId: 1 } }, { fields: { parentRef: 1 } }, SCOPE_IDX]);
export const Tippani = () => model("Tippani", { ...COMMON, ref: String, subject: String, amount: Number, work: String, subhead: String, committed: Boolean, step: String, waitDays: Number, stepSince: String, status: String, route: String }, [{ fields: { ref: 1 }, opts: { unique: true } }, SCOPE_IDX]);
export const BudgetLine = () => model("BudgetLine", { ...COMMON, subhead: String, fiscalYear: String, fundingSource: String, name: String, allocated: Number, revised: Number, committed: Number, spent: Number }, [{ fields: { subhead: 1 }, opts: { unique: true } }, SCOPE_IDX]);
export const Expenditure = () => model("Expenditure", { ...COMMON, voucher: String, work: String, contractId: String, milestoneId: String, billNo: String, billDate: String, payee: String, physicalPct: Number, measurement: String, gross: Number, tds: Number, retention: Number, net: Number, status: String, date: String, paidDate: String, paidRef: String }, [{ fields: { voucher: 1 }, opts: { unique: true } }, { fields: { work: 1 } }, { fields: { status: 1 } }, SCOPE_IDX]);
export const Procurement = () => model("Procurement", { ...COMMON, pkg: String, work: String, method: String, stage: String, stages: Schema.Types.Mixed, stageSince: String, stagePlannedEnd: String, estimate: Number, contract: Number, bidder: String, egp: String, noticeNo: String, noticeDate: String, deadline: String, selection: Schema.Types.Mixed, committee: Schema.Types.Mixed, loiNo: String, loiDate: String }, [{ fields: { pkg: 1 }, opts: { unique: true } }, SCOPE_IDX]);
export const Contract = () => model("Contract", { ...COMMON, id: String, pkg: String, work: String, contractor: String, bidder: String, bidAmount: Number, amount: Number, retention: Number, retentionReleased: Boolean, status: String, milestones: Schema.Types.Mixed, securities: Schema.Types.Mixed, variations: Schema.Types.Mixed }, [{ fields: { id: 1 }, opts: { unique: true } }, SCOPE_IDX]);
export const Bid = () => model("Bid", { ...COMMON, pkg: String, bidder: String, amount: Number, score: Number, rank: Number }, [{ fields: { pkg: 1, bidder: 1 }, opts: { unique: true } }]);
export const Issue = () => model("Issue", { ...COMMON, id: String, work: String, text: String, level: Number, status: String, due: String }, [{ fields: { id: 1 }, opts: { unique: true } }]);
export const Directive = () => model("Directive", { ...COMMON, id: String, from: String, to: String, text: String, due: String, status: String }, [{ fields: { id: 1 }, opts: { unique: true } }]);
export const Doc = () => model("Doc", { ...COMMON, name: String, entity: String, type: String, v: Number, size: String });

export const BudgetRevision = () => model("BudgetRevision", { ...COMMON, id: String, from: String, to: String, amount: Number, status: String });
export const AuditLog = () => model("AuditLog", { at: String, actor: String, action: String, entity: String, before: Schema.Types.Mixed, after: Schema.Types.Mixed, note: String, orgAncestors: [String] });
export const Lookup = () => model("Lookup", { key: String, value: Schema.Types.Mixed });
export const Document = () => model("Document", { ...COMMON, docId: String, entity: String, type: String, name: String, mime: String, size: Number, data: Schema.Types.Mixed, versions: Schema.Types.Mixed, confidential: Boolean, downloads: Schema.Types.Mixed });
export const Snapshot = () => model("Snapshot", { entityType: String, entityId: String, orgAncestors: [String], date: String, expected: Number, physical: Number, financial: Number, gap: Number, health: String, flags: [String], counts: Schema.Types.Mixed, budget: Schema.Types.Mixed });
export const Session = () => model("Session", { sid: String, username: String, device: String, ip: String, created: String, lastSeen: String });
export const OtpChallenge = () => model("OtpChallenge",
  { cid: String, username: String, codeHash: String, exp: Date, attempts: Number, sentAt: Date, sends: [Date] },
  [{ fields: { cid: 1 }, opts: { unique: true } }, { fields: { exp: 1 }, opts: { expireAfterSeconds: 0 } }]);
export const ImportBatch = () => model("ImportBatch", { ...COMMON, id: String, file: String, at: String, rows: Number, bad: Number, status: String, committedAt: String, note: String });

export const TrimesterRow = () => model("TrimesterRow", { m: String, spent: Number, target: Number, kind: String });
export const ReportDef = () => model("ReportDef", { code: String, ne: String, en: String, filters: [String], kinds: [String] });
// Persisted report schedules (§reporting). One doc per report+FY while active:
// Schedule button on /reports/[code] creates this; unschedule PATCHes status
// to CANCELLED (no DELETE route — history is kept). fy stores the normalized
// "2083/84" form, fyLabel the dropdown label as picked.
export const ReportSchedule = () => model("ReportSchedule", { ...COMMON, code: String, fy: String, fyLabel: String, status: String, scheduledAt: String, createdBy: String }, [{ fields: { code: 1, fy: 1 }, opts: { unique: true } }, SCOPE_IDX]);

// Registry for the generic /api/data/[col] route.
export const COLLECTIONS = {
  units: Unit,
  users: User,
  roles: RolePerms,
  works: Work,
  tasks: Task,
  tippanis: Tippani,
  budget: BudgetLine,
  expenditures: Expenditure,
  procurements: Procurement,
  contracts: Contract,
  bids: Bid,
  issues: Issue,
  directives: Directive,
  docs: Doc,

  budgetrevisions: BudgetRevision,
  auditlogs: AuditLog,
  lookups: Lookup,
  documents: Document,
  snapshots: Snapshot,
  sessions: Session,
  otpchallenges: OtpChallenge,
  importbatches: ImportBatch,

  trimester: TrimesterRow,
  reports: ReportDef,
  reportschedules: ReportSchedule,
};

export function getModel(col) {
  const fn = COLLECTIONS[col];
  if (!fn) return null;
  return fn();
}

// Build every declared index (unique keys are the duplicate-submission
// guard). Runs once per connection: models compile lazily on first
// getModel(), so compile all up front, then createIndexes. With
// bufferCommands:false operations never wait for indexes — without this,
// unique checks race and duplicates slip through on a cold start.
export async function ensureIndexes() {
  for (const fn of Object.values(COLLECTIONS)) {
    try { fn(); } catch {}
  }
  for (const m of Object.values(mongoose.models)) {
    try { await m.createIndexes(); } catch (e) { console.warn("[db] index skipped:", m.modelName, e.message); }
  }
}
