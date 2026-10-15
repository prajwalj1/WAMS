// WMAMS lifecycles (§11) + approval chains (§12) — single source of truth.
//
// Status is set ONLY by these transitions; every transition writes status
// history + an audit entry. Health (§10) is computed daily, never by hand.
//
// All values are data: admin edits (routes, amount band, steps) flow to every
// page via useWorkflow() in lib/store. Nothing lifecycle-related is hardcoded
// in pages — they call listActions()/canTransition()/applyTransition() and
// matchApprovalRoute() from here.

function fail(code, details) {
  throw { code, details };
}

export const WORK_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "ONGOING",
  "ON_HOLD",
  "COMPLETION_SUBMITTED",
  "VERIFIED",
  "CLOSED",
  "RETURNED",
  "REJECTED",
  "CANCELLED",
];

export const OPEN_WORK_STATUSES = [
  "DRAFT",
  "RETURNED",
  "SUBMITTED",
  "APPROVED",
  "ONGOING",
  "ON_HOLD",
  "COMPLETION_SUBMITTED",
  "VERIFIED",
];

export const TERMINAL_WORK_STATUSES = ["REJECTED", "CLOSED", "CANCELLED"];

// From → action → To, who may act, what is required, side effects.
// `from` may be an array. `needs` is shown in UI and enforced by canTransition.
export const WORK_TRANSITIONS = [
  { from: ["DRAFT", "RETURNED"], action: "submit", to: "SUBMITTED", who: ["Creator", "Owner"], needs: ["required fields valid", "weights = 100", "budget links ≤ line available"], sideEffects: ["MINISTRY-mode + budget → BUDGET_APPROVAL tippani draft"] },
  { from: ["SUBMITTED"], action: "approve", to: "APPROVED", who: ["Route approver"], needs: [], sideEffects: ["commitment created (if via tippani)", "owner notified"] },
  { from: ["SUBMITTED"], action: "return", to: "RETURNED", who: ["Route step holder"], needs: ["comment"], sideEffects: [] },
  { from: ["SUBMITTED"], action: "reject", to: "REJECTED", who: ["Final approver"], needs: ["comment"], terminal: true, sideEffects: [] },
  { from: ["APPROVED"], action: "start", to: "ONGOING", who: ["System (auto)"], auto: true, needs: [], note: "At start date, or at the first confirmed progress update, whichever comes first.", sideEffects: [] },
  { from: ["ONGOING"], action: "hold", to: "ON_HOLD", who: ["UNIT_HEAD"], needs: ["reason"], sideEffects: ["hold days recorded"] },
  { from: ["ON_HOLD"], action: "resume", to: "ONGOING", who: ["UNIT_HEAD"], needs: [], sideEffects: [] },
  { from: ["ONGOING"], action: "submit_completion", to: "COMPLETION_SUBMITTED", who: ["Owner"], needs: ["physical = 100", "completion report attached", "no open tasks"], sideEffects: [] },
  { from: ["COMPLETION_SUBMITTED"], action: "verify", to: "VERIFIED", who: ["APPROVER", "UNIT_HEAD"], needs: ["verifier ≠ submitter"], sideEffects: [] },
  { from: ["COMPLETION_SUBMITTED"], action: "return", to: "ONGOING", who: ["APPROVER", "UNIT_HEAD"], needs: ["comment"], note: "Returned by verifier.", sideEffects: [] },
  { from: ["VERIFIED"], action: "close", to: "CLOSED", who: ["UNIT_HEAD", "FINANCE confirmation"], needs: ["no SUBMITTED expenditures", "retention released or n/a", "remaining commitment released"], sideEffects: [] },
  { from: ["VERIFIED", "CLOSED"], action: "reopen", to: "ONGOING", who: ["work.reopen"], needs: ["reason"], sideEffects: [] },
  { from: ["*open"], action: "cancel", to: "CANCELLED", who: ["REVISION route"], via: "revision", needs: ["revision approved"], terminal: true, sideEffects: ["commitments released", "open tasks cancelled"] },
];

