// §29 Access & scoping. Every record carries orgAncestors (unit + all above)
// with a multikey index; "my unit and everything below" is one indexed match.
// Three layers: permission guard → scope filter → record rules in services.
import { closedReadonly } from "./rules";

function fail(code, details) {
  throw { code, details };
}

// Unit tree (mirrors orgUnits seed). parent: null at PMO root.
export const ORG_TREE = [
  { id: "pmo", parent: null },
  { id: "moics", parent: "pmo" },
  { id: "mof", parent: "pmo" },
  { id: "doi", parent: "moics" },
  { id: "it", parent: "moics" },
  { id: "esvc", parent: "it" },
];

const parentOf = Object.fromEntries(ORG_TREE.map((u) => [u.id, u.parent]));

// Ancestor chain root-first, e.g. esvc → [pmo, moics, it, esvc].
export function ancestorsOf(unitId) {
  const chain = [];
  let cur = unitId;
  while (cur) {
    chain.unshift(cur);
    cur = parentOf[cur];
    if (chain.length > 10) break;
  }
  return chain;
}

// DB-aware ancestor chain: walks live unit records via their parent links
// (PMO root implied — every chain starts at pmo so national scope keeps
// working). Falls back to the static tree, then to [unitId] so records are
// never orphaned from every scope.
export function ancestorsOfUnit(unitId, units = []) {
  if (!unitId) return [];
  const byId = new Map((units || []).map((u) => [u.id ?? u._id, u]));
  if (byId.has(unitId)) {
    const chain = [];
    let cur = unitId;
    let guard = 0;
    while (cur && guard++ < 10) {
      chain.unshift(cur);
      const parent = byId.get(cur)?.parent;
      cur = parent || null;
    }
    if (chain[0] !== "pmo") chain.unshift("pmo");
    return chain;
  }
  const fallback = ancestorsOf(unitId);
  return fallback.length > 1 ? fallback : [unitId];
}

export const orgPathOf = (unitId) => ancestorsOf(unitId).join(".");

// "My unit and everything below": record visible iff chains intersect.
export function inScopeRecord(recordAncestors, scopeUnitIds) {
  return (recordAncestors || []).some((a) => (scopeUnitIds || []).includes(a));
}

// Mongo filter added to every query (first $match in aggregates).
export function scopeFilter(scopeUnitIds) {
  return { orgAncestors: { $in: [...(scopeUnitIds || [])] } };
}

// Descendant units of (and including) a unit — for move/job batching.
export function descendantsOf(unitId) {
  const kids = (p) => ORG_TREE.filter((u) => u.parent === p).map((u) => u.id);
  const out = [unitId];
  for (let i = 0; i < out.length; i++) out.push(...kids(out[i]));
  return out;
}

// Moving a unit (ORG-06): rewrite ancestors/path on the unit, then a worker
// job rewrites orgAncestors/orgPath on every descendant record in batches of
// 1,000. Idempotent + resumable: pure function over (units, records).
export function moveUnit(units, records, unitId, newParentId, batchSize = 1000) {
  const tree = units.map((u) => (u.id === unitId ? { ...u, parent: newParentId } : { ...u }));
  const pmap = Object.fromEntries(tree.map((u) => [u.id, u.parent]));
  const anc = (id) => {
    const c = [];
    let cur = id;
    while (cur) {
      c.unshift(cur);
      cur = pmap[cur];
      if (c.length > 10) break;
    }
    return c;
  };
  const affected = new Set();
  const desc = [unitId];
  for (let i = 0; i < desc.length; i++) {
    for (const u of tree.filter((x) => x.parent === desc[i])) desc.push(u.id);
    affected.add(desc[i]);
  }
  const batches = [];
  const rewrites = records
    .filter((r) => affected.has(r.orgUnitId))
    .map((r) => ({ ...r, orgAncestors: anc(r.orgUnitId), orgPath: anc(r.orgUnitId).join(".") }));
  for (let i = 0; i < rewrites.length; i += batchSize) batches.push(rewrites.slice(i, i + batchSize));
  return { tree, batches };
}

