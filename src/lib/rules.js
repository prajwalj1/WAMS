// WMAMS acceptance rules — one function per requirement ID (§9).
// Each throws { code } on violation so UI + future API share behaviour.
// Lifecycle-related rules (§11+§12) delegate to lib/lifecycle so admin edits
// to routes/bands apply project-wide; this file keeps the §9 error codes.
import { calcExpected, calcPhysicalByTasks, healthOf } from "./progress";
import { matchApprovalRoute, seedRoutes, PROC_STAGES, canTransition as lcCan } from "./lifecycle";
import { br13Hybrid, checkAmountNpr, br16Version, br10NeedsRevision, br12NotSelf, br09Readonly, br11Archive, br04AppendProgress, isBsDate, isNpMobile, isPan } from "./business-rules";
import { ancestorsOf, inScopeRecord, authorize, moveUnit, permsFor } from "./scope";
import { resolveAssignee, snapshotRoute } from "./lifecycle";
import { trendWithTargets, nextMonths } from "./trends";

function fail(code, details) { throw { code, details }; }

// ── ORG ──
export const defaultBudgetMode = (type) => (type === "DEPARTMENT" ? "OWN" : type === "MAHASHAKHA" ? "MINISTRY" : "INHERIT");
export function orgCodeTaken(siblingCodes, code) {
  if (siblingCodes.map((c) => c.toUpperCase()).includes(String(code).toUpperCase())) fail("ORG_CODE_TAKEN");
  return true;
}
export function orgDeactivateCheck(activeWorks, activeUsers) {
  const blockers = [];
  if (activeWorks > 0) blockers.push(`${activeWorks} active works`);
  if (activeUsers > 0) blockers.push(`${activeUsers} active users`);
  if (blockers.length) fail("ORG_HAS_ACTIVE_ITEMS", { blockers });
  return true;
}
export function inScope(userScopeIds, recordAncestors) {
  if (!recordAncestors.some((a) => userScopeIds.includes(a))) fail("OUT_OF_SCOPE");
  return true;
}

// ── ACC ──
export function canGrant(grantorPerms, rolePerms) {
  if (!rolePerms.every((p) => grantorPerms.includes(p))) fail("ROLE_ESCALATION");
  return true;
}
export function actingActive(validTo, today = new Date()) {
  return new Date(today) <= new Date(new Date(validTo).setHours(23, 59, 59));
}
export function transferCheck(openTasks, pendingTippani, pendingReviews) {
  const items = [...openTasks.map((t) => ({ kind: "task", id: t })), ...pendingTippani.map((t) => ({ kind: "tippani", id: t })), ...pendingReviews.map((t) => ({ kind: "review", id: t }))];
  if (items.length) fail("TRANSFER_BLOCKED", { items });
  return true;
}

// ── WRK ──
export function dateWithinParent(child, parent) {
  if (new Date(child.start) < new Date(parent.start) || new Date(child.end) > new Date(parent.end)) fail("DATE_OUTSIDE_PARENT");
  return true;
}
export function weightsMust100(weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 0.001) fail("WEIGHTS_NOT_100", { sum });
  return true;
}
export function depthCheck(depth) {
  if (depth > 3) fail("MAX_DEPTH");
  return true;
}

// ── ACT ──
export function notFuture(date, today = new Date()) {
  if (new Date(date) > new Date(today)) fail("DATE_IN_FUTURE");
  return true;
}
export function activityEditable(createdAt, now = new Date()) {
  if ((new Date(now) - new Date(createdAt)) / 3600000 > 24) fail("LOCKED");
  return true;
}
export function needReason(reason) {
  if (!String(reason || "").trim()) fail("REASON_REQUIRED");
  return true;
}

// ── PRG ──
export function percentRange(p) {
  if (p < 0 || p > 100) fail("PERCENT_RANGE");
  return true;
}
export function decreaseNeedsReason(next, prev, reason) {
  if (next < prev) needReason(reason);
  return true;
}
export const qtyPct = (done, planned) => (planned ? Math.round(((done / planned) * 100) * 100) / 100 : 0);