// ── Other lifecycles (§11, lower table) ──────────────────────────────────────
// Generic shape: { states, transitions: [{from, action, to, who, needs}] }
export const LIFECYCLES = {
  task: {
    states: ["NOT_STARTED", "IN_PROGRESS", "DONE", "ON_HOLD", "CANCELLED"],
    transitions: [
      { from: ["NOT_STARTED"], action: "begin", to: "IN_PROGRESS", who: ["Owner"], needs: ["first activity or update", "dependencies done"] },
      { from: ["IN_PROGRESS", "ON_HOLD"], action: "complete", to: "DONE", who: ["Owner"], needs: ["100% confirmed"] },
      { from: ["NOT_STARTED", "IN_PROGRESS"], action: "hold", to: "ON_HOLD", who: ["Owner"], needs: ["reason"] },
      { from: ["ON_HOLD"], action: "resume", to: "IN_PROGRESS", who: ["Owner"], needs: [] },
      { from: ["NOT_STARTED", "IN_PROGRESS", "ON_HOLD"], action: "cancel", to: "CANCELLED", who: ["Owner of parent"], needs: ["reason"] },
    ],
  },
  progressUpdate: {
    states: ["SUBMITTED", "CONFIRMED", "RETURNED"],
    transitions: [
      { from: ["SUBMITTED"], action: "confirm", to: "CONFIRMED", who: ["Reviewer"], needs: [], note: "Auto-CONFIRMED when the work type does not require confirmation." },
      { from: ["SUBMITTED"], action: "return", to: "RETURNED", who: ["Reviewer"], needs: ["comment"] },
      { from: ["RETURNED"], action: "resubmit", to: "SUBMITTED", who: ["Submitter"], needs: [] },
    ],
  },
  tippani: {
    states: ["DRAFT", "IN_REVIEW", "APPROVED", "REJECTED", "RETURNED", "WITHDRAWN"],
    transitions: [
      { from: ["DRAFT", "RETURNED"], action: "send", to: "IN_REVIEW", who: ["Drafter"], needs: ["route preview shown"] },
      { from: ["IN_REVIEW"], action: "forward", to: "IN_REVIEW", who: ["Step holder"], needs: [], note: "Step 1…n." },
      { from: ["IN_REVIEW"], action: "approve", to: "APPROVED", who: ["Approver"], needs: ["OTP on final decision"] },
      { from: ["IN_REVIEW"], action: "reject", to: "REJECTED", who: ["Final approver"], needs: ["comment"] },
      { from: ["IN_REVIEW"], action: "return", to: "RETURNED", who: ["Step holder"], needs: ["comment"], note: "RETURNED → DRAFT next round." },
      { from: ["DRAFT"], action: "withdraw", to: "WITHDRAWN", who: ["Drafter"], needs: ["before the first action"] },
    ],
  },
  expenditure: {
    states: ["DRAFT", "SUBMITTED", "VERIFIED", "APPROVED", "RETURNED", "REVERSED"],
    transitions: [
      { from: ["DRAFT", "RETURNED"], action: "submit", to: "SUBMITTED", who: ["Staff"], needs: [] },
      { from: ["SUBMITTED"], action: "verify", to: "VERIFIED", who: ["Section"], needs: [] },
      { from: ["SUBMITTED"], action: "return", to: "RETURNED", who: ["Section"], needs: ["comment"] },
      // Payment approval is separate from measurement verification: the
      // department approves a VERIFIED bill, and only APPROVED bills can
      // be paid. Physical progress and financial payment stay decoupled.
      { from: ["VERIFIED"], action: "approve", to: "APPROVED", who: ["Department"], needs: [] },
      { from: ["VERIFIED"], action: "return", to: "RETURNED", who: ["Department"], needs: ["comment"] },
      { from: ["APPROVED"], action: "reverse", to: "REVERSED", who: ["Finance"], needs: ["reason"], note: "Creates a negative entry." },
    ],
  },
  budgetRevision: {
    states: ["REQUESTED", "APPROVED", "REJECTED"],
    transitions: [
      { from: ["REQUESTED"], action: "approve", to: "APPROVED", who: ["Approver"], needs: [] },
      { from: ["REQUESTED"], action: "reject", to: "REJECTED", who: ["Approver"], needs: ["comment"] },
    ],
  },
  procurement: {
    states: ["PENDING", "IN_PROGRESS", "DONE", "SKIPPED", "CANCELLED"],
    note: "Each stage PENDING → IN_PROGRESS → DONE | SKIPPED. Procurement status = the current stage. It can be CANCELLED (re-tender or abandon).",
    transitions: [
      { from: ["PENDING"], action: "begin", to: "IN_PROGRESS", who: ["Procurement officer"], needs: ["previous stages DONE"] },
      { from: ["IN_PROGRESS"], action: "done", to: "DONE", who: ["Procurement officer"], needs: [] },
      { from: ["PENDING", "IN_PROGRESS"], action: "skip", to: "SKIPPED", who: ["Approver"], needs: ["reason"] },
      { from: ["PENDING", "IN_PROGRESS"], action: "cancel", to: "CANCELLED", who: ["Approver"], needs: ["reason", "re-tender or abandon"] },
    ],
  },
  contract: {
    states: ["PENDING_APPROVAL", "ACTIVE", "COMPLETED", "CLOSED", "TERMINATED"],
    transitions: [
      // Contracts are created PENDING_APPROVAL and become ACTIVE only after
      // department approval — never directly ACTIVE.
      { from: ["PENDING_APPROVAL"], action: "approve", to: "ACTIVE", who: ["Approver"], needs: ["selection + LOI verified"] },
      { from: ["PENDING_APPROVAL"], action: "return", to: "TERMINATED", who: ["Approver"], needs: ["reason"], note: "Rejected before activation." },
      { from: ["ACTIVE"], action: "complete", to: "COMPLETED", who: ["Owner"], needs: [] },
      { from: ["COMPLETED"], action: "close", to: "CLOSED", who: ["Finance"], needs: ["retention released"] },
      { from: ["ACTIVE"], action: "terminate", to: "TERMINATED", who: ["Approver"], needs: ["reason", "approval ref"] },
      // Reopen (fix a wrong status, e.g. CLOSED with unpaid bills / held
      // retention): reason required, audited like every other transition.
      { from: ["CLOSED"], action: "reopen", to: "COMPLETED", who: ["Approver"], needs: ["reason"], note: "Fix wrongly closed contract, then pay + release." },
      { from: ["COMPLETED"], action: "reopen", to: "ACTIVE", who: ["Approver"], needs: ["reason"], note: "Back to ACTIVE for more bills." },
      { from: ["TERMINATED"], action: "reopen", to: "ACTIVE", who: ["Approver"], needs: ["reason"], note: "Revive wrongly terminated contract." },
    ],
  },
  issue: {
    states: ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"],
    transitions: [
      { from: ["OPEN"], action: "begin", to: "IN_PROGRESS", who: ["Top-level approver"], needs: [], note: "Staff is read-only on issues (server-enforced)." },
      { from: ["IN_PROGRESS"], action: "resolve", to: "RESOLVED", who: ["Top-level approver"], needs: [], note: "Staff is read-only on issues (server-enforced)." },
      { from: ["RESOLVED"], action: "close", to: "CLOSED", who: ["Issuer + top-level approver"], needs: [], note: "Staff cannot close — top-level approval required (server-enforced)." },
    ],
  },
  directive: {
    states: ["ISSUED", "ACKNOWLEDGED", "RESPONDED", "CLOSED"],
    transitions: [
      { from: ["ISSUED"], action: "acknowledge", to: "ACKNOWLEDGED", who: ["Top-level approver"], needs: [], note: "Staff is read-only on directives (server-enforced)." },
      { from: ["ACKNOWLEDGED"], action: "respond", to: "RESPONDED", who: ["Top-level approver"], needs: [], note: "Staff is read-only on directives (server-enforced)." },
      { from: ["RESPONDED"], action: "close", to: "CLOSED", who: ["Issuer + top-level approver"], needs: [], note: "Staff cannot approve — top-level role required (server-enforced)." },
      { from: ["RESPONDED"], action: "ask_more", to: "ACKNOWLEDGED", who: ["Issuer + top-level approver"], needs: ["comment"], note: "Back to ACKNOWLEDGED if the approver asks for more." },
    ],
  },
};

