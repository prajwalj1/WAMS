import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { getModel, COLLECTIONS } from "@/lib/models";
import { hashPassword } from "@/lib/password";
import { paginate, paginateParams, buildSearchFilter, envelopeError, checkVersion } from "@/lib/api-helpers";
import { callerIdentity } from "@/lib/api-auth";
import { permsFor, canSeeAccount } from "@/lib/scope";
import { DEFAULT_PERMS, validateRoleDoc, LOCKED_ROLES } from "@/lib/roles";
import { PROC_STAGES, LIFECYCLES } from "@/lib/lifecycle";
import { canApproveDirective, canApproveIssue, canRespondDirective, canActOnIssue, nextNumberedIdFromList, canIssueDirective } from "@/lib/rules";

// Effective permissions for a role: DB `roles` doc wins, static
// PERMS_BY_ROLE is the fallback. A corrupt row never escalates — only
// known permission strings are honoured.
async function effectivePermsFor(role) {
  if (!role) return [];
  try {
    const R = getModel("roles");
    const doc = await R.findOne({ role }).lean();
    if (doc && Array.isArray(doc.permissions)) {
      return doc.permissions.filter((p) => typeof p === "string");
    }
  } catch {}
  return permsFor(role);
}

// Full effective matrix (static defaults + every valid DB override). Used
// by the users-route no-escalation check so custom roles stay grantable
// only within the creator's own permission set.
async function effectiveMatrix() {
  const out = Object.fromEntries(
    Object.entries(DEFAULT_PERMS).map(([r, perms]) => [r, [...perms]])
  );
  try {
    const R = getModel("roles");
    const docs = await R.find({}).lean();
    for (const d of docs || []) {
      if (!d?.role || !Array.isArray(d?.permissions)) continue;
      out[d.role] = d.permissions.filter((p) => typeof p === "string");
    }
  } catch {}
  return out;
}

// Credential fields must never leave the server. Strip hashes from every
// read, and hash any plaintext password arriving via writes.
const stripSecrets = (doc) => {
  if (!doc || typeof doc !== "object") return doc;
  const { passwordHash, password, ...safe } = doc;
  return safe;
};
const hashUserWrite = (doc) => {
  if (!doc || typeof doc !== "object") return doc;
  if (doc.password && !doc.passwordHash) doc.passwordHash = hashPassword(doc.password);
  delete doc.password;
  return doc;
};

// Work determination rules (enforced server-side): works are determined by
// the industry side only — creation needs work.create, status transitions
// need work.create or tippani.act, task writes need work.create (create)
// or task.update (update). Monitor-only roles (SUPER_ADMIN, AUDITOR,
// VIEWER, EXTERNAL) hold none of these, so their writes are refused even
// though they can read everything. Returns a NextResponse on denial, else
// null. Shared by POST and PATCH.
const WRITE_RULES = {
  "works:POST": ["work.create"],
  "works:PATCH": ["work.create", "tippani.act"],
  "tasks:POST": ["work.create"],
  "tasks:PATCH": ["task.update"],
  // Procurement authority matrix (level → role in procurement):
  // Staff enters bids · Section head evaluates + LOI + drafts contracts
  // (Unit head may too) · Unit head approves contracts · PMO monitors
  // (higher approval only where authority requires) · Minister decides
  // policy-level matters only — never routine approvals. Bids PATCH and
  // contract PATCH details are action-gated after the record fetch below.
  "procurements:POST": ["__role:STAFF"],
  "bids:POST": ["__role:STAFF"],
  "bids:PATCH": ["__role:STAFF,UNIT_HEAD,SECTION_HEAD"],
  // Agreement recording is Department work (contract administration);
  // the dedicated gate in POST enforces DEPARTMENT unit type.
  "contracts:POST": ["procurement.manage", "budget.manage"],
  // Procurement PATCH details are action-gated below (prepare vs
  // recommend/forward vs approve), so WRITE_RULES stays open here.
  "procurements:PATCH": ["procurement.manage"],
  "contracts:PATCH": ["procurement.manage", "budget.manage"],
  // Budget discipline: lines are made by the finance officer ONLY
  // (role-gated, not just budget.manage — ministers no longer create lines).
  // Departments work independently inside their OWN budget mode and
  // mahashakhas spend the ministry budget via tippani drafts. Requesting a
  // revision is drafting (tippani.draft); deciding is managing
  // (budget.manage).
  "budget:POST": ["__role:FINANCE_OFFICER"],
  "budget:PATCH": ["__role:FINANCE_OFFICER"],
  // Expenditure entry is unit/staff work (section never enters — it
  // verifies); reversal/payment stay budget.manage-gated — decisions
  // enforced per-status below.
  "expenditures:POST": ["__role:UNIT_HEAD,STAFF"],
  "budgetrevisions:POST": ["budget.manage", "tippani.draft"],
  "budgetrevisions:PATCH": ["budget.manage"],
  // Monthly spending targets (dashboard TrendChart gold line) live in the
  // `trimester` collection as { m: "YYYY-MM", target: <lakh>, kind: "target" }.
  // Same discipline as budget lines: ministry/finance only.
  "trimester:POST": ["budget.manage"],
  "trimester:PATCH": ["budget.manage"],
  // E-Tippani drafts are staff work (tippani.draft holders: staff, section
  // and unit heads, ministry, finance). Step decisions stay gated in the
  // dedicated transition route (send→tippani.draft, decisions ministry-only).
  "tippanis:POST": ["tippani.draft"],
  "tippanis:PATCH": ["tippani.draft"],
  // Document records are written only via the scanned staff-only upload
  // flow; upload-url/complete already enforce STAFF role.
  "docs:POST": ["__role:STAFF"],
  // Report schedules: anyone who can view/export a report may schedule it.
  // Either permission suffices (STAFF holds dashboard.view only).
  "reportschedules:POST": ["report.export", "dashboard.view"],
  "reportschedules:PATCH": ["report.export", "dashboard.view"],
};
async function denyWrite(req, body, col, method) {
  const need = WRITE_RULES[`${col}:${method}`];
  if (!need) return null;
  const me = await callerIdentity(req, body);
  if (!me) return NextResponse.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, { status: 401 });
  // "__role:A,B" entries restrict by caller role instead of permission.
  const roleOnly = need.filter((p) => p.startsWith("__role:")).flatMap((p) => p.slice(7).split(","));
  if (roleOnly.length && !roleOnly.includes(me.role)) {
    return NextResponse.json({ ok: false, error: { code: "PERMISSION_DENIED" } }, { status: 403 });
  }
  const have = await effectivePermsFor(me.role);
  const allowed = have.includes("*") || need.some((p) => !p.startsWith("__role:") && have.includes(p));
  if (!allowed && !roleOnly.includes(me.role)) return NextResponse.json({ ok: false, error: { code: "PERMISSION_DENIED" } }, { status: 403 });
  return null;
}