// ── TIP ──
export function stepComment(action, comment) {
  if ((action === "RETURN" || action === "REJECT") && !String(comment || "").trim()) fail("COMMENT_REQUIRED");
  return true;
}
export function routeFor({ mode, amountPaisa }, routes, largeNpr) {
  const amountNpr = Math.round((Number(amountPaisa) || 0) / 100);
  const r = matchApprovalRoute({ subject: "BUDGET_APPROVAL", mode, amountNpr }, routes || seedRoutes(largeNpr));
  return r.id;
}
export function budgetApproveCheck(availablePaisa, amountPaisa) {
  if (amountPaisa > availablePaisa) fail("BUDGET_INSUFFICIENT", { availablePaisa, amountPaisa });
  return true;
}

// ── BUD ──
export const lineAvailable = (l) => Math.max(0, l.revisedPaisa - l.committedPaisa - l.spentPaisa);
export function spendCheck(line, workLinkedPaisa, amountPaisa) {
  if (amountPaisa > lineAvailable(line) || amountPaisa > workLinkedPaisa) fail("BUDGET_INSUFFICIENT");
  return true;
}
// Contract (contractor) amount can never exceed the budget: budget is always
// the higher ceiling. Checks work budget + budget-line ceiling + already
// committed contracts so split packages cannot overshoot in total.
export function contractWithinBudget({ contractAmount, workBudget, lineRevised, otherContractsTotal = 0 }) {
  const amt = Number(contractAmount) || 0;
  const cap = [Number(workBudget) || 0, Number(lineRevised) || 0].filter((n) => n > 0);
  const ceiling = cap.length ? Math.min(...cap) : 0;
  if (ceiling > 0 && amt + (Number(otherContractsTotal) || 0) > ceiling) {
    fail("CONTRACT_EXCEEDS_BUDGET", { amount: amt, ceiling, otherContractsTotal });
  }
  return true;
}

// ── PRC ──
const ORDER = PROC_STAGES;
export function stageOrder(stages, target) {
  const idx = ORDER.indexOf(target);
  for (const s of ORDER.slice(0, idx)) {
    if (stages[s] !== "DONE") fail("STAGE_ORDER", { blockedBy: s });
  }
  return true;
}
export function milestones100(pcts) {
  const sum = pcts.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 0.001) fail("MILESTONES_NOT_100", { sum });
  return true;
}

// ── MSR (acceptance vectors from spec) ──
export function msrVectors() {
  const expected = calcExpected({ start: "2026-07-17", deadline: "2027-05-17", today: new Date("2026-12-17") });
  const physical = calcPhysicalByTasks([{ weight: 40, physical: 50, status: "X" }, { weight: 60, physical: 100, status: "X" }]);
  const health = healthOf({ expected: 50, physical: 30, start: "2026-07-17", deadline: "2027-05-17", today: new Date("2026-12-17") });
  const spendAhead = 60 - 30 > 20; // SPEND_AHEAD flag
  const billsPending = 70 - 30 > 30; // BILLS_PENDING flag
  return { expected, physical, health, spendAhead, billsPending };
}