export const PROC_STAGES = ["PREPARATION", "NOTICE", "BIDS", "EVALUATION", "SELECTION", "AGREEMENT", "WORK_ORDER", "IMPLEMENTATION", "COMPLETION"];

// ── Approval routes (§12 seeds) ─────────────────────────────────────────────
// scope: { units: [exact unit ids] | [], unitTypes: [], ministry: null | id }.
// Specificity for matching order: exact unit (3) > unit type in ministry (2) >
// ministry default (1) > system default (0). amountBand: [minNpr, maxNpr].
export const LARGE_BAND_DEFAULT_NPR = 10000000; // NPR 1 crore — delegation example, ministry must confirm.

export function seedRoutes(largeNpr = LARGE_BAND_DEFAULT_NPR) {
  return [
    { id: "MIN_BUDGET_LARGE", subject: "BUDGET_APPROVAL", mode: "MINISTRY", minNpr: largeNpr + 1, maxNpr: null, scope: { level: "system" }, otp: true, enabled: true,
      steps: [{ role: "SECTION_HEAD", unit: "own section" }, { role: "UNIT_HEAD", unit: "Mahashakha" }, { role: "APPROVER", title: "Joint Secretary", unit: "ministry" }, { role: "APPROVER", title: "Secretary", unit: "ministry" }] },
    { id: "MIN_BUDGET_SMALL", subject: "BUDGET_APPROVAL", mode: "MINISTRY", minNpr: 0, maxNpr: largeNpr, scope: { level: "system" }, otp: true, enabled: true,
      steps: [{ role: "SECTION_HEAD", unit: "own section" }, { role: "UNIT_HEAD", unit: "Mahashakha" }, { role: "APPROVER", title: "Joint Secretary", unit: "ministry" }] },
    { id: "DEPT_BUDGET", subject: "BUDGET_APPROVAL", mode: "OWN", minNpr: 0, maxNpr: null, scope: { level: "system" }, otp: false, enabled: true,
      steps: [{ role: "SECTION_HEAD", unit: "own section" }, { role: "APPROVER", title: "Director General", unit: "department" }] },
    { id: "WORK_APPROVAL", subject: "WORK", mode: null, minNpr: 0, maxNpr: 0, scope: { level: "system" }, otp: false, enabled: true, note: "Works without budget",
      steps: [{ role: "SECTION_HEAD", unit: "own section" }, { role: "UNIT_HEAD", unit: "parent unit" }] },
    { id: "REVISION", subject: "REVISION", mode: null, minNpr: 0, maxNpr: null, scope: { level: "system" }, otp: false, enabled: true, note: "Scope, deadline, budget, owner-unit changes, cancellation",
      steps: [{ role: "UNIT_HEAD", unit: "own unit" }, { role: "APPROVER", title: "original authority", unit: "approving unit" }] },
    { id: "COMPLETION", subject: "COMPLETION", mode: null, minNpr: 0, maxNpr: null, scope: { level: "system" }, otp: false, enabled: true, note: "UNIT_HEAD or APPROVER (not the submitter)",
      steps: [{ role: "UNIT_HEAD|APPROVER", unit: "own unit", excludeSubmitter: true }] },
    { id: "BUDGET_REVISION", subject: "BUDGET_REVISION", mode: null, minNpr: 0, maxNpr: null, scope: { level: "system" }, otp: false, enabled: true, note: "Budget transfers",
      steps: [{ role: "FINANCE_OFFICER", unit: "finance" }, { role: "APPROVER", title: "Secretary / DG", unit: "ministry / department" }] },
  ];
}