// PMO Super Admin is least-privilege by design: it manages ministries and
// accounts (org.* / user.manage) and monitors everything read-only
// (dashboard / reports / audit). It holds NO operational permissions — no
// work.create, tippani.*, budget.manage, procurement.manage or task.update —
// so it can never draft, approve, spend or update progress. ("*" matches
// nothing here; SUPER_ADMIN-only API routes check the role itself.)
export const PERMS_BY_ROLE = {
  SUPER_ADMIN: ["org.ministry.manage", "org.unit.manage", "user.manage", "dashboard.view", "report.export", "audit.view"],
  MINISTRY_ADMIN: ["user.manage", "work.submit", "tippani.draft", "budget.manage", "procurement.manage", "task.update", "dashboard.view", "report.export", "audit.view"],
  APPROVER: ["tippani.act", "task.update", "dashboard.view", "report.export"],
  UNIT_HEAD: ["org.unit.manage", "user.manage", "work.submit", "tippani.draft", "tippani.act", "procurement.manage", "task.update", "dashboard.view", "report.export"],
  SECTION_HEAD: ["user.manage", "tippani.draft", "tippani.act", "procurement.manage", "task.update", "dashboard.view", "report.export"],
  STAFF: ["work.create", "tippani.draft", "procurement.manage", "task.update", "dashboard.view"],
  FINANCE_OFFICER: ["tippani.draft", "tippani.act", "budget.manage", "task.update", "dashboard.view", "report.export"],
  AUDITOR: ["dashboard.view", "report.export", "audit.view"],
  VIEWER: ["dashboard.view", "report.export"],
  EXTERNAL: [],
  SYSTEM: ["system.internal"],
};
export const permsFor = (role) => PERMS_BY_ROLE[role] || [];

// Account visibility (§5): who may SEE which accounts. Super Admin sees
// all. Ministers see department/mahashakha accounts plus their own ministry
// unit's accounts — never the Super Admin's account and never fellow
// ministers. Unit heads see their
// unit's section accounts and staff (they create only sections; staff
// visibility is read-only management). Section heads see only
// their staff — never department heads or anyone above. Everyone else never
// sees Super Admin accounts. Unknown/expired sessions get the strictest view.
export function canSeeAccount(viewerRole, targetRole) {
  if (viewerRole === "SUPER_ADMIN") return true;
  if (viewerRole === "MINISTRY_ADMIN") return targetRole !== "SUPER_ADMIN" && targetRole !== "MINISTRY_ADMIN";
  // Department/mahashakha heads manage their unit's people: section heads
  // (which they create) plus the staff below them, plus the unit's finance
  // officer (UNIT_HEAD → FINANCE_OFFICER staffing). Creation stays
  // hierarchical (UNIT_HEAD → SECTION_HEAD / FINANCE_OFFICER,
  // SECTION_HEAD → STAFF); this is visibility.
  // Server + UI still scope both to the viewer's own unit.
  if (viewerRole === "UNIT_HEAD") return targetRole === "SECTION_HEAD" || targetRole === "STAFF" || targetRole === "FINANCE_OFFICER";
  if (viewerRole === "SECTION_HEAD") return targetRole === "STAFF";
  if (!viewerRole) return targetRole !== "SUPER_ADMIN" && targetRole !== "MINISTRY_ADMIN";
  return targetRole !== "SUPER_ADMIN";
}
export function requirePermission(userPerms, permission) {
  if ((userPerms || []).includes("*")) return true;
  if (!(userPerms || []).includes(permission)) fail("PERMISSION_DENIED", { permission });
  return true;
}

// Layer 3: record rules shared across services.
export function recordRules({ recordType, record, actor, action, stepHolder }) {
  if (["CLOSED"].includes(record.status)) closedReadonly(record.status);
  if (recordType === "expenditure" && ["VERIFIED", "APPROVED"].includes(record.status)) fail("RECORD_LOCKED", { recordType });
  if ((action === "approve" || action === "verify") && record.submitter && actor && record.submitter === actor)
    fail("NOT_SUBMITTER", {});
  if (action === "act-tippani" && stepHolder && actor && stepHolder !== actor) fail("STEP_HOLDER_ONLY", { stepHolder });
  if (recordType === "task" && ["DONE", "CANCELLED"].includes(record.status) && action === "update") fail("RECORD_LOCKED", { recordType });
  return true;
}

// All three layers at once. Out-of-scope behaves as 404 (BR-03).
export function authorize({ userPerms, scopeUnitIds, permission, record, recordType, actor, action, stepHolder }) {
  requirePermission(userPerms, permission);
  if (!inScopeRecord(record.orgAncestors, scopeUnitIds)) fail("OUT_OF_SCOPE", {});
  recordRules({ recordType, record, actor, action, stepHolder });
  return true;
}
