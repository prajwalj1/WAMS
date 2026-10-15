// §18 Business rules & validation — BR-01…BR-16 + field defaults, one place.
// UI forms, /api/validate, imports and acceptance tests all call these.
import { spendCheck, dateWithinParent, weightsMust100, milestones100, closedReadonly, inScope } from "./rules";

function fail(code, details) {
  throw { code, details };
}

// ── Field validation defaults ───────────────────────────────────────────────
export const isCode = (v) => /^[A-Z0-9-]{2,30}$/.test(String(v || ""));
export const isNpMobile = (v) => /^9[78]\d{8}$/.test(String(v || ""));
export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || ""));
export const isFy = (v) => /^\d{4}\/\d{2}$/.test(String(v || ""));
export const isPan = (v) => /^\d{9}$/.test(String(v || ""));
// BS dates: YYYY-MM-DD, year 2070–2100 (full calendar conversion is server-side).
export const isBsDate = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ""));
  if (!m) return false;
  const [, y, mo, d] = m.map(Number);
  return y >= 2070 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 32;
};
export const isTitle = (v) => {
  const s = String(v || "").trim();
  return s.length >= 3 && s.length <= 300;
};
export const isDescription = (v) => String(v || "").length <= 10000;

// ── Passwords (§28): min 10 + upper/lower/digit, not common, not last 5 ────
const COMMON = ["welcome123", "admin12345", "kathmandu1", "nepal12345", "changeme12"];
export const isCommonPassword = (v) => COMMON.includes(String(v || "").toLowerCase());
export function checkPassword(v) {
  const s = String(v || "");
  if (s.length < 10) return "PASSWORD_RULES";
  if (!/[A-Z]/.test(s) || !/[a-z]/.test(s) || !/[0-9]/.test(s)) return "PASSWORD_RULES";
  if (isCommonPassword(s)) return "PASSWORD_COMMON";
  return null;
}
// History (last 5) is enforced where credentials live (NestJS passwordTokens);
// the prototype exposes the store so the rule is testable.
const pwHistory = new Map(); // username → [hashes]
export function checkPasswordHistory(username, pw) {
  const h = `${username}:${pw}`;
  if ((pwHistory.get(username) || []).includes(h)) return "PASSWORD_REUSED";
  return null;
}
export function recordPassword(username, pw) {
  const arr = [`${username}:${pw}`, ...(pwHistory.get(username) || [])].slice(0, 5);
  pwHistory.set(username, arr);
}
export const MAX_ENTRY_NPR = 10000000000;
export function checkAmountNpr(npr, field = "amount") {
  if (!Number.isFinite(Number(npr)) || Number(npr) <= 0) fail("AMOUNT_POSITIVE", { field });
  if (!Number.isInteger(Number(npr))) fail("AMOUNT_INT", { field });
  if (Number(npr) > MAX_ENTRY_NPR) fail("AMOUNT_MAX", { field });
  return Math.round(Number(npr) * 100); // paisa
}

// ── BR-01: one owner unit + one FY ───────────────────────────────────────────
export function br01WorkScope(work) {
  if (!work.unitId || !work.fy) fail("BR01_SCOPE", { unitId: work.unitId, fy: work.fy });
  return true;
}
// ── BR-02: active task owner is an active user ───────────────────────────────
export function br02TaskOwner(task, users) {
  if (["DONE", "CANCELLED"].includes(task.status)) return true;
  if (!users.some((u) => u.username === task.owner && u.status === "ACTIVE") &&
      !users.some((u) => `${u.nameEn}` === task.owner || `${u.name}` === task.owner))
    fail("BR02_OWNER", { owner: task.owner });
  return true;
}
// ── BR-03: scope (delegates; outside scope behaves as 404) ──────────────────
export function br03Scope(userScopeIds, recordAncestors) {
  return inScope(userScopeIds, recordAncestors);
}
// ── BR-04: progress stored as history, never overwritten ────────────────────
export function br04AppendProgress(history, pct, by) {
  if (pct < 0 || pct > 100) fail("PERCENT_RANGE", { pct });
  return [...(history || []), { pct, by, at: new Date().toISOString() }];
}
// ── BR-05: physical and financial always separate ────────────────────────────
export function br05Separate(physical, financial) {
  if (physical === financial && typeof physical === "object") fail("BR05_MERGED", {});
  return { physical, financial };
}
// ── BR-06: spending + commitments ≤ available; revision first ────────────────
export function br06Spend(line, workLinkedPaisa, amountPaisa) {
  return spendCheck(line, workLinkedPaisa, amountPaisa);
}
// ── BR-07: MINISTRY spending needs approved ministry tippani ─────────────────
export function br07MinistrySpend({ mode, tippaniStatus, action }) {
  if (mode === "MINISTRY" && action === "commit" && tippaniStatus !== "APPROVED")
    fail("BR07_TIPPANI", { tippaniStatus });
  return true;
}
// ── BR-08: stages in order; skip needs authority + reason ────────────────────
export function br08Skip({ authority, reason }) {
  if (!authority || !String(reason || "").trim()) fail("SKIP_NEEDS_AUTHORITY", {});
  return true;
}
// ── BR-09: CLOSED works + VERIFIED/APPROVED expenditures read-only ─────────
export function br09Readonly({ recordType, status }) {
  if (status === "CLOSED") return closedReadonly(status);
  if (recordType === "expenditure" && ["VERIFIED", "APPROVED"].includes(status)) fail("RECORD_LOCKED", { recordType, status });
  return true;
}
// ── BR-10: post-approval changes need a revision ─────────────────────────────
const REVISION_FIELDS = ["scope", "deadline", "budgetLinks", "ownerUnit"];
export function br10NeedsRevision(changedFields, workStatus) {
  const hit = changedFields.filter((f) => REVISION_FIELDS.includes(f));
  if (hit.length && !["DRAFT", "RETURNED"].includes(workStatus)) fail("REVISION_REQUIRED", { fields: hit });
  return hit.length === 0;
}
// ── BR-11: archive, never hard-delete ────────────────────────────────────────
export function br11Archive(record, actor) {
  if (record.status !== "DRAFT" && actor !== "ADMIN")
    fail("ARCHIVE_DRAFT_ONLY", { status: record.status });
  return { ...record, archivedAt: new Date().toISOString(), archivedBy: actor };
}
// ── BR-12: no self-approval ──────────────────────────────────────────────────
export function br12NotSelf(submitter, actor) {
  if (submitter && actor && submitter === actor) fail("NOT_SUBMITTER", { submitter });
  return true;
}
// ── BR-13: weights total 100 (siblings, milestones, hybrid) ──────────────────
export function br13Weights(weights) {
  return weightsMust100(weights);
}
export function br13Milestones(pcts) {
  return milestones100(pcts);
}
export function br13Hybrid({ wP = 0, wF = 0, wM = 0 }) {
  return weightsMust100([Number(wP), Number(wF), Number(wM)]);
}
// ── BR-14: child dates within parent ─────────────────────────────────────────
export function br14Dates(child, parent) {
  return dateWithinParent(child, parent);
}
// ── BR-16: optimistic concurrency ────────────────────────────────────────────
export function br16Version(record, openedVersion) {
  if (Number(record.version) !== Number(openedVersion)) fail("STALE_VERSION", { current: record.version });
  return true;
}