function specificity(route, q) {
  const s = route.scope || {};
  if (s.units?.length && q.unitId && s.units.includes(q.unitId)) return 3;
  if (s.unitTypes?.length && q.unitType && s.unitTypes.includes(q.unitType)) return 2;
  if (s.ministry && q.ministryId && s.ministry === q.ministryId) return 1;
  if (s.level === "system" || (!s.units?.length && !s.unitTypes?.length && !s.ministry)) return 0;
  return -1; // scope does not cover query
}

// Most specific matching route; match on subject type, budget mode, amount
// band. Throws NO_ROUTE when nothing matches.
export function matchApprovalRoute(q, routes) {
  const list = (routes || []).filter((r) => r.enabled !== false && r.subject === q.subject);
  const cands = list.filter((r) => {
    if (r.mode && q.mode && r.mode !== q.mode) return false;
    const amt = Number(q.amountNpr ?? 0);
    if (r.minNpr != null && amt < r.minNpr) return false;
    if (r.maxNpr != null && amt > r.maxNpr) return false;
    return specificity(r, q) >= 0;
  });
  cands.sort((a, b) => specificity(b, q) - specificity(a, q));
  if (!cands.length) fail("NO_ROUTE", { subject: q.subject, mode: q.mode, amountNpr: q.amountNpr });
  return cands[0];
}

