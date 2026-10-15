// §36 API conventions shared by routes: paged lists, error envelope,
// idempotency keys, optimistic-concurrency version checks.
import { randomBytes } from "crypto";

export const requestId = () => randomBytes(6).toString("hex");

export function envelopeError(code, message, details, status = 400) {
  return { status, body: { error: { code, message: message || code, details: details || [], requestId: requestId() } } };
}

// Lists: ?page=1&pageSize=25&sort=-deadline&q=…&filter[status]=ONGOING
// → { items, page, pageSize, total }. Max pageSize 500 (bounded — a list
// view never streams an unbounded collection; request page 2+ for more).
// NOTE: paginate() is in-memory (small collections only — users, lookups).
// Large collections must use paginateParams()+Mongo skip/limit below to
// avoid loading the whole collection into Node on every request.
export function paginateParams(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(query.pageSize) || 25));
  const sort = String(query.sort || "");
  const mongoSort = {};
  if (sort) {
    const desc = sort.startsWith("-");
    const key = desc ? sort.slice(1) : sort;
    // Allowlist: only simple top-level keys, prevents sort injection.
    if (/^[A-Za-z0-9_.]{1,40}$/.test(key)) mongoSort[key] = desc ? -1 : 1;
  }
  return { page, pageSize, skip: (page - 1) * pageSize, limit: pageSize, mongoSort };
}

// Cheap Mongo $or search — regex on a small allowlist of indexed/text-ish
// fields per collection. Replaces JSON.stringify(row).includes(q) full-scan
// in Node (CPU + memory heavy, never uses an index).
const SEARCH_KEYS = {
  works: ["id", "titleEn", "titleNe", "owner", "unit", "status"],
  tasks: ["ref", "workId", "title", "titleEn", "owner", "status"],
  tippanis: ["ref", "subject", "status", "step"],
  budget: ["subhead", "name", "fiscalYear"],
  expenditures: ["voucher", "work", "billNo", "payee", "status"],
  procurements: ["pkg", "work", "method", "stage", "bidder"],
  contracts: ["id", "pkg", "work", "contractor", "status"],
  issues: ["id", "work", "text", "status"],
  directives: ["id", "text", "status"],
  units: ["code", "nameEn", "nameNe"],
  users: ["username", "name", "nameEn", "role"],
  roles: ["role", "description"],
  reportschedules: ["code", "fy", "status", "createdBy"],
  documents: ["docId", "name", "entity", "type"],
  auditlogs: ["entity", "action", "actor", "note"],
  default: ["id", "ref", "code", "name", "nameEn", "titleEn", "subject", "status", "pkg", "voucher", "subhead"],
};

export function buildSearchFilter(col, q) {
  const needle = String(q || "").trim();
  if (!needle) return null;
  // Escape regex meta-chars; cap length so a giant q can't DoS the DB.
  const safe = needle.slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = { $regex: safe, $options: "i" };
  const keys = SEARCH_KEYS[col] || SEARCH_KEYS.default;
  return { $or: keys.map((k) => ({ [k]: rx })) };
}

export function paginate(rows, query) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(query.pageSize) || 25));
  let r = [...rows];
  const q = String(query.q || "").trim().toLowerCase();
  if (q) r = r.filter((x) => JSON.stringify(x).toLowerCase().includes(q));
  for (const [k, v] of Object.entries(query.filter || {})) {
    if (v) r = r.filter((x) => String(x[k]) === String(v));
  }
  const sort = String(query.sort || "");
  if (sort) {
    const desc = sort.startsWith("-");
    const key = desc ? sort.slice(1) : sort;
    r.sort((a, b) => {
      const c = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
      return desc ? -c : c;
    });
  }
  const total = r.length;
  return { items: r.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total };
}

// Updates send the __v they read; mismatch → 409 STALE_VERSION.
export function checkVersion(record, openedV) {
  if (Number(record.__v ?? 1) !== Number(openedV ?? 1)) {
    const e = envelopeError("STALE_VERSION", "Record changed — reload and retry", [{ field: "__v", code: "STALE" }], 409);
    throw { ...e, thrown: true };
  }
  return true;
}

// Create endpoints accept Idempotency-Key (in-memory here, Redis in prod).
const seenKeys = new Map();
export function idempotency(key, make) {
  if (!key) return { deduped: false, result: make() };
  if (seenKeys.has(key)) return { deduped: true, result: seenKeys.get(key) };
  const result = make();
  seenKeys.set(key, result);
  return { deduped: false, result };
}