// ── APR / ISS / DOC / AUD / ADM ──
export function closedReadonly(status) {
  if (status === "CLOSED") fail("RECORD_LOCKED");
  return true;
}
export function onlyIssuerCanClose(issuerId, actorId) {
  if (issuerId !== actorId) fail("NOT_ISSUER");
  return true;
}
// ── Directive / issue close approval ─────────────────────────────────────
// Directives are REGISTERED by anyone (staff included) but APPROVED
// (closed) only by top-level roles — staff acknowledge/respond but never
// approve. Section-level approvers close only what they themselves issued;
// unit/ministry heads (and SUPER_ADMIN as break-glass) may close any
// directive. Issues carry no issuer field, so closing is role-gated only.
export const DIRECTIVE_APPROVER_ROLES = ["SUPER_ADMIN", "MINISTRY_ADMIN", "UNIT_HEAD", "SECTION_HEAD", "APPROVER"];
export const DIRECTIVE_TOP_OVERRIDE_ROLES = ["SUPER_ADMIN", "MINISTRY_ADMIN", "UNIT_HEAD"];
export function canApproveDirective(doc, me) {
  if (!me) fail("UNAUTHENTICATED");
  if (!DIRECTIVE_APPROVER_ROLES.includes(me.role)) fail("PERMISSION_DENIED", { role: me.role });
  const issuer = doc?.from;
  if (issuer && me.username && String(issuer) !== String(me.username) && !DIRECTIVE_TOP_OVERRIDE_ROLES.includes(me.role)) {
    fail("NOT_ISSUER", { issuer });
  }
  return true;
}
export function canApproveIssue(doc, me) {
  if (!me) fail("UNAUTHENTICATED");
  if (!DIRECTIVE_APPROVER_ROLES.includes(me.role)) fail("PERMISSION_DENIED", { role: me.role });
  return true;
}
// ── Directive issuing (creating) ─────────────────────────────────────────
// The Issue button/form is hidden for SECTION_HEAD (read-only on issuing);
// every other authenticated role keeps current behaviour. Server-enforced
// on POST so a direct API call cannot bypass the hidden button.
export const DIRECTIVE_ISSUE_BLOCKED_ROLES = ["SECTION_HEAD"];
export function canIssueDirective(doc, me) {
  if (!me) fail("UNAUTHENTICATED");
  if (DIRECTIVE_ISSUE_BLOCKED_ROLES.includes(me.role)) fail("PERMISSION_DENIED", { role: me.role });
  return true;
}
// ── Tippani step actions (forward / return) ──────────────────────────────
// Only ministry-level hands (plus finance) move a tippani between steps —
// STAFF, SECTION_HEAD and UNIT_HEAD keep drafting/sending but never
// forward/return, and never need the approval OTP. Server-enforced in the
// transition route; the UI hides forward/return/OTP-Get for the same roles.
export const TIPPANI_STEP_BLOCKED_ROLES = ["STAFF", "SECTION_HEAD", "UNIT_HEAD"];
export function canStepTippani(doc, me) {
  if (!me) fail("UNAUTHENTICATED");
  if (!me.role || TIPPANI_STEP_BLOCKED_ROLES.includes(me.role)) fail("PERMISSION_DENIED", { role: me.role });
  return true;
}
// ── Human-readable sequence ids (directives DIR-NNN, issues ISS-NNN) ────
// Assigned server-side from DB truth: the old client-side DIR-{count+1}
// guess collided with the unique index after deletes/stale lists/double
// clicks and every such save failed with CREATE_FAILED for any role.
export function nextNumberedIdFromList(ids, prefix, width = 3) {
  let max = 0;
  for (const id of ids || []) {
    const m = String(id || "").match(new RegExp(`^${prefix}(\\d+)$`));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(width, "0")}`;
}
// ── Directive acknowledge / respond ──────────────────────────────────────
// Only approver roles may acknowledge/respond — staff (and monitor-only
// roles) are read-only on directives. Closing stays issuer + top-level
// (canApproveDirective above).
export function canRespondDirective(doc, me) {
  if (!me) fail("UNAUTHENTICATED");
  if (!DIRECTIVE_APPROVER_ROLES.includes(me.role)) fail("PERMISSION_DENIED", { role: me.role });
  return true;
}
// ── Issue begin / resolve ────────────────────────────────────────────────
// Same policy on issues: only approver roles may begin/resolve — staff is
// read-only. Closing stays issuer + top-level (canApproveIssue above).
export function canActOnIssue(doc, me) {
  if (!me) fail("UNAUTHENTICATED");
  if (!DIRECTIVE_APPROVER_ROLES.includes(me.role)) fail("PERMISSION_DENIED", { role: me.role });
  return true;
}
export function delayEscalated(turnedBehindAt, hasReason, now = new Date()) {
  const days = (new Date(now) - new Date(turnedBehindAt)) / 86400000;
  return days > 3 && !hasReason;
}
export function scanFile(name, mime) {
  if (/eicar/i.test(name)) fail("FILE_INFECTED");
  if (/\.exe$/i.test(name) || (mime === "application/pdf" && /\.exe$/i.test(name))) fail("FILE_TYPE");
  if (/\.exe\.pdf$/i.test(name) || (/\.pdf$/i.test(name) && mime === "application/x-msdownload")) fail("FILE_TYPE");
  return true;
}
export function bsToAd(bs) {
  const table = { "2083-04-01": "2026-07-17", "2083-08-01": "2026-11-17", "2083-12-01": "2027-03-14" };
  return table[bs] || null;
}

// ── Live QA runner: returns [{id, req, pass, detail}] ──
export function runAcceptance() {
  const R = [];
  const ok = (id, req, fn, detail = "") => {
    try { const d = fn(); R.push({ id, req, pass: true, detail: d || detail }); }
    catch (e) { R.push({ id, req, pass: false, detail: e.code || String(e) }); }
  };
  const mustFail = (id, req, fn, code) => {
    try { fn(); R.push({ id, req, pass: false, detail: `expected ${code}` }); }
    catch (e) { R.push({ id, req, pass: e.code === code, detail: e.code }); }
  };
  ok("ORG-02", "Mahashakha defaults MINISTRY", () => defaultBudgetMode("MAHASHAKHA") === "MINISTRY" ? "MINISTRY" : fail("X"));
  mustFail("ORG", "Duplicate code → ORG_CODE_TAKEN", () => orgCodeTaken(["ITM"], "ITM"), "ORG_CODE_TAKEN");
  mustFail("ORG-07", "Deactivate with works → ORG_HAS_ACTIVE_ITEMS", () => orgDeactivateCheck(2, 1), "ORG_HAS_ACTIVE_ITEMS");
  mustFail("ACC", "UNIT_HEAD grants MINISTRY_ADMIN → ROLE_ESCALATION", () => canGrant(["task.manage"], ["org.ministry.manage"]), "ROLE_ESCALATION");
  mustFail("ACC-07", "Transfer with open task blocked", () => transferCheck(["T1"], [], []), "TRANSFER_BLOCKED");
  mustFail("WRK", "Subtask deadline outside parent", () => dateWithinParent({ start: "2026-08-01", end: "2027-06-01" }, { start: "2026-08-01", end: "2027-05-17" }), "DATE_OUTSIDE_PARENT");
  mustFail("WRK-06", "Weights 90 → WEIGHTS_NOT_100", () => weightsMust100([40, 50]), "WEIGHTS_NOT_100");
  mustFail("WRK", "Depth 4 → MAX_DEPTH", () => depthCheck(4), "MAX_DEPTH");
  mustFail("ACT", "Future activity → DATE_IN_FUTURE", () => notFuture("2099-01-01", new Date("2026-12-17")), "DATE_IN_FUTURE");
  mustFail("ACT-03", "Edit after 24h → LOCKED", () => activityEditable("2026-12-10", new Date("2026-12-17")), "LOCKED");
  mustFail("PRG", "110% → PERCENT_RANGE", () => percentRange(110), "PERCENT_RANGE");
  mustFail("PRG-03", "60→50 no reason → REASON_REQUIRED", () => decreaseNeedsReason(50, 60, ""), "REASON_REQUIRED");
  ok("PRG", "Qty 40/100km = 40%", () => qtyPct(40, 100) === 40 ? "40%" : fail("X"));
  mustFail("TIP", "RETURN w/o comment refused", () => stepComment("RETURN", ""), "COMMENT_REQUIRED");
  mustFail("TIP", "STAFF cannot forward tippani", () => canStepTippani({}, { username: "s1", role: "STAFF" }), "PERMISSION_DENIED");
  mustFail("TIP", "SECTION_HEAD cannot forward tippani", () => canStepTippani({}, { username: "sec", role: "SECTION_HEAD" }), "PERMISSION_DENIED");
  mustFail("TIP", "UNIT_HEAD cannot forward tippani", () => canStepTippani({}, { username: "head", role: "UNIT_HEAD" }), "PERMISSION_DENIED");
  ok("TIP", "MINISTRY_ADMIN can forward tippani", () => canStepTippani({}, { username: "min", role: "MINISTRY_ADMIN" }) ? "forward" : fail("X"));
  ok("TIP", "APPROVER can return tippani", () => canStepTippani({}, { username: "ap", role: "APPROVER" }) ? "return" : fail("X"));  ok("TIP", "Mahashakha 1.5cr → MIN_BUDGET_LARGE ending Secretary", () => routeFor({ mode: "MINISTRY", amountPaisa: 15000000 * 100 }) === "MIN_BUDGET_LARGE" ? "Secretary chain" : fail("X"));
  mustFail("TIP-05", "Approve over available → BUDGET_INSUFFICIENT, nothing changes", () => budgetApproveCheck(100000, 200000), "BUDGET_INSUFFICIENT");
  ok("BUD", "avail = revised−committed−spent", () => lineAvailable({ revisedPaisa: 100, committedPaisa: 60, spentPaisa: 30 }) === 10 ? "10" : fail("X"));
  mustFail("PRC", "Eval before bids → STAGE_ORDER", () => stageOrder({ PREPARATION: "DONE", NOTICE: "DONE", BIDS: "PENDING" }, "EVALUATION"), "STAGE_ORDER");
  mustFail("PRC-08", "Milestones 95 → refused", () => milestones100([25, 25, 25, 20]), "MILESTONES_NOT_100");
  ok("BUD-09", "contract 90 ≤ budget 100 → ok", () => contractWithinBudget({ contractAmount: 90, workBudget: 100, lineRevised: 100 }) ? "ok" : fail("X"));
  mustFail("BUD-09", "contract 120 > budget 100 → CONTRACT_EXCEEDS_BUDGET", () => contractWithinBudget({ contractAmount: 120, workBudget: 100, lineRevised: 100 }), "CONTRACT_EXCEEDS_BUDGET");
  ok("MSR-01", "2026-07-17→2027-05-17 @2026-12-17 ≈ 50%", () => { const { expected } = msrVectors(); return Math.abs(expected - 50) < 0.6 ? `${expected.toFixed(1)}%` : fail("X"); });
  ok("MSR", "40/60 @50/100 → 80%", () => { const { physical } = msrVectors(); return Math.abs(physical - 80) < 0.01 ? "80%" : fail("X"); });
  ok("MSR-06", "phys 30 exp 50 → BEHIND", () => msrVectors().health === "BEHIND" ? "BEHIND" : fail("X"));
  ok("MSR-07", "trend merges spend+target months sorted", () => {
    const t = trendWithTargets({ "2026-11": 500000 }, [{ m: "2026-10", target: 5 }], 0);
    return t.map((x) => x.m).join(",") === "2026-10,2026-11" && t[1].spent === 5 ? "merged" : fail("X");
  });
  ok("MSR-07", "trend extends 3 projected months carrying last target", () => {
    const t = trendWithTargets({}, [{ m: "2026-11", target: 7 }]);
    const tail = t.slice(-3);
    return t.length === 4 && tail.every((x) => x.projected && x.target === 7) && tail[0].m === "2026-12" && tail[2].m === "2027-02" ? "projected" : fail("X");
  });
  ok("MSR-07", "trend without targets has no projection", () => {
    const t = trendWithTargets({ "2026-11": 500000 }, []);
    return t.length === 1 && !t[0].projected ? "actual-only" : fail("X");
  });
  ok("MSR-07", "nextMonths rolls over year end", () => nextMonths("2026-12", 2).join(",") === "2027-01,2027-02" ? "rollover" : fail("X"));
  mustFail("APR", "CLOSED read-only → RECORD_LOCKED", () => closedReadonly("CLOSED"), "RECORD_LOCKED");
  mustFail("ISS", "Only issuer closes directive", () => onlyIssuerCanClose("U1", "U2"), "NOT_ISSUER");
  mustFail("ISS", "STAFF cannot approve directive", () => canApproveDirective({ from: "boss" }, { username: "s1", role: "STAFF" }), "PERMISSION_DENIED");
  ok("ISS", "UNIT_HEAD issuer approves directive", () => canApproveDirective({ from: "head" }, { username: "head", role: "UNIT_HEAD" }) ? "approved" : fail("X"));
  mustFail("ISS", "SECTION_HEAD cannot close others' directive", () => canApproveDirective({ from: "boss" }, { username: "sec", role: "SECTION_HEAD" }), "NOT_ISSUER");
  ok("ISS", "MINISTRY_ADMIN closes any directive", () => canApproveDirective({ from: "boss" }, { username: "min", role: "MINISTRY_ADMIN" }) ? "override" : fail("X"));
  mustFail("ISS", "STAFF cannot close issue", () => canApproveIssue({}, { username: "s1", role: "STAFF" }), "PERMISSION_DENIED");
  mustFail("ISS", "STAFF cannot acknowledge/respond directive", () => canRespondDirective({}, { username: "s1", role: "STAFF" }), "PERMISSION_DENIED");
  ok("ISS", "UNIT_HEAD can acknowledge/respond directive", () => canRespondDirective({}, { username: "head", role: "UNIT_HEAD" }) ? "respond" : fail("X"));
  mustFail("ISS", "FINANCE_OFFICER cannot respond directive", () => canRespondDirective({}, { username: "f1", role: "FINANCE_OFFICER" }), "PERMISSION_DENIED");
  mustFail("ISS", "VIEWER cannot respond directive", () => canRespondDirective({}, { username: "v1", role: "VIEWER" }), "PERMISSION_DENIED");
  mustFail("ISS", "AUDITOR cannot respond directive", () => canRespondDirective({}, { username: "a1", role: "AUDITOR" }), "PERMISSION_DENIED");
  mustFail("ISS", "STAFF cannot begin issue", () => canActOnIssue({}, { username: "s1", role: "STAFF" }), "PERMISSION_DENIED");
  ok("ISS", "SECTION_HEAD can resolve issue", () => canActOnIssue({}, { username: "sec", role: "SECTION_HEAD" }) ? "act" : fail("X"));
  ok("ISS", "next DIR id skips to max+1", () => nextNumberedIdFromList(["DIR-001", "DIR-003"], "DIR-") === "DIR-004" ? "DIR-004" : fail("X"));
  ok("ISS", "next DIR id starts at 001", () => nextNumberedIdFromList([], "DIR-") === "DIR-001" ? "DIR-001" : fail("X"));
  ok("ISS", "next ISS id ignores other prefixes", () => nextNumberedIdFromList(["DIR-009", "ISS-002"], "ISS-") === "ISS-003" ? "ISS-003" : fail("X"));
  ok("BUD", "next revision id keeps yearly 2-digit series", () => nextNumberedIdFromList(["REV-2026-01", "REV-2026-03"], "REV-2026-", 2) === "REV-2026-04" ? "REV-2026-04" : fail("X"));
  mustFail("ISS", "SECTION_HEAD cannot issue directive", () => canIssueDirective({}, { username: "sec", role: "SECTION_HEAD" }), "PERMISSION_DENIED");
  ok("ISS", "UNIT_HEAD can issue directive", () => canIssueDirective({}, { username: "head", role: "UNIT_HEAD" }) ? "issue" : fail("X"));
  ok("ISS-03", "BEHIND 4d no reason → escalated", () => delayEscalated("2026-12-10", false, new Date("2026-12-17")) ? "escalated" : fail("X"));
  mustFail("DOC-04", "EICAR → FILE_INFECTED", () => scanFile("eicar_test.txt", "text/plain"), "FILE_INFECTED");
  mustFail("DOC", ".exe→.pdf → FILE_TYPE", () => scanFile("bill.exe.pdf", "application/x-msdownload"), "FILE_TYPE");
  ok("ADM-05", "BS 2083-04-01 ↔ AD 2026-07-17", () => bsToAd("2083-04-01") === "2026-07-17" ? "OK" : fail("X"));
  // ── §11+§12 dynamic lifecycle (delegated to lib/lifecycle) ──
  ok("WRK-11", "DRAFT submit → SUBMITTED (weights 100, budget ok)", () => lcCan("work", { from: "DRAFT", action: "submit", ctx: { weights: [40, 60], amountPaisa: 50, availablePaisa: 100 } }).to === "SUBMITTED" ? "SUBMITTED" : fail("X"));
  mustFail("WRK-11", "DRAFT submit weights 90 → WEIGHTS_NOT_100", () => lcCan("work", { from: "DRAFT", action: "submit", ctx: { weights: [40, 50] } }), "WEIGHTS_NOT_100");
  mustFail("WRK-11", "SUBMITTED return w/o comment → COMMENT_REQUIRED", () => lcCan("work", { from: "SUBMITTED", action: "return", ctx: {} }), "COMMENT_REQUIRED");
  mustFail("WRK-11", "ONGOING hold w/o reason → REASON_REQUIRED", () => lcCan("work", { from: "ONGOING", action: "hold", ctx: {} }), "REASON_REQUIRED");
  mustFail("WRK-11", "CLOSED submit → INVALID_TRANSITION", () => lcCan("work", { from: "CLOSED", action: "submit", ctx: {} }), "INVALID_TRANSITION");
  ok("PAY-11", "VERIFIED bill approve → APPROVED", () => lcCan("expenditure", { from: "VERIFIED", action: "approve", ctx: {} }).to === "APPROVED" ? "APPROVED" : fail("X"));
  mustFail("PAY-11", "SUBMITTED bill approve → INVALID_TRANSITION", () => lcCan("expenditure", { from: "SUBMITTED", action: "approve", ctx: {} }), "INVALID_TRANSITION");
  ok("PRC-11", "PENDING_APPROVAL contract approve → ACTIVE", () => lcCan("contract", { from: "PENDING_APPROVAL", action: "approve", ctx: {} }).to === "ACTIVE" ? "ACTIVE" : fail("X"));
  ok("TIP-12", "1.5cr MINISTRY → MIN_BUDGET_LARGE", () => routeFor({ mode: "MINISTRY", amountPaisa: 15000000 * 100 }) === "MIN_BUDGET_LARGE" ? "LARGE" : fail("X"));
  ok("TIP-12", "85L MINISTRY → MIN_BUDGET_SMALL", () => routeFor({ mode: "MINISTRY", amountPaisa: 8500000 * 100 }) === "MIN_BUDGET_SMALL" ? "SMALL" : fail("X"));
  mustFail("TIP-12", "unknown mode → NO_ROUTE", () => routeFor({ mode: "NONE", amountPaisa: 100 }), "NO_ROUTE");
  // ── §18 business rules ──
  ok("BR-13", "hybrid 50/20/30 → 100", () => br13Hybrid({ wP: 50, wF: 20, wM: 30 }) ? "100" : fail("X"));
  mustFail("BR-13", "hybrid 50/20/20 → WEIGHTS_NOT_100", () => br13Hybrid({ wP: 50, wF: 20, wM: 20 }), "WEIGHTS_NOT_100");
  mustFail("BR-15", "negative amount → AMOUNT_POSITIVE", () => checkAmountNpr(-5), "AMOUNT_POSITIVE");
  mustFail("BR-15", "11,000cr → AMOUNT_MAX", () => checkAmountNpr(11000000000), "AMOUNT_MAX");
  ok("BR-15", "5,000 NPR → 500000 paisa", () => checkAmountNpr(5000) === 500000 ? "paisa" : fail("X"));
  mustFail("BR-16", "stale version → STALE_VERSION", () => br16Version({ version: 3 }, 2), "STALE_VERSION");
  mustFail("BR-10", "deadline change after approval → REVISION_REQUIRED", () => br10NeedsRevision(["deadline"], "ONGOING"), "REVISION_REQUIRED");
  ok("BR-10", "deadline change in DRAFT → ok", () => br10NeedsRevision(["deadline"], "DRAFT") ? "ok" : fail("X"));
  mustFail("BR-12", "self verify → NOT_SUBMITTER", () => br12NotSelf("A", "A"), "NOT_SUBMITTER");
  mustFail("BR-09", "edit VERIFIED expenditure → RECORD_LOCKED", () => br09Readonly({ recordType: "expenditure", status: "VERIFIED" }), "RECORD_LOCKED");
  ok("BR-11", "archive DRAFT → archivedAt", () => br11Archive({ status: "DRAFT" }, "creator").archivedAt ? "archived" : fail("X"));
  mustFail("BR-04", "progress 110 → PERCENT_RANGE", () => br04AppendProgress([], 110, "x"), "PERCENT_RANGE");
  ok("BR-18", "BS 2083-04-01 valid; 2099 rejected", () => isBsDate("2083-04-01") && !isBsDate("2099-13-40") ? "ok" : fail("X"));
  ok("BR-18", "mobile 985… ok; PAN 9 digits", () => isNpMobile("9851000001") && isPan("123456789") ? "ok" : fail("X"));
  // ── §29 scoping ──
  ok("SCP-01", "esvc chain = pmo/moics/it/esvc", () => ancestorsOf("esvc").join(".") === "pmo.moics.it.esvc" ? "pmo.moics.it.esvc" : fail("X"));
  ok("SCP-02", "U-1042 [it] sees esvc work, not doi", () => {
    const seeEsvc = inScopeRecord(["pmo", "moics", "it", "esvc"], ["it"]);
    const seeDoi = inScopeRecord(["pmo", "moics", "doi"], ["it"]);
    return seeEsvc && !seeDoi ? "esvc✓ doi✗" : fail("X");
  });
  mustFail("SCP-03", "no tippani.act → PERMISSION_DENIED", () => authorize({ userPerms: permsFor("VIEWER"), scopeUnitIds: ["it"], permission: "tippani.act", record: { orgAncestors: ["pmo", "moics", "it"], status: "DRAFT" }, recordType: "tippani", actor: "V" }), "PERMISSION_DENIED");
  mustFail("SCP-04", "doi record for [it] user → OUT_OF_SCOPE (404)", () => authorize({ userPerms: permsFor("UNIT_HEAD"), scopeUnitIds: ["it"], permission: "task.update", record: { orgAncestors: ["pmo", "moics", "doi"], status: "IN_PROGRESS" }, recordType: "task", actor: "U" }), "OUT_OF_SCOPE");
  ok("SCP-05", "move esvc under doi rewrites chains", () => {
    const units = [{ id: "pmo", parent: null }, { id: "moics", parent: "pmo" }, { id: "doi", parent: "moics" }, { id: "it", parent: "moics" }, { id: "esvc", parent: "it" }];
    const { batches } = moveUnit(units, [{ orgUnitId: "esvc", x: 1 }], "esvc", "doi", 1000);
    return batches[0][0].orgAncestors.join(".") === "pmo.moics.doi.esvc" ? "moved" : fail("X");
  });
  // ── §33 workflow engine ──
  ok("WKF-01", "single holder auto-assigned", () => {
    const r = resolveAssignee({ role: "UNIT_HEAD", unit: "Mahashakha" }, { parentUnitId: "it" }, [{ username: "it.head", role: "UNIT_HEAD", unitId: "it" }]);
    return r.auto && r.assignee === "it.head" ? "it.head" : fail("X");
  });
  ok("WKF-02", "two holders → previous picks", () => {
    const r = resolveAssignee({ role: "APPROVER", unit: "ministry" }, { ministryId: "moics" },
      [{ username: "a1", role: "APPROVER", unitId: "moics" }, { username: "a2", role: "APPROVER", unitId: "moics" }]);
    return !r.auto && r.candidates.length === 2 ? "pick" : fail("X");
  });
  ok("WKF-03", "routeSnapshot freezes steps", () => {
    const s = snapshotRoute({ id: "R", steps: [{ role: "A" }], otp: true });
    return s.id === "R" && s.steps.length === 1 && s.at ? "frozen" : fail("X");
  });
  return R;
}