// Convenience for the seeded BUDGET_APPROVAL band split (kept for rules.js).
export function routeIdForBudget({ mode, amountNpr }, routes, largeNpr = LARGE_BAND_DEFAULT_NPR) {
  const r = matchApprovalRoute({ subject: "BUDGET_APPROVAL", mode, amountNpr }, routes || seedRoutes(largeNpr));
  return r.id;
}

// ── Transition engine ───────────────────────────────────────────────────────
function fromMatch(t, status) {
  return t.from.includes(status) || (t.from.includes("*open") && OPEN_WORK_STATUSES.includes(status));
}

export function listWorkActions(status) {
  return WORK_TRANSITIONS.filter((t) => fromMatch(t, status));
}

export function listActions(recordType, status) {
  if (recordType === "work") return listWorkActions(status);
  const lc = LIFECYCLES[recordType];
  if (!lc) return [];
  return lc.transitions.filter((t) => t.from.includes(status));
}

function needText(needs = []) {
  return needs.join(", ");
}

// Validate a work transition against context. Throws coded errors; returns
// { to, transition } when allowed.
export function canWorkTransition({ from, action, ctx = {} }) {
  const t = WORK_TRANSITIONS.find((x) => x.action === action && fromMatch(x, from));
  if (!t) fail("INVALID_TRANSITION", { from, action });
  if ((t.needs || []).includes("comment") && !String(ctx.comment || "").trim()) fail("COMMENT_REQUIRED", { action });
  if ((t.needs || []).includes("reason") && !String(ctx.reason || "").trim()) fail("REASON_REQUIRED", { action });
  if (action === "submit") {
    if (ctx.weights && Math.abs(ctx.weights.reduce((a, b) => a + b, 0) - 100) > 0.001) fail("WEIGHTS_NOT_100", {});
    if (ctx.amountPaisa != null && ctx.availablePaisa != null && ctx.amountPaisa > ctx.availablePaisa) fail("BUDGET_INSUFFICIENT", {});
  }
  if (action === "submit_completion") {
    if (Number(ctx.physical) !== 100) fail("COMPLETION_NEEDS_100", { physical: ctx.physical });
    if (ctx.openTasks > 0) fail("OPEN_TASKS", { openTasks: ctx.openTasks });
    if (!ctx.reportAttached) fail("REPORT_REQUIRED", {});
  }
  if (action === "verify" && ctx.submitter && ctx.actor && ctx.submitter === ctx.actor) fail("NOT_SUBMITTER", {});
  if (action === "close") {
    if (ctx.submittedExpenditures > 0) fail("PENDING_EXPENDITURE", {});
  }
  return { to: t.to, transition: t };
}

