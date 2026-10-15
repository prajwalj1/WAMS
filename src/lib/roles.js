// Roles & permissions management (§5).
// Static PERMS_BY_ROLE in scope.js stays the compiled fallback; the `roles`
// collection (one doc per role) holds SUPER_ADMIN-managed overrides + custom
// roles. Server enforcement merges DB over static via effectivePermsFor() in
// the data API route; this module is client-safe (no mongoose).

import { PERMS_BY_ROLE } from "./scope";

// Every permission string the app gates on. Union of PERMS_BY_ROLE values
// plus operational extras referenced in WRITE_RULES / route guards.
export const ALL_PERMISSIONS = [
  "org.ministry.manage",
  "org.unit.manage",
  "user.manage",
  "work.create",
  "work.submit",
  "tippani.draft",
  "tippani.act",
  "budget.manage",
  "procurement.manage",
  "task.update",
  "dashboard.view",
  "report.export",
  "audit.view",
  "system.internal",
];

// Frozen compiled defaults — "Reset to defaults" restores these.
export const DEFAULT_PERMS = Object.fromEntries(
  Object.entries(PERMS_BY_ROLE).map(([r, perms]) => [r, [...perms]])
);

// Roles whose permission set is locked in the UI/API. SUPER_ADMIN stays
// least-privilege by design (ministries + accounts + read-only monitoring);
// SYSTEM is a non-human service account.
export const LOCKED_ROLES = ["SUPER_ADMIN", "SYSTEM"];

// org.ministry.manage (master settings / admin sections + ministry create)
// is exclusive to SUPER_ADMIN — the API refuses to grant it elsewhere.
export const EXCLUSIVE_PERMS = ["org.ministry.manage"];

export const isValidRoleCode = (code) =>
  /^[A-Z][A-Z0-9_]{2,29}$/.test(String(code || ""));

export const isValidPermission = (p) => ALL_PERMISSIONS.includes(p);

// Merge DB role docs over static defaults. Unknown docs with bad shapes are
// ignored so a corrupt row can never escalate or wipe a role.
export function mergeEffective(dbRoles = []) {
  const out = Object.fromEntries(
    Object.entries(DEFAULT_PERMS).map(([r, perms]) => [r, [...perms]])
  );
  for (const d of dbRoles || []) {
    const code = d?.role || d?.code;
    if (!isValidRoleCode(code)) continue;
    if (!Array.isArray(d?.permissions)) continue;
    const clean = [...new Set(d.permissions.filter(isValidPermission))];
    out[code] = clean;
  }
  return out;
}

// Validate a role doc before POST/PATCH. Returns null when valid, else a code.
export function validateRoleDoc(doc, { isNew = false } = {}) {
  const code = doc?.role;
  if (!isValidRoleCode(code)) return "INVALID_ROLE_CODE";
  if (isNew && LOCKED_ROLES.includes(code)) {
    // Creating a second SUPER_ADMIN/SYSTEM row is never needed — they exist.
    return "LOCKED_ROLE";
  }
  if (!Array.isArray(doc?.permissions)) return "INVALID_PERMISSIONS";
  if (doc.permissions.some((p) => !isValidPermission(p))) return "INVALID_PERMISSIONS";
  if (code !== "SUPER_ADMIN" && (doc.permissions || []).includes("org.ministry.manage"))
    return "EXCLUSIVE_PERMISSION";
  return null;
}