// Resolve the caller's unit TYPE (PMO / MINISTRY / DEPARTMENT / MAHASHAKHA /
// SECTION / OFFICE) for authority-matrix checks. Units match by id or code,
// case-insensitively (ids like "dom" vs codes like "DOM" must not silently
// demote a real department head to monitor-only); unknown units read as null.
async function callerUnitType(me) {
  if (!me?.unitId) return null;
  try {
    const U = getModel("units");
    const rx = new RegExp(`^${String(me.unitId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    const u = await U.findOne({ $or: [{ id: rx }, { code: rx }] }).lean();
    return u?.type || null;
  } catch {
    return null;
  }
}
// Department head = competent approval authority + contract administration.
const isDeptHead = (me, unitType) => me?.role === "UNIT_HEAD" && unitType === "DEPARTMENT";
// Rank-1 bid of a package (lowest amount first, score breaks ties): the
// rank-1 bidder is the contractor — every selection/contract must match
// exactly this row.
async function getRankOneBid(pkg) {
  try {
    const rows = await getModel("bids").find({ pkg }).lean();
    if (!rows.length) return null;
    const ranked = rows.filter((r) => r.rank != null);
    const pool = ranked.length ? ranked : rows;
    return [...pool].sort((a, b) => (Number(a.rank ?? 999) - Number(b.rank ?? 999)) || (Number(a.amount) - Number(b.amount)) || (Number(b.score) - Number(a.score)))[0] || null;
  } catch {
    return null;
  }
}
// Section head or Mahashakha head = review + recommend/forward + coordinate.
const isProcReviewer = (me, unitType) =>
  me?.role === "SECTION_HEAD" || (me?.role === "UNIT_HEAD" && unitType === "MAHASHAKHA");
// Tender stage gate: a stage counts as passed when the stored stages map
// says DONE/SKIPPED, else when the legacy `stage` pointer has moved past it.
const stagePassed = (proc, stage) => {
  if (proc?.stages && typeof proc.stages === "object" && proc.stages[stage]) {
    return ["DONE", "SKIPPED"].includes(proc.stages[stage]);
  }
  const order = PROC_STAGES;
  return order.indexOf(proc?.stage) > order.indexOf(stage);
};

// Generic collection API over Mongo (§31). Scope filter applies BR-03:
// ?scope=it keeps only records whose orgAncestors include it.
// GET /api/data/[col]?q=&scope=&page=&pageSize=&sort=
// POST /api/data/[col] { doc, idempotencyKey? }
// PATCH /api/data/[col] { match, update, __v } (__v mismatch → 409)
export async function GET(req, { params }) {
  const { col } = await params;
  const M = getModel(col);
  if (!M) return NextResponse.json({ error: { code: "UNKNOWN_COLLECTION" } }, { status: 404 });
  try {
    await dbConnect();
  } catch (e) {
    return NextResponse.json({ error: { code: "DB_UNAVAILABLE", message: e.message } }, { status: 503 });
  }
  const url = new URL(req.url);
  // Deactivated (archivedAt set) records are hidden by default. Managers
  // may pass ?includeArchived=1 (units: organisation activate/deactivate
  // screen) — enforced here, never a client claim. Everyone else stays on
  // the active-only view.
  let filter = { archivedAt: null };
  if (url.searchParams.get("includeArchived") === "1") {
    const me = await callerIdentity(req, null);
    const have = me ? await effectivePermsFor(me.role) : [];
    if (!me) return NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
    if (!have.includes("*") && !have.includes("org.unit.manage")) {
      return NextResponse.json({ error: { code: "PERMISSION_DENIED" } }, { status: 403 });
    }
    filter = {};
  }
  const scope = url.searchParams.get("scope");
  if (scope) {
    // Comma-separated scopes supported (?scope=it,esvc); single value stays
    // an equality match so the orgAncestors multikey index is used.
    const parts = String(scope).split(",").map((s) => s.trim()).filter(Boolean);
    filter.orgAncestors = parts.length > 1 ? { $in: parts } : parts[0];
  }
  const q = url.searchParams.get("q");
  const searchOr = buildSearchFilter(col, q);
  const mongoFilter = searchOr ? { $and: [filter, searchOr] } : filter;
  // Small collections with post-filter visibility rules stay in-memory.
  // Everything else paginates in Mongo (skip/limit + count) so a list view
  // never loads the whole collection into Node.
  const SMALL_IN_MEMORY = new Set(["users", "roles", "lookups", "reports", "reportschedules", "trimester"]);
  if (SMALL_IN_MEMORY.has(col)) {
    let docs = (await M.find(mongoFilter).lean()).map(stripSecrets);
    // Account visibility (§5, enforced server-side): ministers see only
    // department/mahashakha accounts — never Super Admin or fellow ministers;
    // unit and section heads see only their own unit's accounts.
    if (col === "users") {
      const me = await callerIdentity(req, null);
      const viewerRole = me?.role || null;
      docs = docs.filter((u) => canSeeAccount(viewerRole, u.role));
      if (["UNIT_HEAD", "SECTION_HEAD"].includes(viewerRole) && me?.unitId) {
        const mine = String(me.unitId).trim().toLowerCase();
        docs = docs.filter((u) => String(u.unitId || "").trim().toLowerCase() === mine);
      }
      // Ministers see department/mahashakha postings plus their own ministry
      // unit's accounts — never Super Admin or fellow ministers. The own
      // ministry resolves by unitId AND by stored unit name (old accounts may
      // carry only `unit`), so ministry-unit accounts are never hidden by a
      // key mismatch. Resolved via the live units tree.
      if (viewerRole === "MINISTRY_ADMIN") {
        try {
          const norm = (v) => String(v ?? "").trim().toLowerCase();
          const all = await getModel("units").find({}).lean();
          const byKey = new Map();
          all.forEach((u) => [u.id, u.code, u._id].filter(Boolean).forEach((k) => {
            if (!byKey.has(norm(k))) byKey.set(norm(k), u);
          }));
          const typeOf = (uid) => byKey.get(norm(uid || ""))?.type;
          let myMin = (me?.unitId && byKey.get(norm(me.unitId))) || null;
          if (!myMin) {
            try {
              const meDoc = await getModel("users").findOne({ username: me.username }).lean();
              const names = [meDoc?.unit].filter(Boolean).map(norm);
              myMin = names.length ? all.find((u) => [u.nameEn, u.nameNe, u.code].filter(Boolean).some((k) => names.includes(norm(k)))) : null;
            } catch {}
          }
          const myKeys = new Set([me?.unitId, myMin?.id, myMin?.code, myMin?._id].filter(Boolean).map(norm));
          docs = docs.filter((u) => ["DEPARTMENT", "MAHASHAKHA"].includes(typeOf(u.unitId)) || (u.unitId && myKeys.has(norm(u.unitId))));
        } catch {}
      }
    }
    const page = paginate(docs, {
      page: url.searchParams.get("page"),
      pageSize: url.searchParams.get("pageSize") || 100,
      sort: url.searchParams.get("sort"),
      q: "",
    });
    return NextResponse.json({ ...page, col, collections: Object.keys(COLLECTIONS) });
  }
  const { page, pageSize, skip, limit, mongoSort } = paginateParams({
    page: url.searchParams.get("page"),
    pageSize: url.searchParams.get("pageSize") || 100,
    sort: url.searchParams.get("sort"),
  });
  // Never leak credential fields — exclude at the DB layer too.
  const query = M.find(mongoFilter, { passwordHash: 0, password: 0 }).lean();
  if (Object.keys(mongoSort).length) query.sort(mongoSort);
  query.skip(skip).limit(limit);
  const [items, total] = await Promise.all([query.exec(), M.countDocuments(mongoFilter)]);
  return NextResponse.json({ items: items.map(stripSecrets), page, pageSize, total, col, collections: Object.keys(COLLECTIONS) });
}

export async function POST(req, { params }) {
  const { col } = await params;
  const M = getModel(col);
  if (!M) return NextResponse.json({ ok: false, error: "UNKNOWN_COLLECTION" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  try {
    await dbConnect();
  } catch (e) {
    return NextResponse.json({ ok: false, error: "DB_UNAVAILABLE", message: e.message }, { status: 503 });
  }
  // Account creation rules (§5, enforced server-side — client dropdowns are
  // bypassable): minister (MINISTRY_ADMIN) and SUPER_ADMIN accounts can ONLY
  // be created by a Super Admin, and a Super Admin may create minister
  // accounts ONLY — never any other role, not even another SUPER_ADMIN.
  // Ministers may create department/mahashakha leadership (UNIT_HEAD,
  // SECTION_HEAD) ONLY. Any account creation needs a verified session.
  if (col === "users" && body.doc?.role) {
    const targetRole = body.doc.role;
    const RESTRICTED = ["SUPER_ADMIN", "MINISTRY_ADMIN"];
    const me = await callerIdentity(req, body);
    if (!me) return NextResponse.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, { status: 401 });
    if (RESTRICTED.includes(targetRole)) {
      if (me.role !== "SUPER_ADMIN") return NextResponse.json({ ok: false, error: { code: "ROLE_ESCALATION" } }, { status: 403 });
    }
    if (me.role === "SUPER_ADMIN" && targetRole !== "MINISTRY_ADMIN") {
      return NextResponse.json({ ok: false, error: { code: "ROLE_ESCALATION" } }, { status: 403 });
    }
    // Ministers staff departments/mahashakhas (UNIT_HEAD, SECTION_HEAD) plus
    // SUPER_ADMIN-managed custom roles whose permissions they fully hold
    // (no escalation, no exclusive perms). Built-in operational roles
    // (APPROVER, STAFF, FINANCE_OFFICER, …) stay assigned from below.
    if (me.role === "MINISTRY_ADMIN" && !["UNIT_HEAD", "SECTION_HEAD"].includes(targetRole)) {
      const matrix = await effectiveMatrix();
      const targetPerms = matrix[targetRole];
      const mine = matrix[me.role] || [];
      const isCustom = targetRole && !Object.keys(DEFAULT_PERMS).includes(targetRole);
      const grantable = isCustom && Array.isArray(targetPerms) && targetPerms.every((p) => mine.includes(p));
      if (!grantable) return NextResponse.json({ ok: false, error: { code: "ROLE_ESCALATION" } }, { status: 403 });
    }
    // Ministers create leadership accounts (UNIT_HEAD / SECTION_HEAD) ALWAYS
    // based on their own live ministry unit: the server overrides whatever
    // unit the client sent (the open tab's profile can be stale) with the
    // minister's fresh DB unit. No picker at ministry level, no mismatch
    // possible. A minister whose own account has no unit is denied — PMO
    // must set their ministry first.
    // Matching is case-insensitive (legacy rows may carry only `code`).
    if (me.role === "MINISTRY_ADMIN" && ["UNIT_HEAD", "SECTION_HEAD"].includes(targetRole)) {
      const norm = (v) => String(v ?? "").trim().toLowerCase();
      // Live ministry resolution: id/code first, then the stored unit NAME
      // (old/seeded accounts may carry only `unit: "Industry, …"` with no
      // unitId). Session identity is read fresh from Mongo every call, so a
      // PMO unit fix applies without re-login.
      const allU = await getModel("units").find({}).lean();
      const keyHit = (u, keys) => [u.id, u.code, u._id].filter(Boolean).some((k) => keys.includes(norm(k)));
      const nameHit = (u, names) => [u.nameEn, u.nameNe, u.code].filter(Boolean).some((k) => names.includes(norm(k)));
      let mine = (me.unitId && allU.find((u) => keyHit(u, [norm(me.unitId)]))) || null;
      if (!mine) {
        try {
          const meDoc = await getModel("users").findOne({ username: me.username }).lean();
          const names = [meDoc?.unit, meDoc?.nameEn].filter(Boolean).map(norm);
          if (me.unitId) names.push(norm(me.unitId));
          mine = (me.unitId && allU.find((u) => keyHit(u, [norm(me.unitId)])))
            || (names.length ? allU.find((u) => nameHit(u, names)) : null)
            || null;
        } catch {}
      }
      // Last resort: raw unitId even when the units collection doesn't know
      // it (legacy) — still based on the minister's own unit.
      const uid = mine ? (mine.id || String(mine.code || "").toLowerCase()) : String(me.unitId || "").trim();
      if (!uid) {
        return NextResponse.json({ ok: false, error: { code: "PERMISSION_DENIED" } }, { status: 403 });
      }
      body.doc.unitId = uid;
      body.doc.scopeUnitIds = [uid];
      if (mine) body.doc.unit = mine.nameEn || mine.code || body.doc.unit;
    } else if (me.role === "MINISTRY_ADMIN" && body.doc?.unitId) {
      // Custom-role grants (if any): keep validating the sent unit —
      // department/mahashakha units or the minister's own unit.
      const key = String(body.doc.unitId);
      const sameAsMine = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
      const variants = [...new Set([key, key.toLowerCase(), key.toUpperCase()])];
      const target = await getModel("units").findOne({ $or: [{ id: { $in: variants } }, { code: { $in: variants } }] }).lean();
      if (!target) {
        // Minister's own unit missing from the units collection (legacy) —
        // still allow it when the account is based on the minister's unit.
        if (!me.unitId || !sameAsMine(body.doc.unitId, me.unitId)) {
          return NextResponse.json({ ok: false, error: { code: "UNKNOWN_UNIT" } }, { status: 422 });
        }
      } else {
        const ownUnit = me.unitId && (sameAsMine(target.id, me.unitId) || sameAsMine(target.code, me.unitId));
        if (!["DEPARTMENT", "MAHASHAKHA"].includes(target.type) && !ownUnit) {
          return NextResponse.json({ ok: false, error: { code: "PERMISSION_DENIED" } }, { status: 403 });
        }
      }
    }
    // Department/mahashakha heads staff their own unit ONLY: section heads
    // (Tasks · TOR · activities · progress live in sections) plus the unit's
    // finance officer (bills/payments) — always based on their own live
    // department/mahashakha unit: the server overrides any client-sent unit
    // (stale tabs, case drift like `moics` vs `MOICS`) with the head's fresh
    // DB unit. Section accounts therefore always carry the parent
    // department/mahashakha unit. A head with no unit is refused.
    if (me.role === "UNIT_HEAD" && !["SECTION_HEAD", "FINANCE_OFFICER"].includes(targetRole)) {
      return NextResponse.json({ ok: false, error: { code: "ROLE_ESCALATION" } }, { status: 403 });
    }
    // Unit heads create accounts for their own unit only.
    if (me.role === "UNIT_HEAD") {
      const norm = (v) => String(v ?? "").trim().toLowerCase();
      if (!me.unitId) return NextResponse.json({ ok: false, error: { code: "OUT_OF_SCOPE" } }, { status: 404 });
      const allU = await getModel("units").find({}).lean();
      const mine = allU.find((u) => [u.id, u.code, u._id].filter(Boolean).some((k) => norm(k) === norm(me.unitId))) || null;
      const uid = mine ? (mine.id || String(mine.code || "").toLowerCase()) : String(me.unitId).trim();
      if (!uid) return NextResponse.json({ ok: false, error: { code: "OUT_OF_SCOPE" } }, { status: 404 });
      body.doc.unitId = uid;
      body.doc.scopeUnitIds = [uid];
      if (mine) body.doc.unit = mine.nameEn || mine.code || body.doc.unit;
    }
    // Section heads add their section's staff and accounts — STAFF only,
    // own unit only (same live-unit override as above).
    if (me.role === "SECTION_HEAD" && targetRole !== "STAFF") {
      return NextResponse.json({ ok: false, error: { code: "ROLE_ESCALATION" } }, { status: 403 });
    }
    if (me.role === "SECTION_HEAD") {
      const norm = (v) => String(v ?? "").trim().toLowerCase();
      if (!me.unitId) return NextResponse.json({ ok: false, error: { code: "OUT_OF_SCOPE" } }, { status: 404 });
      const allU = await getModel("units").find({}).lean();
      const mine = allU.find((u) => [u.id, u.code, u._id].filter(Boolean).some((k) => norm(k) === norm(me.unitId))) || null;
      const uid = mine ? (mine.id || String(mine.code || "").toLowerCase()) : String(me.unitId).trim();
      if (!uid) return NextResponse.json({ ok: false, error: { code: "OUT_OF_SCOPE" } }, { status: 404 });
      body.doc.unitId = uid;
      body.doc.scopeUnitIds = [uid];
      if (mine) body.doc.unit = mine.nameEn || mine.code || body.doc.unit;
    }
    // Lower-hierarchy creators can only grant roles whose permissions they
    // fully hold (no escalation) — mirrors grantableRoles() on the client.
    // SUPER_ADMIN / MINISTRY_ADMIN have their own explicit rules above.
    // The three explicit hierarchical allowances (UNIT_HEAD → SECTION_HEAD /
    // FINANCE_OFFICER, SECTION_HEAD → STAFF) are exempt here: STAFF holds
    // work.create and FINANCE_OFFICER holds budget.manage, which the creating
    // heads legitimately lack, so the generic subset check would wrongly
    // refuse every such creation. Uses the effective matrix so
    // SUPER_ADMIN-managed custom roles obey the same rule.
    if (!["SUPER_ADMIN", "MINISTRY_ADMIN"].includes(me.role)) {
      const hierarchical =
        (me.role === "UNIT_HEAD" && ["SECTION_HEAD", "FINANCE_OFFICER"].includes(targetRole)) ||
        (me.role === "SECTION_HEAD" && targetRole === "STAFF");
      if (!hierarchical) {
        const matrix = await effectiveMatrix();
        const targetPerms = matrix[targetRole];
        const mine = matrix[me.role] || [];
        const grantable = Array.isArray(targetPerms) && targetPerms.every((p) => mine.includes(p));
        if (!grantable) return NextResponse.json({ ok: false, error: { code: "ROLE_ESCALATION" } }, { status: 403 });
      }
    }
  }
  // Roles & permissions (§5, SUPER_ADMIN only): ministers, unit/section
  // heads and everyone else get 403 here — role writes are PMO-only.
  // Locked roles (SUPER_ADMIN, SYSTEM) can never be rewritten and
  // org.ministry.manage can never be granted elsewhere (least-privilege).
  if (col === "roles" && req.method === "POST") {
    const me = await callerIdentity(req, body);
    if (!me) return NextResponse.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, { status: 401 });
    if (me.role !== "SUPER_ADMIN") return NextResponse.json({ ok: false, error: { code: "PERMISSION_DENIED" } }, { status: 403 });
    const err = validateRoleDoc(body.doc, { isNew: true });
    if (err) return NextResponse.json({ ok: false, error: { code: err } }, { status: 422 });
    if (LOCKED_ROLES.includes(body.doc.role)) return NextResponse.json({ ok: false, error: { code: "LOCKED_ROLE" } }, { status: 403 });
  }
  // Unit management (§5, enforced server-side): the PMO Super Admin alone
  // may add any unit type (ministry, department, mahashakha,
  // section, office) and deactivate units. Ministers and everyone else
  // are read-only here — no actions at ministry level in Organisation.
  if (col === "units" && req.method === "POST") {
    const me = await callerIdentity(req, body);
    if (!me) return NextResponse.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, { status: 401 });
    if (me.role !== "SUPER_ADMIN") {
      return NextResponse.json({ ok: false, error: { code: "PERMISSION_DENIED" } }, { status: 403 });
    }
  }
  // Contract drafting sits with the Section head (records the agreement,
  // always as PENDING_APPROVAL); activation (ACTIVE) is the Unit head's
  // approval on the contract page. Ministers decide policy-level matters
  // only — neither records routine contracts.
  if (col === "contracts") {
    const me = await callerIdentity(req, body);
    if (!me) return NextResponse.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, { status: 401 });
    const unitType = await callerUnitType(me);
    const drafter = isDeptHead(me, unitType) || isProcReviewer(me, unitType);
    if (!drafter) {
      return NextResponse.json({ ok: false, error: { code: "PERMISSION_DENIED" } }, { status: 403 });
    }
    // Strong contract validation (all dept-gated above, but verified here):
    // linked procurement must exist with an explicit winner selection AND an
    // issued LOI; contractor must be the rank-1 bidder (who is also the
    // selected bidder); amount must equal the winning bid and stay within
    // the approved procurement estimate.
    // Status is forced to PENDING_APPROVAL — ACTIVE only after approval.
    const doc = body.doc || {};
    const P = getModel("procurements");
    let proc = null;
    try {
      proc = await P.findOne({ pkg: doc.pkg }).lean();
    } catch {}
    if (!proc) return NextResponse.json({ ok: false, error: { code: "PROCUREMENT_NOT_FOUND" } }, { status: 404 });
    const sel = proc.selection;
    if (!sel?.bidder) return NextResponse.json({ ok: false, error: { code: "SELECTION_REQUIRED" } }, { status: 422 });
    if (!proc.loiNo) return NextResponse.json({ ok: false, error: { code: "LOI_REQUIRED" } }, { status: 422 });
    if (String(doc.contractor || "") !== String(sel.bidder)) {
      return NextResponse.json({ ok: false, error: { code: "BID_MISMATCH" } }, { status: 422 });
    }
    const rankOne = await getRankOneBid(doc.pkg);
    if (!rankOne || rankOne.rank !== 1) {
      return NextResponse.json({ ok: false, error: { code: "EVALUATION_REQUIRED" } }, { status: 422 });
    }
    if (String(doc.contractor || "") !== String(rankOne.bidder) || Number(doc.amount) !== Number(rankOne.amount)) {
      return NextResponse.json({ ok: false, error: { code: "RANK_ONE_ONLY" } }, { status: 422 });
    }
    let winBid = null;
    try {
      winBid = await getModel("bids").findOne({ pkg: doc.pkg, bidder: sel.bidder }).lean();
    } catch {}
    if (!winBid) return NextResponse.json({ ok: false, error: { code: "BID_NOT_FOUND" } }, { status: 422 });
    if (Number(doc.amount) !== Number(winBid.amount)) {
      return NextResponse.json({ ok: false, error: { code: "BID_AMOUNT_MISMATCH" } }, { status: 422 });
    }
    const est = Number(proc.estimate) || 0;
    if (est > 0 && Number(doc.amount) > est) {
      return NextResponse.json({ ok: false, error: { code: "CONTRACT_EXCEEDS_ESTIMATE" } }, { status: 422 });
    }
    // Budget is always the higher ceiling — contractor amount can never
    // exceed it. Work budget + budget-line revised form the cap; already
    // committed contracts on the same work count so split packages cannot
    // overshoot in total.
    try {
      const workId = doc.work || proc.work;
      let workBudget = 0;
      let lineRevised = 0;
      if (workId) {
        const w = await getModel("works").findOne({ id: workId }).lean();
        workBudget = Number(w?.budgetPaisa) || 0;
        if (w?.subhead) {
          const line = await getModel("budget").findOne({ subhead: w.subhead }).lean();
          lineRevised = Number(line?.revised) || 0;
        }
        const others = await getModel("contracts").find({ work: workId }).lean();
        const otherTotal = (others || []).reduce((a, c) => a + (Number(c.amount) || 0), 0);
        const caps = [workBudget, lineRevised].filter((n) => n > 0);
        if (caps.length && Number(doc.amount) + otherTotal > Math.min(...caps)) {
          return NextResponse.json({ ok: false, error: { code: "CONTRACT_EXCEEDS_BUDGET", work: workId, amount: Number(doc.amount), ceiling: Math.min(...caps), committed: otherTotal } }, { status: 422 });
        }
      }
    } catch {}
    body.doc = { ...doc, status: "PENDING_APPROVAL", bidder: sel.bidder, bidAmount: Number(winBid.amount) };
  }
  // Bids are entry work (STAFF, role-gated in WRITE_RULES) but only AFTER
  // the tender is issued — NOTICE stage must be passed on the package.
  if (col === "bids") {
    const me = await callerIdentity(req, body);
    if (!me) return NextResponse.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, { status: 401 });
    let proc = null;
    try {
      proc = await getModel("procurements").findOne({ pkg: body.doc?.pkg }).lean();
    } catch {}
    if (!proc) return NextResponse.json({ ok: false, error: { code: "PROCUREMENT_NOT_FOUND" } }, { status: 404 });
    if (!stagePassed(proc, "NOTICE")) {
      return NextResponse.json({ ok: false, error: { code: "TENDER_NOT_ISSUED" } }, { status: 422 });
    }
    // Bidder name can never be blanked and amount must stay positive —
    // a "deleted" name or zeroed amount would corrupt ranking + selection.
    if (!String(body.doc?.bidder || "").trim()) {
      return NextResponse.json({ ok: false, error: { code: "BIDDER_REQUIRED" } }, { status: 422 });
    }
    if (!(Number(body.doc?.amount) > 0)) {
      return NextResponse.json({ ok: false, error: { code: "AMOUNT_POSITIVE" } }, { status: 422 });
    }
  }
  // Bills may only be recorded against an ACTIVE contract — never against a
  // pending, terminated or missing one.
  if (col === "expenditures" && body.doc?.contractId) {
    const me = await callerIdentity(req, body);
    if (!me) return NextResponse.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, { status: 401 });
    let c = null;
    try {
      c = await getModel("contracts").findOne({ id: body.doc.contractId }).lean();
    } catch {}
    if (!c) return NextResponse.json({ ok: false, error: { code: "CONTRACT_NOT_FOUND" } }, { status: 404 });
    if (c.status !== "ACTIVE") {
      return NextResponse.json({ ok: false, error: { code: "CONTRACT_NOT_ACTIVE" } }, { status: 422 });
    }
    // Payment is always based on the contract's work: a bill linked to a
    // contract inherits the contract's work id (never a hand-picked or stale
    // work like "gggg"). The milestone must also belong to that contract.
    if (c.work) body.doc.work = c.work;
    if (body.doc.milestoneId) {
      const mids = new Set(((c.milestones || []).map((m, i) => m.id || `${c.id}-M${i + 1}`)));
      if (!mids.has(body.doc.milestoneId)) {
        return NextResponse.json({ ok: false, error: { code: "MILESTONE_MISMATCH", work: c.work } }, { status: 422 });
      }
    }
  }
  // Expenditure org backfill: bills recorded from the contracts page (or any
  // client omitting org fields) inherit their parent work's org identity so
  // org-scoped reads (engine, reports, direct orgAncestors queries) see them.
  // The dashboard also scopes via parent work id — this keeps both paths
  // consistent. Never overwrites caller-supplied org fields.
  if (col === "expenditures" && body.doc?.work && !body.doc.orgUnitId) {
    try {
      const w = await getModel("works").findOne({ id: body.doc.work }).lean();
      if (w) {
        body.doc.orgUnitId = w.orgUnitId || body.doc.orgUnitId;
        if (!Array.isArray(body.doc.orgAncestors) || body.doc.orgAncestors.length === 0) {
          body.doc.orgAncestors = w.orgAncestors || (w.orgUnitId ? [w.orgUnitId] : []);
          body.doc.orgPath = w.orgPath || (body.doc.orgAncestors || []).join(".");
        }
      }
    } catch {}
  }
  // Tippani org repair: legacy docs carry a bare [unitId] chain, which hides
  // them from everyone above that unit (no shared root). Rebuild the full
  // chain from the live units tree (PMO root implied) whenever the posted
  // ancestors are missing or rootless. Never narrows a complete chain.
  if (col === "tippanis" && body.doc && (!Array.isArray(body.doc.orgAncestors) || !body.doc.orgAncestors.includes("pmo"))) {
    try {
      const anchor = body.doc.orgUnitId || (Array.isArray(body.doc.orgAncestors) && body.doc.orgAncestors[0]);
      if (anchor) {
        const U = getModel("units");
        const all = await U.find({}).lean();
        const byId = new Map(all.map((u) => [u.id ?? u.code, u]));
        const chain = [];
        let cur = anchor;
        let guard = 0;
        while (cur && guard++ < 10) {
          chain.unshift(cur);
          cur = byId.get(cur)?.parent || null;
        }
        if (chain.length && chain[0] !== "pmo") chain.unshift("pmo");
        if (chain.length) {
          body.doc.orgAncestors = chain;
          body.doc.orgPath = chain.join(".");
          if (!body.doc.orgUnitId) body.doc.orgUnitId = anchor;
        }
      }
    } catch {}
  }
  // Directives/issues are registered by anyone on the team (staff included)
  // but acted on only by top-level roles (enforced on PATCH below). Writes
  // still need a verified session, and the issuer stamp is the caller's own
  // username — never a client claim — so the close-approval check can trust
  // `from`. Sequence ids (DIR-NNN / ISS-NNN) are assigned here from DB truth:
  // the old client-side DIR-{count+1} guess collided with the unique index
  // after deletes, stale lists or double clicks and failed with CREATE_FAILED.
  const seqPrefix = col === "directives" ? "DIR-" : col === "issues" ? "ISS-" : null;
  const assignSeqId = async () => {
    const rows = await M.find({ id: { $regex: `^${seqPrefix}` } }, { id: 1 }).lean();
    body.doc.id = nextNumberedIdFromList((rows || []).map((r) => r.id), seqPrefix);
  };
  if ((col === "directives" || col === "issues") && req.method === "POST") {
    const me = await callerIdentity(req, body);
    if (!me) return NextResponse.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, { status: 401 });
    // SECTION_HEAD has no Issue button (hidden in UI) — refuse direct posts too.
    if (col === "directives") {
      try {
        canIssueDirective(body.doc, me);
      } catch (e) {
        return NextResponse.json({ ok: false, error: { code: e?.code || "PERMISSION_DENIED" } }, { status: 403 });
      }
    }
    body.doc = body.doc || {};
    if (col === "directives") body.doc.from = me.username;
    try {
      await assignSeqId();
    } catch (e) {
      return NextResponse.json({ ok: false, error: { code: "DB_UNAVAILABLE", message: e.message } }, { status: 503 });
    }
  }
  // Work determination gate (industry side only) — shared with PATCH.
  const denied = await denyWrite(req, body, col, "POST");
  if (denied) return denied;
  // Budget revision ids (REV-YYYY-NN, yearly series) are assigned here from
  // DB truth — the old client-side REV-{tag}-{count+1} guess collided on
  // stale lists and every such save failed. Reuses the same helper and
  // response shape (refId) as directives/issues above.
  if (col === "budgetrevisions" && req.method === "POST") {
    try {
      const tag = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu", year: "numeric" }).format(new Date());
      const prefix = `REV-${tag}-`;
      const rows = await M.find({ id: { $regex: `^${prefix}` } }, { id: 1 }).lean();
      body.doc = body.doc || {};
      body.doc.id = nextNumberedIdFromList((rows || []).map((r) => r.id), prefix, 2);
    } catch (e) {
      return NextResponse.json({ ok: false, error: { code: "DB_UNAVAILABLE", message: e.message } }, { status: 503 });
    }
  }
  try {
    const doc = await M.create(hashUserWrite(body.doc || {}));
    const refId = seqPrefix ? doc.id : col === "budgetrevisions" ? doc.id : undefined;
    return NextResponse.json({ ok: true, id: doc._id, refId }, { status: 201 });
  } catch (e) {
    // Lost race on the sequence id (two simultaneous issues): reassign and
    // retry instead of failing the save.
    if (seqPrefix && e?.code === 11000) {
      for (let i = 0; i < 3; i++) {
        try {
          await assignSeqId();
          const doc = await M.create(hashUserWrite(body.doc || {}));
          return NextResponse.json({ ok: true, id: doc._id, refId: doc.id }, { status: 201 });
        } catch (e2) {
          if (e2?.code !== 11000) break;
          e = e2;
        }
      }
    }
    return NextResponse.json({ ok: false, error: { code: "CREATE_FAILED", message: e.message } }, { status: 422 });
  }
}

export async function PATCH(req, { params }) {
  const { col } = await params;
  const M = getModel(col);
  if (!M) return NextResponse.json({ error: { code: "UNKNOWN_COLLECTION" } }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  try {
    await dbConnect();
  } catch (e) {
    return NextResponse.json({ ok: false, error: "DB_UNAVAILABLE", message: e.message }, { status: 503 });
  }
  // Same work-determination gate as POST (industry side only).
  const deniedPatch = await denyWrite(req, body, col, "PATCH");
  if (deniedPatch) return deniedPatch;
  // Same PMO-only unit gate as POST — no ministry-level unit actions.
  if (col === "units") {
    const me = await callerIdentity(req, body);
    if (!me) return NextResponse.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, { status: 401 });
    if (me.role !== "SUPER_ADMIN") return NextResponse.json({ ok: false, error: { code: "PERMISSION_DENIED" } }, { status: 403 });
  }
  // User unit changes (§5): PMO anywhere; ministry admins ONLY move accounts
  // between their own ministry's DEPARTMENT/MAHASHAKHA units (or back to
  // their own ministry unit) — the account's unit stays based on the
  // ministry admin's ministry. Everyone else is refused unit fields.
  if (col === "users" && body.update && ["unit", "unitId", "scopeUnitIds"].some((k) => body.update[k] !== undefined)) {
    const me = await callerIdentity(req, body);
    if (!me) return NextResponse.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, { status: 401 });
    if (me.role !== "SUPER_ADMIN") {
      if (me.role !== "MINISTRY_ADMIN") return NextResponse.json({ ok: false, error: { code: "PERMISSION_DENIED" } }, { status: 403 });
      const same = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
      const newUnitId = body.update.unitId || (Array.isArray(body.update.scopeUnitIds) ? body.update.scopeUnitIds[0] : null);
      if (!newUnitId) return NextResponse.json({ ok: false, error: { code: "UNKNOWN_UNIT" } }, { status: 422 });
      const variants = [...new Set([String(newUnitId), String(newUnitId).toLowerCase(), String(newUnitId).toUpperCase()])];
      const U = getModel("units");
      const target = await U.findOne({ $or: [{ id: { $in: variants } }, { code: { $in: variants } }] }).lean();
      if (!target) {
        if (!me.unitId || !same(newUnitId, me.unitId)) {
          return NextResponse.json({ ok: false, error: { code: "UNKNOWN_UNIT" } }, { status: 422 });
        }
      } else {
        const ownUnit = me.unitId && (same(target.id, me.unitId) || same(target.code, me.unitId));
        if (!ownUnit) {
          if (!["DEPARTMENT", "MAHASHAKHA"].includes(target.type)) {
            return NextResponse.json({ ok: false, error: { code: "PERMISSION_DENIED" } }, { status: 403 });
          }
          // Must sit under the minister's own ministry (walk parent links).
          const all = await U.find({}).lean();
          const byKey = new Map();
          all.forEach((u) => [u.id, u.code, u._id].filter(Boolean).forEach((k) => {
            if (!byKey.has(String(k).trim().toLowerCase())) byKey.set(String(k).trim().toLowerCase(), u);
          }));
          const mine = [me.unitId].filter(Boolean).map((k) => String(k).trim().toLowerCase());
          let cur = String(target.parent ?? "").trim().toLowerCase();
          let under = false;
          let guard = 0;
          while (cur && guard++ < 10) {
            if (mine.includes(cur)) { under = true; break; }
            cur = String(byKey.get(cur)?.parent ?? "").trim().toLowerCase();
          }
          if (!under) return NextResponse.json({ ok: false, error: { code: "OUT_OF_SCOPE" } }, { status: 404 });
        }
      }
    }
  }
  // Roles PATCH is SUPER_ADMIN only; locked roles and exclusive-permission
  // grants are refused even for SUPER_ADMIN.
  if (col === "roles") {
    const me = await callerIdentity(req, body);
    if (!me) return NextResponse.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, { status: 401 });
    if (me.role !== "SUPER_ADMIN") return NextResponse.json({ ok: false, error: { code: "PERMISSION_DENIED" } }, { status: 403 });
    const targetRole = body.match?.role || body.update?.role;
    if (targetRole && LOCKED_ROLES.includes(targetRole)) return NextResponse.json({ ok: false, error: { code: "LOCKED_ROLE" } }, { status: 403 });
    if (Array.isArray(body.update?.permissions)) {
      const err = validateRoleDoc({ role: targetRole || body.match?.role || "UNKNOWN", permissions: body.update.permissions });
      if (err) return NextResponse.json({ ok: false, error: { code: err } }, { status: 422 });
    }
  }
  // Procurement/bid/contract authority is checked after the record fetch
  // below (stage approvals are detected against the stored stages map).
  // Expenditure decisions: staff enters + submits, the SECTION verifies,
  // the DEPARTMENT approves payment — staff can never approve. Reversal of
  // an approved bill and payment recording stay with budget managers
  // (finance), and payment is recorded only on APPROVED bills — never
  // directly on verified ones. Verified against the caller's session.
  if (col === "expenditures") {
    const me = await callerIdentity(req, body);
    if (!me) return NextResponse.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, { status: 401 });
    const to = body.update?.status;
    const pays = body.update?.paidDate !== undefined || body.update?.paidRef !== undefined;
    const have = await effectivePermsFor(me.role);
    const manages = have.includes("*") || have.includes("budget.manage");
    const approves = me.role === "SECTION_HEAD" || have.includes("*");
    const deptApproves = isDeptHead(me, await callerUnitType(me)) || have.includes("*");
    if (to === "SUBMITTED") {
      const submits = ["UNIT_HEAD", "STAFF"].includes(me.role) || manages;
      if (!submits) return NextResponse.json({ ok: false, error: { code: "PERMISSION_DENIED" } }, { status: 403 });
    } else if (to === "VERIFIED") {
      if (!approves) return NextResponse.json({ ok: false, error: { code: "PERMISSION_DENIED" } }, { status: 403 });
    } else if (to === "RETURNED") {
      // Returned from SUBMITTED → section decides; returned from VERIFIED
      // (department ping-back) → department decides. Resolved against the
      // stored bill, never a client claim.
      let stored = null;
      try {
        stored = await M.findOne(body.match || {}).lean();
      } catch {}
      const fromVerified = stored?.status === "VERIFIED";
      if (fromVerified ? !deptApproves : !approves && !deptApproves) {
        return NextResponse.json({ ok: false, error: { code: "PERMISSION_DENIED" } }, { status: 403 });
      }
    } else if (to === "APPROVED") {
      if (!deptApproves) return NextResponse.json({ ok: false, error: { code: "PERMISSION_DENIED" } }, { status: 403 });
    } else if (to === "REVERSED" || pays) {
      if (!manages) return NextResponse.json({ ok: false, error: { code: "PERMISSION_DENIED" } }, { status: 403 });
      if (pays) {
        // Payment only on APPROVED bills: fetch the stored bill and refuse
        // anything else (verified-but-unapproved, drafts, reversed…).
        let stored = null;
        try {
          stored = await M.findOne(body.match || {}).lean();
        } catch {}
        if (!stored) return NextResponse.json({ ok: false, error: { code: "NOT_FOUND" } }, { status: 404 });
        if (stored.status !== "APPROVED") {
          return NextResponse.json({ ok: false, error: { code: "BILL_NOT_APPROVED" } }, { status: 422 });
        }
      }
    } else if (!manages) {
      return NextResponse.json({ ok: false, error: { code: "PERMISSION_DENIED" } }, { status: 403 });
    }
  }
  try {
    let doc = await M.findOne(body.match || {});
    // Units: legacy rows may carry only `code` (no `id`) — retry by code and
    // backfill the missing `id` so future matches hit directly.
    if (!doc && col === "units" && body.match?.id) {
      const v = [...new Set([String(body.match.id), String(body.match.id).toLowerCase(), String(body.match.id).toUpperCase()])];
      doc = await M.findOne({ $or: [{ id: { $in: v } }, { code: { $in: v } }] });
      if (doc && !doc.id && doc.code) doc.id = String(doc.code).toLowerCase();
    }
    if (!doc) return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
    // Directive / issue close approval: registered by anyone but approved
    // (closed) only by top-level roles — staff acknowledge/respond but never
    // approve. Validated against the lifecycle here so direct API calls
    // cannot skip states, forge comments, or bypass the UI.
    if ((col === "directives" || col === "issues") && body.update?.status !== undefined) {
      const me = await callerIdentity(req, body);
      if (!me) return NextResponse.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, { status: 401 });
      const lcKey = col === "directives" ? "directive" : "issue";
      const lc = LIFECYCLES[lcKey];
      const to = body.update.status;
      const t = (lc?.transitions || []).find((x) => x.from.includes(doc.status) && x.to === to);
      if (!t) {
        return NextResponse.json({ ok: false, error: { code: "INVALID_TRANSITION", from: doc.status, to } }, { status: 422 });
      }
      if ((t.needs || []).includes("comment")) {
        const c = body.reason || body.comment || body.update?.reason || body.update?.comment || "";
        if (!String(c || "").trim()) {
          return NextResponse.json({ ok: false, error: { code: "COMMENT_REQUIRED", action: t.action } }, { status: 422 });
        }
      }
      if (to === "CLOSED" || (col === "directives" && t.action === "ask_more")) {
        try {
          if (col === "directives") canApproveDirective(doc, me);
          else canApproveIssue(doc, me);
        } catch (e) {
          const code = e?.code || "PERMISSION_DENIED";
          const status = code === "UNAUTHENTICATED" ? 401 : 403;
          return NextResponse.json({ ok: false, error: { code, ...(e?.details ? { details: e.details } : {}) } }, { status });
        }
      }
      // Acknowledge/respond is approver-only — staff is read-only and
      // monitor-only roles can never act.
      if (col === "directives" && (t.action === "acknowledge" || t.action === "respond")) {
        try {
          canRespondDirective(doc, me);
        } catch (e) {
          const code = e?.code || "PERMISSION_DENIED";
          const status = code === "UNAUTHENTICATED" ? 401 : 403;
          return NextResponse.json({ ok: false, error: { code, ...(e?.details ? { details: e.details } : {}) } }, { status });
        }
      }
      // Issue begin/resolve is approver-only too — staff is read-only.
      if (col === "issues" && (t.action === "begin" || t.action === "resolve")) {
        try {
          canActOnIssue(doc, me);
        } catch (e) {
          const code = e?.code || "PERMISSION_DENIED";
          const status = code === "UNAUTHENTICATED" ? 401 : 403;
          return NextResponse.json({ ok: false, error: { code, ...(e?.details ? { details: e.details } : {}) } }, { status });
        }
      }
    }
    // Completion verification (COMPLETION route: UNIT_HEAD or APPROVER, never
    // the submitter, only out of COMPLETION_SUBMITTED). The reviews queue and
    // work detail both PATCH status here — enforce it once, server-side, so a
    // direct API call cannot self-verify or skip the submitted state.
    if (col === "works" && body.update?.status === "VERIFIED") {
      const me = await callerIdentity(req, body);
      if (!me) return NextResponse.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, { status: 401 });
      if (!["UNIT_HEAD", "APPROVER"].includes(me.role)) {
        return NextResponse.json({ ok: false, error: { code: "PERMISSION_DENIED" } }, { status: 403 });
      }
      if (doc.owner && me.username && doc.owner === me.username) {
        return NextResponse.json({ ok: false, error: { code: "NOT_SUBMITTER" } }, { status: 403 });
      }
      if (doc.status !== "COMPLETION_SUBMITTED") {
        return NextResponse.json({ ok: false, error: { code: "INVALID_TRANSITION" } }, { status: 422 });
      }
    }
    // Procurement authority matrix (enter → evaluate → approve):
    // Staff enters bids (tender prep fields) · Section head evaluates
    // (scores/ranks), confirms rank-1, issues LOI and drafts the contract
    // (the Unit head may do any of these too) · Unit head alone approves
    // the contract (every status change) · Ministers/PMO monitor — no
    // routine chain writes.
    if (["procurements", "bids", "contracts"].includes(col)) {
      const me = await callerIdentity(req, body);
      if (!me) return NextResponse.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, { status: 401 });
      const unitType = await callerUnitType(me);
      const dept = isDeptHead(me, unitType);
      const reviewer = isProcReviewer(me, unitType);
      const preparer = me.role === "STAFF";
      const deny = () => NextResponse.json({ ok: false, error: { code: "PERMISSION_DENIED" } }, { status: 403 });
      const keys = Object.keys(body.update || {});
      if (col === "procurements") {
        // Winner selection is a controlled decision: only the rank-1 bidder
        // may be selected (rank-1 becomes the contractor) — recorded by the
        // Section head (or Unit head). Committee/LOI/contract linkage likewise.
        const DECISION = ["committee", "loiNo", "loiDate", "contract", "bidder", "selection"];
        const touchesDecision = DECISION.some((k) => keys.includes(k));
        const cancel = body.update?.stage === "CANCELLED";
        const clientSetsStages = keys.includes("stage") || keys.includes("stages");
        // Auto-issue: saving a complete tender notice (no + date) issues
        // the tender — NOTICE flips DONE inside the preparer's own save, so
        // staff are never stuck with "issue the notice first" and no way
        // forward. Everything past NOTICE still needs reviewer/dept moves.
        let autoIssued = false;
        if (!clientSetsStages) {
          const mergedNo = body.update?.noticeNo ?? doc.noticeNo;
          const mergedDate = body.update?.noticeDate ?? doc.noticeDate;
          if (String(mergedNo || "").trim() && String(mergedDate || "").trim()) {
            const beforeNotice = doc.stages?.NOTICE;
            if (!["DONE", "SKIPPED"].includes(beforeNotice)) {
              // Preparation is implicitly complete once a notice exists.
              const merged = { ...(doc.stages || {}) };
              if (!["DONE", "SKIPPED"].includes(merged.PREPARATION)) merged.PREPARATION = "DONE";
              merged.NOTICE = "DONE";
              const following = PROC_STAGES.find((s) => !["DONE", "SKIPPED"].includes(merged[s] || "PENDING")) || "COMPLETION";
              body.update = {
                ...body.update,
                stages: merged,
                stage: following,
                stageSince: new Date().toISOString().slice(0, 10),
              };
              autoIssued = true;
            }
          }
        }
        // An approval = any stage newly marked DONE/SKIPPED versus storage
        // (the auto-issued PREPARATION/NOTICE above is preparer work, not
        // an approval).
        let approves = false;
        const after = body.update?.stages;
        if (after && typeof after === "object") {
          const before = doc.stages || {};
          for (const [s, v] of Object.entries(after)) {
            if ((s === "NOTICE" || s === "PREPARATION") && autoIssued) continue;
            if (["DONE", "SKIPPED"].includes(v) && !["DONE", "SKIPPED"].includes(before[s])) { approves = true; break; }
          }
        }
        if (touchesDecision || cancel || approves) {
          // Winner selection, committee, LOI and contract linkage are
          // executed by the Section head (and may also be done by the Unit
          // head) — staff ranking is disabled, so no staff carve-out.
          if (!dept && !reviewer) return deny();
        } else if (clientSetsStages) {
          if (!(dept || reviewer)) return deny();
        } else if (!preparer) {
          return deny();
        }
        // Recording a winner selection requires ranked bids (evaluation
        // first) — and it must be the rank-1 bidder, who becomes the
        // contractor. Anything else is refused.
        if (body.update?.selection?.bidder) {
          let ranked = 0;
          try {
            ranked = await getModel("bids").countDocuments({ pkg: doc.pkg, rank: { $ne: null } });
          } catch {}
          if (!ranked) return NextResponse.json({ ok: false, error: { code: "EVALUATION_REQUIRED" } }, { status: 422 });
          const top = await getRankOneBid(doc.pkg);
          if (!top || top.rank !== 1) return NextResponse.json({ ok: false, error: { code: "EVALUATION_REQUIRED" } }, { status: 422 });
          if (String(body.update.selection.bidder) !== String(top.bidder) || Number(body.update.selection.amount) !== Number(top.amount)) {
            return NextResponse.json({ ok: false, error: { code: "RANK_ONE_ONLY" } }, { status: 422 });
          }
        }
        // LOI only after an explicit winner selection exists.
        if ((keys.includes("loiNo") || keys.includes("loiDate")) && !doc.selection?.bidder && !body.update?.selection?.bidder) {
          return NextResponse.json({ ok: false, error: { code: "SELECTION_REQUIRED" } }, { status: 422 });
        }
      } else if (col === "bids") {
        // Scoring + ranking is evaluation work (Section head, and the Unit
        // head too). Staff may only enter/correct bidder + amount — and
        // once a winner is selected, bidder/amount lock (scores/ranks may
        // still be re-run: Evaluate re-syncs the selection to rank 1).
        const touchesEntry = body.update?.bidder !== undefined || body.update?.amount !== undefined;
        const touchesEval = body.update?.score !== undefined || (body.update?.rank !== undefined && body.update?.rank !== null);
        // Bidder/amount lock once a winner is selected (scores/ranks may
        // still be re-run — Evaluate re-syncs the selection to rank 1).
        if (touchesEntry) {
          let proc = null;
          try {
            proc = await getModel("procurements").findOne({ pkg: doc.pkg }).lean();
          } catch {}
          if (proc?.selection?.bidder) {
            return NextResponse.json({ ok: false, error: { code: "SELECTION_LOCKED" } }, { status: 409 });
          }
          // Bidder name can never be blanked, amount must stay positive.
          if (body.update?.bidder !== undefined && !String(body.update.bidder || "").trim()) {
            return NextResponse.json({ ok: false, error: { code: "BIDDER_REQUIRED" } }, { status: 422 });
          }
          if (body.update?.amount !== undefined && !(Number(body.update.amount) > 0)) {
            return NextResponse.json({ ok: false, error: { code: "AMOUNT_POSITIVE" } }, { status: 422 });
          }
        }
        if (touchesEval) {
          if (!dept && !reviewer) return deny();
        } else if (!preparer) {
          return deny();
        }
      } else if (col === "contracts") {
        // Contract approval (any status move, e.g. PENDING_APPROVAL → ACTIVE)
        // is the Unit head's alone; other contract edits may also be made by
        // the Section head who drafted it.
        if (body.update?.status !== undefined) {
          if (!dept) return deny();
          // Valid-transition check: only lifecycle moves allowed
          // (e.g. ACTIVE → COMPLETED → CLOSED, CLOSED → COMPLETED reopen).
          // Direct jumps like ACTIVE → CLOSED are refused.
          try {
            const from = doc.status;
            const to = body.update.status;
            const lc = LIFECYCLES.contract;
            const t = (lc?.transitions || []).find((x) => x.from.includes(from) && x.to === to);
            if (!t) {
              return NextResponse.json({ ok: false, error: { code: "INVALID_TRANSITION", from, to } }, { status: 422 });
            }
            if ((t.needs || []).includes("reason")) {
              const reason = body.reason || body.comment || body.update.reason || "";
              if (!String(reason || "").trim()) {
                return NextResponse.json({ ok: false, error: { code: "REASON_REQUIRED", action: t.action } }, { status: 422 });
              }
            }
          } catch {}
          // Close guard: COMPLETED → CLOSED needs every bill APPROVED+paid
          // and every milestone retention released. Without this a contract
          // could be closed with "Held" retention and "payment due" bills —
          // exactly the stuck state users reported (no way to pay after
          // close makes sense). Refuse with a specific code so UI explains
          // how to pay first (Expenditures → Record payment).
          if (body.update.status === "CLOSED") {
            try {
              const E = getModel("expenditures");
              const bills = await E.find({ contractId: doc.id }).lean();
              const unpaid = bills.filter((b) => b.status !== "REVERSED" && (b.status !== "APPROVED" || !b.paidDate));
              if (unpaid.length) {
                return NextResponse.json({ ok: false, error: { code: "CLOSE_BLOCKED_UNPAID", unpaid: unpaid.map((b) => b.voucher) } }, { status: 422 });
              }
              const nextMilestones = body.update.milestones ?? doc.milestones ?? [];
              const held = (nextMilestones || []).filter((m) => !m.retentionReleased);
              // Only enforce when milestones exist (legacy contracts without
              // milestones close on bills alone).
              if ((nextMilestones || []).length && held.length) {
                return NextResponse.json({ ok: false, error: { code: "CLOSE_BLOCKED_RETENTION", held: held.map((m) => m.id || m.name) } }, { status: 422 });
              }
            } catch {}
          }
          // Budget ceiling on amount edits too — raised amount + other
          // contracts on the same work can never exceed work budget / line.
          if (body.update.amount !== undefined) {
            try {
              const nextAmt = Number(body.update.amount) || 0;
              if (!(nextAmt > 0)) {
                return NextResponse.json({ ok: false, error: { code: "AMOUNT_POSITIVE" } }, { status: 422 });
              }
              const workId = body.update.work ?? doc.work;
              if (workId) {
                const w = await getModel("works").findOne({ id: workId }).lean();
                const workBudget = Number(w?.budgetPaisa) || 0;
                let lineRevised = 0;
                if (w?.subhead) {
                  const line = await getModel("budget").findOne({ subhead: w.subhead }).lean();
                  lineRevised = Number(line?.revised) || 0;
                }
                const others = await getModel("contracts").find({ work: workId }).lean();
                const otherTotal = (others || []).filter((c) => String(c.id) !== String(doc.id)).reduce((a, c) => a + (Number(c.amount) || 0), 0);
                const caps = [workBudget, lineRevised].filter((n) => n > 0);
                if (caps.length && nextAmt + otherTotal > Math.min(...caps)) {
                  return NextResponse.json({ ok: false, error: { code: "CONTRACT_EXCEEDS_BUDGET", work: workId, amount: nextAmt, ceiling: Math.min(...caps), committed: otherTotal } }, { status: 422 });
                }
              }
            } catch {}
          }
        } else if (!dept && !reviewer) {
          return deny();
        }
      }
    }
    try {
      checkVersion(doc, body.__v);
    } catch (e) {
      return NextResponse.json(e.body, { status: e.status });
    }
    // Credentials: accept `password` (hashed here), never a raw passwordHash.
    const update = { ...(body.update || {}) };
    let converted = null;
    if (update.password) converted = hashPassword(update.password);
    delete update.password;
    delete update.passwordHash;
    if (converted) update.passwordHash = converted;
    Object.assign(doc, update, { updatedBy: body.actor });
    await doc.save();
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e.thrown) return NextResponse.json(e.body, { status: e.status });
    const env = envelopeError("UPDATE_FAILED", e.message, [], 422);
    return NextResponse.json(env.body, { status: env.status });
  }
}

// Hard delete — units + users (PMO Super Admin ONLY) and procurement
// packages (Section + Super Admin).
// - Units: deactivate (PATCH archivedAt) stays the normal path; this
//   permanently removes an empty, unused unit. Refused when the unit still
//   has child units, users or works.
// - Users: permanently removes the account and its sessions. Refused for
//   your own account and for the last ACTIVE Super Admin.
// - Procurements: removes the package (pkg) plus its bids and — if no
//   financial history exists yet — its contract too. Refused only when
//   bills/expenditures were already recorded against the contract: money
//   records are never cascade-deleted; reverse/close them first instead.
export async function DELETE(req, { params }) {
  const { col } = await params;
  if (!["units", "users", "procurements", "bids"].includes(col)) return NextResponse.json({ ok: false, error: { code: "DELETE_NOT_ALLOWED" } }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  try {
    await dbConnect();
  } catch (e) {
    return NextResponse.json({ ok: false, error: "DB_UNAVAILABLE", message: e.message }, { status: 503 });
  }
  const me = await callerIdentity(req, body);
  if (!me) return NextResponse.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, { status: 401 });
  // Department may delete a single bid (wrong/duplicate entry) — but never
  // after a winner is selected or a contract exists, and remaining ranks
  // are cleared so Evaluate must re-run on the true set.
  if (col === "bids") {
    if (!isDeptHead(me, await callerUnitType(me))) {
      return NextResponse.json({ ok: false, error: { code: "PERMISSION_DENIED" } }, { status: 403 });
    }
    const url = new URL(req.url);
    const pkg = url.searchParams.get("pkg") || url.searchParams.get("id") || body?.match?.pkg || body?.pkg;
    const bidder = url.searchParams.get("bidder") || body?.match?.bidder || body?.bidder;
    if (!pkg || !bidder) return NextResponse.json({ ok: false, error: { code: "BAD_REQUEST" } }, { status: 400 });
    const proc = await getModel("procurements").findOne({ pkg }).lean();
    if (!proc) return NextResponse.json({ ok: false, error: { code: "PROCUREMENT_NOT_FOUND" } }, { status: 404 });
    if (proc.selection?.bidder) {
      return NextResponse.json({ ok: false, error: { code: "SELECTION_LOCKED" } }, { status: 409 });
    }
    const linked = await getModel("contracts").countDocuments({ pkg });
    if (linked > 0) {
      return NextResponse.json({ ok: false, error: { code: "CONTRACT_EXISTS" } }, { status: 409 });
    }
    const B = getModel("bids");
    const target = await B.findOne({ pkg, bidder }).lean();
    if (!target) return NextResponse.json({ ok: false, error: { code: "BID_NOT_FOUND" } }, { status: 404 });
    await B.deleteOne({ _id: target._id });
    await B.updateMany({ pkg }, { $set: { rank: null } });
    return NextResponse.json({ ok: true, id: bidder });
  }
  if (col === "procurements") {
    if (!["SUPER_ADMIN", "SECTION_HEAD"].includes(me.role)) {
      return NextResponse.json({ ok: false, error: { code: "PERMISSION_DENIED" } }, { status: 403 });
    }
    const url = new URL(req.url);
    const pkg = url.searchParams.get("id") || body?.match?.pkg || body?.pkg;
    if (!pkg) return NextResponse.json({ ok: false, error: { code: "BAD_REQUEST" } }, { status: 400 });
    const P = getModel("procurements");
    const target = await P.findOne({ pkg }).lean();
    if (!target) return NextResponse.json({ ok: false, error: { code: "NOT_FOUND" } }, { status: 404 });
    const contracts = await getModel("contracts").find({ pkg }).lean();
    if (contracts.length) {
      const ids = contracts.map((c) => c.id).filter(Boolean);
      const bills = ids.length ? await getModel("expenditures").countDocuments({ contractId: { $in: ids } }) : 0;
      if (bills > 0) {
        return NextResponse.json({ ok: false, error: { code: "BILL_EXISTS" } }, { status: 409 });
      }
      await getModel("contracts").deleteMany({ pkg });
    }
    await getModel("bids").deleteMany({ pkg });
    await P.deleteOne({ _id: target._id });
    return NextResponse.json({ ok: true, id: pkg });
  }
  if (me.role !== "SUPER_ADMIN") return NextResponse.json({ ok: false, error: { code: "PERMISSION_DENIED" } }, { status: 403 });
  if (col === "users") {
    const url = new URL(req.url);
    const username = url.searchParams.get("id") || body?.match?.username || body?.username;
    if (!username) return NextResponse.json({ ok: false, error: { code: "BAD_REQUEST" } }, { status: 400 });
    if (String(username).toLowerCase() === String(me.username).toLowerCase()) {
      return NextResponse.json({ ok: false, error: { code: "CANNOT_DELETE_SELF" } }, { status: 422 });
    }
    const Us = getModel("users");
    const target = await Us.findOne({ username }).lean();
    if (!target) return NextResponse.json({ ok: false, error: { code: "NOT_FOUND" } }, { status: 404 });
    if (target.role === "SUPER_ADMIN") {
      const remaining = await Us.countDocuments({ role: "SUPER_ADMIN", status: "ACTIVE", username: { $ne: target.username } });
      if (remaining === 0) return NextResponse.json({ ok: false, error: { code: "LAST_SUPER_ADMIN" } }, { status: 409 });
    }
    await Us.deleteOne({ _id: target._id });
    try { await getModel("sessions").deleteMany({ username: target.username }); } catch {}
    return NextResponse.json({ ok: true, id: target.username });
  }
  const url = new URL(req.url);
  const raw = url.searchParams.get("id") || body?.match?.id || body?.match?.code || body?.id || body?.code;
  if (!raw) return NextResponse.json({ ok: false, error: { code: "BAD_REQUEST" } }, { status: 400 });
  // Legacy rows may carry only `code` (no `id`) — match either, any case.
  const variants = [...new Set([String(raw), String(raw).toLowerCase(), String(raw).toUpperCase()])];
  const U = getModel("units");
  const u = await U.findOne({ $or: [{ id: { $in: variants } }, { code: { $in: variants } }] }).lean();
  if (!u) return NextResponse.json({ ok: false, error: { code: "NOT_FOUND" } }, { status: 404 });
  if (String(u.id || u.code || "").toLowerCase() === "pmo") return NextResponse.json({ ok: false, error: { code: "UNIT_IS_ROOT" } }, { status: 422 });
  const keys = [u.id, u.code].filter(Boolean);
  if (await U.countDocuments({ parent: { $in: keys } }) > 0) {
    return NextResponse.json({ ok: false, error: { code: "UNIT_HAS_CHILDREN" } }, { status: 409 });
  }
  if (await getModel("users").countDocuments({ unitId: { $in: keys } }) > 0) {
    return NextResponse.json({ ok: false, error: { code: "UNIT_HAS_USERS" } }, { status: 409 });
  }
  if (await getModel("works").countDocuments({ orgUnitId: { $in: keys } }) > 0) {
    return NextResponse.json({ ok: false, error: { code: "UNIT_HAS_WORKS" } }, { status: 409 });
  }
  await U.deleteOne({ _id: u._id });
  return NextResponse.json({ ok: true, id: u.id || u.code });
}