export function canTransition(recordType, { from, action, ctx = {} }) {
  if (recordType === "work") return canWorkTransition({ from, action, ctx });
  const lc = LIFECYCLES[recordType];
  if (!lc) fail("UNKNOWN_RECORD", { recordType });
  const t = lc.transitions.find((x) => x.action === action && x.from.includes(from));
  if (!t) fail("INVALID_TRANSITION", { recordType, from, action });
  if ((t.needs || []).includes("comment") && !String(ctx.comment || "").trim()) fail("COMMENT_REQUIRED", { action });
  if ((t.needs || []).includes("reason") && !String(ctx.reason || "").trim()) fail("REASON_REQUIRED", { action });
  // Contract close guard (client-side mirror of the server PATCH guard):
  // refuse close while bills are unpaid or retention is held, so the UI
  // can explain HOW to pay first instead of stranding a CLOSED contract
  // with "Held" + "payment due".
  if (recordType === "contract" && action === "close") {
    if (Array.isArray(ctx.unpaidBills) && ctx.unpaidBills.length) fail("CLOSE_BLOCKED_UNPAID", { unpaid: ctx.unpaidBills });
    if (Array.isArray(ctx.heldRetention) && ctx.heldRetention.length) fail("CLOSE_BLOCKED_RETENTION", { held: ctx.heldRetention });
  }
  return { to: t.to, transition: t };
}

// Apply a transition: returns { status, history, audit, sideEffects }.
// Caller appends history/audit to its record (every transition writes both).
export function applyTransition(recordType, { from, action, actor = "—", ctx = {}, at = new Date().toISOString() }) {
  const { to, transition } = canTransition(recordType, { from, action, ctx });
  const reason = ctx.reason || ctx.comment || "";
  const history = { at, from, to, action, actor, reason };
  const audit = { at, code: `${recordType.toUpperCase()}_${action.toUpperCase()}`, actor, from, to, reason };
  return { status: to, history, audit, sideEffects: transition.sideEffects || [], needs: transition.needs || [], note: transition.note || "" };
}

// Resolve the assignee for a route step (§33): users holding step.roleCode at
// the unit given by unitSelector. Exactly one → assigned; otherwise the
// previous step holder picks from the list.
export function resolveAssignee(step, subject, users = []) {
  const unitId = step.unit === "own section" || step.unit === "own unit" ? subject.unitId
    : step.unit === "Mahashakha" || step.unit === "parent unit" ? subject.parentUnitId
    : step.unit === "ministry" ? subject.ministryId
    : step.unit === "department" ? subject.departmentId
    : subject.unitId;
  const roles = String(step.role || "").split("|");
  const cands = users.filter((u) => roles.includes(u.role) && (u.unitId === unitId || u.scopeUnitIds?.includes(unitId)));
  if (cands.length === 1) return { assignee: cands[0].username, auto: true };
  return { assignee: null, auto: false, candidates: cands.map((u) => u.username), pickedBy: "previous step holder" };
}

// Snapshot the route into the subject at submission — later route edits never
// change a Tippani already in flight.
export function snapshotRoute(route) {
  return JSON.parse(JSON.stringify({ id: route.id, steps: route.steps, otp: !!route.otp, at: new Date().toISOString() }));
}

// ── Dynamic persistence (localStorage; falls back to seeds) ────────────────
const LS_ROUTES = "wmams-routes";
const LS_BAND = "wmams-large-band";

export function loadWorkflowConfig() {
  let routes = null;
  let largeNpr = LARGE_BAND_DEFAULT_NPR;
  try {
    const r = localStorage.getItem(LS_ROUTES);
    if (r) routes = JSON.parse(r);
    const b = localStorage.getItem(LS_BAND);
    if (b && Number(b) > 0) largeNpr = Number(b);
  } catch {}
  return { routes: Array.isArray(routes) ? routes : seedRoutes(largeNpr), largeNpr };
}

export function saveWorkflowConfig({ routes, largeNpr }) {
  try {
    if (routes) localStorage.setItem(LS_ROUTES, JSON.stringify(routes));
    if (largeNpr) localStorage.setItem(LS_BAND, String(largeNpr));
  } catch {}
}

// ── Bilingual labels ────────────────────────────────────────────────────────
export const STATUS_META = {
  DRAFT: { ne: "मस्यौदा", en: "Draft" },
  SUBMITTED: { ne: "पेश", en: "Submitted" },
  APPROVED: { ne: "स्वीकृत", en: "Approved" },
  ONGOING: { ne: "चालु", en: "Ongoing" },
  ON_HOLD: { ne: "होल्ड", en: "On hold" },
  COMPLETION_SUBMITTED: { ne: "सम्पन्न पेश", en: "Completion submitted" },
  VERIFIED: { ne: "प्रमाणित", en: "Verified" },
  CLOSED: { ne: "बन्द", en: "Closed" },
  RETURNED: { ne: "फिर्ता", en: "Returned" },
  REJECTED: { ne: "अस्वीकृत", en: "Rejected" },
  CANCELLED: { ne: "रद्द", en: "Cancelled" },
  NOT_STARTED: { ne: "सुरु नभएको", en: "Not started" },
  IN_PROGRESS: { ne: "प्रगतिमा", en: "In progress" },
  DONE: { ne: "सम्पन्न", en: "Done" },
  CONFIRMED: { ne: "सदर", en: "Confirmed" },
  IN_REVIEW: { ne: "समीक्षामा", en: "In review" },
  WITHDRAWN: { ne: "फिर्ता लिइएको", en: "Withdrawn" },
  REVERSED: { ne: "उल्ट्याइएको", en: "Reversed" },
  REQUESTED: { ne: "अनुरोध", en: "Requested" },
  PENDING: { ne: "बाँकी", en: "Pending" },
  SKIPPED: { ne: "छोडिएको", en: "Skipped" },
  ACTIVE: { ne: "सक्रिय", en: "Active" },
  COMPLETED: { ne: "पूरा", en: "Completed" },
  TERMINATED: { ne: "अन्त्य", en: "Terminated" },
  OPEN: { ne: "खुला", en: "Open" },
  RESOLVED: { ne: "समाधान", en: "Resolved" },
  ISSUED: { ne: "जारी", en: "Issued" },
  ACKNOWLEDGED: { ne: "स्वीकृत-प्राप्त", en: "Acknowledged" },
  RESPONDED: { ne: "जवाफ", en: "Responded" },
};

export const ACTION_META = {
  submit: { ne: "पेश", en: "Submit" },
  approve: { ne: "स्वीकृत", en: "Approve" },
  return: { ne: "फिर्ता", en: "Return" },
  reject: { ne: "अस्वीकृत", en: "Reject" },
  start: { ne: "सुरु (auto)", en: "Start (auto)" },
  hold: { ne: "होल्ड", en: "Hold" },
  resume: { ne: "सुचारु", en: "Resume" },
  submit_completion: { ne: "सम्पन्न पेश", en: "Submit completion" },
  verify: { ne: "प्रमाणित", en: "Verify" },
  close: { ne: "बन्द", en: "Close" },
  reopen: { ne: "पुनः खोल्नुहोस्", en: "Reopen" },
  cancel: { ne: "रद्द", en: "Cancel" },
  begin: { ne: "सुरु", en: "Begin" },
  complete: { ne: "सम्पन्न", en: "Complete" },
  confirm: { ne: "सदर", en: "Confirm" },
  resubmit: { ne: "पुनः पेश", en: "Resubmit" },
  send: { ne: "पठाउनुहोस्", en: "Send" },
  forward: { ne: "फर्वार्ड", en: "Forward" },
  withdraw: { ne: "फिर्ता लिनुहोस्", en: "Withdraw" },
  reverse: { ne: "उल्ट्याउनुहोस्", en: "Reverse" },
  done: { ne: "सकियो", en: "Done" },
  skip: { ne: "छोड्नुहोस्", en: "Skip" },
  terminate: { ne: "अन्त्य", en: "Terminate" },
  resolve: { ne: "समाधान", en: "Resolve" },
  acknowledge: { ne: "प्राप्ति", en: "Acknowledge" },
  respond: { ne: "जवाफ", en: "Respond" },
  ask_more: { ne: "थप माग", en: "Ask more" },
};

export function statusLabel(status, lang) {
  const m = STATUS_META[status];
  if (!m) return status;
  return lang === "ne" ? m.ne : m.en;
}

export function actionLabel(action, lang) {
  const m = ACTION_META[action];
  if (!m) return action;
  return lang === "ne" ? m.ne : m.en;
}

export { needText };
