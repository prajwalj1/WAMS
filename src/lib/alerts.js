// WMAMS alert engine (§15). Scheduled + event rules, all data-driven.
// runAlertChecks(snapshot) evaluates every enabled daily/scheduled rule and
// returns [{code, entity, message, to, channel, repeat}]. Event rules expose
// trigger helpers (assignment, approval action, login) for callers.
import { workingDaysBetween } from "./metrics";
import { isSpendAhead } from "./metrics";
import { kathmanduDayKey } from "./progress";

// Code · when · default condition · to · channel · repeat. Admin toggles
// `enabled` / thresholds; engine reads the live list.
//
// Channels (NTF): every rule sets DEFAULT channels — in-app (bell + list)
// is always on and can never be turned off; email may be turned off per
// user ONLY for non-critical rules; SMS follows the rule default.
// Critical = rule sends SMS, or account-security (lock/login). Critical
// email cannot be turned off.
export const CHANNELS = ["inapp", "email", "sms"];
export const channelListOf = (channelStr) => {
  const s = String(channelStr || "").toLowerCase();
  const out = [];
  if (s.includes("in-app") || s.includes("inapp")) out.push("inapp");
  if (s.includes("email")) out.push("email");
  if (s.includes("sms")) out.push("sms");
  return out.length ? out : ["inapp"];
};
export const isCriticalRule = (r) => {
  if (!r) return false;
  if ((r.critical ?? null) !== null && (r.critical ?? undefined) !== undefined) return !!r.critical;
  const ch = r.channels || channelListOf(r.channel);
  if (ch.includes("sms")) return true;
  return ["ALR-SECURITY-LOGIN"].includes(r.code);
};
export const ALERT_RULES = [
  { code: "ALR-ASSIGNED", when: "Event", condition: "Task assigned / reassigned", to: "Assignee", channel: "In-app, email", repeat: "Once", kind: "event", enabled: true },
  { code: "ALR-TASK-DUE", when: "Daily 07:00", condition: "Task deadline in 3 days, not DONE", to: "Owner", channel: "In-app, email", repeat: "Once", kind: "daily", days: 3, enabled: true },
  { code: "ALR-DEADLINE", when: "Daily 07:00", condition: "Work/task past deadline and not complete", to: "Owner, unit head", channel: "In-app, email, SMS", repeat: "Weekly", kind: "daily", enabled: true },
  { code: "ALR-BEHIND", when: "Nightly engine", condition: "Health turned BEHIND", to: "Owner, unit head", channel: "In-app, email", repeat: "7 days", kind: "nightly", enabled: true },
  { code: "ALR-DELAY-REASON", when: "Daily", condition: "BEHIND/OVERDUE with no delay reason after 3 working days", to: "Parent unit head", channel: "In-app, email", repeat: "7 days", kind: "daily", days: 3, enabled: true },
  { code: "ALR-NO-UPDATE", when: "Daily", condition: "Progress update overdue (frequency); +3 days → supervisor", to: "Owner → supervisor", channel: "In-app, email", repeat: "3 days", kind: "daily", days: 3, enabled: true },
  { code: "ALR-REVIEW-WAIT", when: "Daily", condition: "Update/completion/revision waiting > 3 working days", to: "Reviewer", channel: "In-app", repeat: "3 days", kind: "daily", days: 3, enabled: true },
  { code: "ALR-TIPPANI-WAIT", when: "Daily", condition: "Tippani at the same step > 5 working days", to: "Step holder, then supervisor", channel: "In-app, email, SMS", repeat: "3 days", kind: "daily", days: 5, enabled: true },
  { code: "ALR-PROC-STAGE", when: "Daily", condition: "Procurement stage past planned end", to: "Procurement owner, unit head", channel: "In-app, email", repeat: "7 days", kind: "daily", enabled: true },
  { code: "ALR-MILESTONE", when: "Daily", condition: "Contract milestone past due, not paid", to: "Work owner, finance", channel: "In-app, email", repeat: "7 days", kind: "daily", enabled: true },
  { code: "ALR-SECURITY", when: "Daily", condition: "Performance security expires in 30 / 7 days", to: "Work owner, finance", channel: "In-app, email, SMS", repeat: "At 30 and 7 days", kind: "daily", enabled: true },
  { code: "ALR-SPEND-MISMATCH", when: "Nightly engine", condition: "SPEND_AHEAD flag on a progressive work", to: "Unit head, finance", channel: "In-app, email", repeat: "14 days", kind: "nightly", enabled: true },
  { code: "ALR-LOW-UTIL", when: "Weekly (Sun)", condition: "Line spent < 50% of trimester target; from Jestha 1, spent < 70% of revised", to: "Unit head, ministry finance", channel: "In-app, email", repeat: "Weekly", kind: "weekly", pct: 50, enabled: true },
  { code: "ALR-DIRECTIVE", when: "Event + daily", condition: "Directive issued; due in 2 days; overdue", to: "Recipient; issuer on overdue", channel: "In-app, email", repeat: "Daily when overdue", kind: "daily", days: 2, enabled: true },
  { code: "ALR-APPROVAL-ACTION", when: "Event", condition: "Something the user submitted was approved / returned / rejected", to: "Submitter", channel: "In-app, email", repeat: "Once", kind: "event", enabled: true },
  { code: "ALR-SECURITY-LOGIN", when: "Event", condition: "Account locked; login from new device (privileged role)", to: "User, SUPER_ADMIN on lock", channel: "Email", repeat: "Once", kind: "event", enabled: true },
];

const rule = (rules, code) => (rules || ALERT_RULES).find((r) => r.code === code);
const on = (rules, code) => rule(rules, code)?.enabled !== false;
const days = (rules, code, fallback) => Number(rule(rules, code)?.days ?? fallback);

// Role relevance: which alert codes each role may see — notifications are
// NEVER shared across roles. null = all codes (national/ministry oversight).
// Finance sees money alerts; approvers see decision queues; doers see their
// own tasks; auditors get oversight awareness; viewers/externals get none.
const UNIT_ALERTS = ["ALR-ASSIGNED", "ALR-TASK-DUE", "ALR-DEADLINE", "ALR-BEHIND", "ALR-DELAY-REASON", "ALR-NO-UPDATE", "ALR-REVIEW-WAIT", "ALR-TIPPANI-WAIT", "ALR-PROC-STAGE", "ALR-DIRECTIVE", "ALR-APPROVAL-ACTION"];
export const ALERTS_BY_ROLE = {
  SUPER_ADMIN: null,
  MINISTRY_ADMIN: null,
  APPROVER: ["ALR-TIPPANI-WAIT", "ALR-REVIEW-WAIT", "ALR-APPROVAL-ACTION"],
  UNIT_HEAD: UNIT_ALERTS,
  SECTION_HEAD: UNIT_ALERTS,
  STAFF: ["ALR-ASSIGNED", "ALR-TASK-DUE", "ALR-DEADLINE", "ALR-NO-UPDATE", "ALR-APPROVAL-ACTION"],
  FINANCE_OFFICER: ["ALR-MILESTONE", "ALR-SPEND-MISMATCH", "ALR-LOW-UTIL", "ALR-SECURITY", "ALR-REVIEW-WAIT", "ALR-TIPPANI-WAIT"],
  AUDITOR: ["ALR-BEHIND", "ALR-DEADLINE", "ALR-TIPPANI-WAIT"],
  VIEWER: [],
  EXTERNAL: [],
  SYSTEM: [],
};
// null (oversight roles) or unknown roles fall back to no sharing: unknown → none.
export function alertsFor(role) {
  if (role === "SUPER_ADMIN" || role === "MINISTRY_ADMIN") return null;
  return ALERTS_BY_ROLE[role] ?? [];
}

function alert(code, entity, message, to, channel) {
  return { code, entity, message, to, channel, at: new Date().toISOString().slice(0, 16).replace("T", " ") };
}

// Snapshot: { works (enriched with health), tasks, tippanis, procurements,
// contracts, directives, issues, budgetLines, trimesterTargets, today, holidays,
// updateFrequencyDays }.
export function runAlertChecks(s, rules) {
  const R = rules || ALERT_RULES;
  const out = [];
  const today = s.today || kathmanduDayKey(new Date());
  const freq = Number(s.updateFrequencyDays ?? 7);

  if (on(R, "ALR-TASK-DUE")) {
    const n = days(R, "ALR-TASK-DUE", 3);
    for (const t of s.tasks || []) {
      if (["DONE", "CANCELLED"].includes(t.status)) continue;
      const left = Math.round((new Date(t.deadline) - new Date(today)) / 86400000);
      if (left >= 0 && left <= n) out.push(alert("ALR-TASK-DUE", t.ref, `${t.ref} due in ${left}d (${t.deadline})`, t.owner, "In-app, email"));
    }
  }
  if (on(R, "ALR-DEADLINE")) {
    for (const w of s.works || []) {
      if (today > w.deadline && w.physical < 100 && !["CLOSED", "CANCELLED"].includes(w.status))
        out.push(alert("ALR-DEADLINE", w.id, `${w.id} past deadline ${w.deadline}`, `${w.owner}, unit head`, "In-app, email, SMS"));
    }
    for (const t of s.tasks || []) {
      if (today > t.deadline && !["DONE", "CANCELLED"].includes(t.status))
        out.push(alert("ALR-DEADLINE", t.ref, `${t.ref} past deadline ${t.deadline}`, t.owner, "In-app, email, SMS"));
    }
  }
  if (on(R, "ALR-BEHIND")) {
    for (const w of s.works || []) {
      if (w.health === "BEHIND") out.push(alert("ALR-BEHIND", w.id, `${w.id} Behind (gap ${w.gap}) — owner + unit head notified`, `${w.owner}, unit head`, "In-app, email"));
    }
  }
  if (on(R, "ALR-DELAY-REASON")) {
    const n = days(R, "ALR-DELAY-REASON", 3);
    for (const w of s.works || []) {
      if (!["BEHIND", "OVERDUE"].includes(w.health) || String(w.delayReason || "").trim()) continue;
      const since = w.turnedBehindAt || w.deadline;
      if (workingDaysBetween(since, today, s.holidays) > n)
        out.push(alert("ALR-DELAY-REASON", w.id, `${w.id} no delay reason after ${n} working days`, "Parent unit head", "In-app, email"));
    }
  }
  if (on(R, "ALR-NO-UPDATE")) {
    const grace = days(R, "ALR-NO-UPDATE", 3);
    for (const t of s.tasks || []) {
      if (!["IN_PROGRESS"].includes(t.status) || !t.lastUpdate) continue;
      const waiting = workingDaysBetween(t.lastUpdate, today, s.holidays);
      if (waiting > freq + grace)
        out.push(alert("ALR-NO-UPDATE", t.ref, `${t.ref} no update for ${waiting} working days → supervisor`, `${t.owner} → supervisor`, "In-app, email"));
      else if (waiting > freq)
        out.push(alert("ALR-NO-UPDATE", t.ref, `${t.ref} update overdue (${waiting} working days)`, t.owner, "In-app, email"));
    }
  }
  if (on(R, "ALR-REVIEW-WAIT")) {
    const n = days(R, "ALR-REVIEW-WAIT", 3);
    for (const r of s.reviews || []) {
      if (workingDaysBetween(r.since, today, s.holidays) > n)
        out.push(alert("ALR-REVIEW-WAIT", r.id, `${r.id} waiting ${n}+ working days`, "Reviewer", "In-app"));
    }
  }
  if (on(R, "ALR-TIPPANI-WAIT")) {
    const n = days(R, "ALR-TIPPANI-WAIT", 5);
    for (const x of s.tippanis || []) {
      if (x.status !== "IN_REVIEW") continue;
      const wait = x.stepSince ? workingDaysBetween(x.stepSince, today, s.holidays) : Number(x.waitDays) || 0;
      if (wait > n) out.push(alert("ALR-TIPPANI-WAIT", x.ref, `${x.ref} at same step ${wait} working days (${x.step})`, "Step holder, then supervisor", "In-app, email, SMS"));
    }
  }
  if (on(R, "ALR-PROC-STAGE")) {
    for (const p of s.procurements || []) {
      if (p.stagePlannedEnd && today > p.stagePlannedEnd)
        out.push(alert("ALR-PROC-STAGE", p.pkg, `${p.pkg} stage ${p.stage} past planned end ${p.stagePlannedEnd}`, "Procurement owner, unit head", "In-app, email"));
    }
  }
  if (on(R, "ALR-MILESTONE")) {
    for (const c of s.contracts || []) {
      for (const m of c.milestones || []) {
        if (!m.paid && m.due && today > m.due)
          out.push(alert("ALR-MILESTONE", c.id, `${c.id} milestone ${m.name} past due, not paid`, "Work owner, finance", "In-app, email"));
      }
    }
  }
  if (on(R, "ALR-SECURITY")) {
    for (const c of s.contracts || []) {
      for (const sec of c.securities || []) {
        const left = Math.round((new Date(sec.valid) - new Date(today)) / 86400000);
        if (left <= 30 && left >= 0)
          out.push(alert("ALR-SECURITY", c.id, `${c.id} ${sec.type} expires in ${left}d (${sec.valid})`, "Work owner, finance", "In-app, email, SMS"));
      }
    }
  }
  if (on(R, "ALR-SPEND-MISMATCH")) {
    for (const w of s.works || []) {
      if (isSpendAhead(w)) out.push(alert("ALR-SPEND-MISMATCH", w.id, `${w.id} SPEND_AHEAD: financial ${Math.round(w.financial)}% vs physical ${Math.round(w.physical)}%`, "Unit head, finance", "In-app, email"));
    }
  }
  if (on(R, "ALR-LOW-UTIL")) {
    const pct = Number(rule(R, "ALR-LOW-UTIL")?.pct ?? 50);
    for (const b of s.budgetLines || []) {
      if ((b.spent / Math.max(1, b.revised)) * 100 < pct)
        out.push(alert("ALR-LOW-UTIL", b.subhead, `${b.subhead} spent below ${pct}% of revised`, "Unit head, ministry finance", "In-app, email"));
    }
    for (const x of s.trimesterTargets || []) {
      if (x.actual != null && x.actual < x.target)
        out.push(alert("ALR-LOW-UTIL", x.tri, `${x.tri} actual ${x.actual}% below target ${x.target}%`, "Unit head, ministry finance", "In-app, email"));
    }
  }
  if (on(R, "ALR-DIRECTIVE")) {
    const n = days(R, "ALR-DIRECTIVE", 2);
    for (const d of s.directives || []) {
      if (d.status === "CLOSED") continue;
      const left = Math.round((new Date(d.due) - new Date(today)) / 86400000);
      if (left < 0) out.push(alert("ALR-DIRECTIVE", d.id, `${d.id} overdue since ${d.due}`, "Recipient; issuer", "In-app, email"));
      else if (left <= n) out.push(alert("ALR-DIRECTIVE", d.id, `${d.id} due in ${left}d`, "Recipient", "In-app, email"));
    }
  }
  return out;
}

// ── Event triggers (kind: event) — callers fire these on user actions ───────
export const fireAssigned = (ref, assignee) => alert("ALR-ASSIGNED", ref, `${ref} assigned`, assignee, "In-app, email");
export const fireApprovalAction = (ref, decision, submitter) => alert("ALR-APPROVAL-ACTION", ref, `${ref} ${decision}`, submitter, "In-app, email");
export const fireSecurityLogin = (username, reason) => alert("ALR-SECURITY-LOGIN", username, `${username}: ${reason}`, "User, SUPER_ADMIN", "Email");

// ── Admin persistence (per-rule enabled + thresholds) ───────────────────────
const LS = "wmams-alert-rules";
export function loadAlertRules() {
  try {
    const raw = localStorage.getItem(LS);
    if (raw) {
      const saved = JSON.parse(raw);
      return ALERT_RULES.map((r) => ({ ...r, ...(saved[r.code] || {}) }));
    }
  } catch {}
  return ALERT_RULES.map((r) => ({ ...r }));
}
export function saveAlertRules(rules) {
  try {
    const o = {};
    for (const r of rules) o[r.code] = { enabled: r.enabled, days: r.days, pct: r.pct };
    localStorage.setItem(LS, JSON.stringify(o));
  } catch {}
}

// ── NTF-02: ministry narrowing (MINISTRY_ADMIN) ──────────────────────────
// Ministers may only NARROW the SUPER_ADMIN baseline: turn a rule OFF,
// raise the day-threshold (fewer fires), or lower the LOW-UTIL pct.
// They can never turn a globally-OFF rule ON or make thresholds more
// sensitive. Overrides persist per ministry unit id.
export function ministryOverrideKey(unitId) {
  return `wmams-alert-rules-${String(unitId || "ministry")}`;
}
export function loadMinistryOverride(unitId) {
  try {
    const raw = localStorage.getItem(ministryOverrideKey(unitId));
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}
export function saveMinistryOverride(unitId, override) {
  try { localStorage.setItem(ministryOverrideKey(unitId), JSON.stringify(override || {})); } catch {}
}
// Narrowing check: returns { ok } or { ok:false, reason }.
export function narrowingCheck(base, next) {
  if (base?.enabled !== false && next?.enabled === false) return { ok: true };
  if (base?.enabled === false && next?.enabled !== false) return { ok: false, reason: "Cannot enable a rule the PMO turned off" };
  const bd = Number(base?.days), nd = Number(next?.days);
  if (Number.isFinite(bd) && Number.isFinite(nd) && nd < bd) return { ok: false, reason: "Days can only be raised (fewer alerts), not lowered" };
  const bp = Number(base?.pct), np = Number(next?.pct);
  if (Number.isFinite(bp) && Number.isFinite(np) && np > bp) return { ok: false, reason: "Utilisation % can only be lowered (fewer alerts), not raised" };
  return { ok: true };
}
// Effective rules for a viewer: global baseline + (ministry override if the
// viewer belongs to that ministry). PMO (SUPER_ADMIN) always sees baseline.
export function effectiveRules(baseRules, unitId) {
  const base = baseRules || ALERT_RULES;
  if (!unitId) return base;
  const ov = loadMinistryOverride(unitId);
  if (!ov || !Object.keys(ov).length) return base;
  return base.map((r) => ({ ...r, ...(ov[r.code] || {}) }));
}

// ── NTF-05: bilingual message templates ──────────────────────────────────
// Variables: {workTitle} {daysOverdue} {link} {code} {entity} {to}.
// Admins edit these at /admin/alerts (templates section); engine + UI
// render via renderAlertMessage(). Missing rule → generic fallback.
export const ALERT_TEMPLATES = {
  "ALR-DEADLINE": {
    en: "Overdue: {workTitle} is {daysOverdue} days past deadline. {link}",
    ne: "म्याद नाघेको: {workTitle} {daysOverdue} दिनले म्याद नाघेको छ। {link}",
  },
  "ALR-BEHIND": {
    en: "Behind schedule: {workTitle} (gap {daysOverdue}). {link}",
    ne: "तालिकाभन्दा पछाडि: {workTitle} (अन्तर {daysOverdue})। {link}",
  },
  "ALR-TASK-DUE": {
    en: "Due soon: {workTitle} is due in {daysOverdue} days. {link}",
    ne: "म्याद नजिकिँदै: {workTitle} {daysOverdue} दिनमा सकिनुपर्छ। {link}",
  },
  "ALR-TIPPANI-WAIT": {
    en: "Tippani waiting: {workTitle} at the same step for {daysOverdue} working days. {link}",
    ne: "टिप्पणी रोकिएको: {workTitle} एउटै चरणमा {daysOverdue} कार्यदिनदेखि। {link}",
  },
  "ALR-DIRECTIVE": {
    en: "Directive: {workTitle} — {daysOverdue}. {link}",
    ne: "निर्देशन: {workTitle} — {daysOverdue}। {link}",
  },
  "ALR-APPROVAL-ACTION": {
    en: "Decision on your submission: {workTitle}. {link}",
    ne: "तपाईंको पेशकृतिमा निर्णय: {workTitle}। {link}",
  },
  "ALR-ASSIGNED": {
    en: "Assigned to you: {workTitle}. {link}",
    ne: "तपाईंलाई तोकियो: {workTitle}। {link}",
  },
  "ALR-MILESTONE": {
    en: "Milestone overdue: {workTitle}. {link}",
    ne: "माइलस्टोन म्याद नाघेको: {workTitle}। {link}",
  },
  "ALR-SECURITY": {
    en: "Security expiring: {workTitle} expires in {daysOverdue} days. {link}",
    ne: "धरौटी म्याद सकिँदै: {workTitle} {daysOverdue} दिनमा सकिँदैछ। {link}",
  },
  "ALR-LOW-UTIL": {
    en: "Low utilisation: {workTitle} below target. {link}",
    ne: "कम खर्च: {workTitle} लक्ष्यभन्दा कम। {link}",
  },
  "ALR-REVIEW-WAIT": {
    en: "Review waiting: {workTitle} for {daysOverdue} working days. {link}",
    ne: "समीक्षा प्रतीक्षा: {workTitle} {daysOverdue} कार्यदिनदेखि। {link}",
  },
  "ALR-NO-UPDATE": {
    en: "No progress update: {workTitle} for {daysOverdue} working days. {link}",
    ne: "प्रगति अपडेट छैन: {workTitle} {daysOverdue} कार्यदिनदेखि। {link}",
  },
};
const TPL_LS = "wmams-alert-templates";
export function loadAlertTemplates() {
  try {
    const raw = localStorage.getItem(TPL_LS);
    if (raw) {
      const saved = JSON.parse(raw);
      const out = {};
      for (const [code, t] of Object.entries(ALERT_TEMPLATES)) out[code] = { ...t, ...(saved[code] || {}) };
      return out;
    }
  } catch {}
  return Object.fromEntries(Object.entries(ALERT_TEMPLATES).map(([k, v]) => [k, { ...v }]));
}
export function saveAlertTemplates(tpls) {
  try { localStorage.setItem(TPL_LS, JSON.stringify(tpls)); } catch {}
}
export function renderAlertMessage(code, vars = {}, lang = "en", templates) {
  const tpls = templates || ALERT_TEMPLATES;
  const tpl = tpls[code] || null;
  const raw = tpl ? (tpl[lang] || tpl.en) : "{workTitle} — {code}";
  return String(raw).replace(/\{(\w+)\}/g, (_, k) => {
    if (k === "code") return code;
    const v = vars[k];
    return v === undefined || v === null ? "" : String(v);
  }).replace(/\s+/g, " ").trim();
}

// ── NTF: per-user channel preferences ────────────────────────────────────
// Stored per username (localStorage prototype; Mongo-bound in prod).
// emailOff: [codes] the user muted. Only non-critical rules may be muted;
// in-app is always on and has no toggle; sms follows the rule default.
export function notifPrefsKey(username) {
  return `wmams-notif-prefs-${String(username || "anon")}`;
}
export function loadNotifPrefs(username) {
  try {
    const raw = localStorage.getItem(notifPrefsKey(username));
    if (raw) {
      const p = JSON.parse(raw);
      return { emailOff: Array.isArray(p.emailOff) ? p.emailOff : [] };
    }
  } catch {}
  return { emailOff: [] };
}
export function saveNotifPrefs(username, prefs) {
  try { localStorage.setItem(notifPrefsKey(username), JSON.stringify({ emailOff: prefs.emailOff || [] })); } catch {}
}
// Effective delivery channels for one rule + one user.
export function effectiveChannels(ruleLike, prefs) {
  const base = ruleLike?.channels || channelListOf(ruleLike?.channel);
  const chans = new Set(base);
  chans.add("inapp"); // in-app can never be turned off
  const off = new Set(prefs?.emailOff || []);
  if (off.has(ruleLike?.code) && !isCriticalRule(ruleLike)) chans.delete("email");
  return [...chans];
}
export function canMuteEmail(ruleLike) {
  return !isCriticalRule(ruleLike);
}

// ── NTF-03: duplicate control ────────────────────────────────────────────
// Same rule + same record + same person → at most once per repeat period.
// Repeat strings ("Once", "3 days", "7 days", "Weekly", "14 days",
// "Daily when overdue", "At 30 and 7 days") map to a suppression window.
export function repeatWindowMs(repeat) {
  const s = String(repeat || "").toLowerCase();
  if (/once/.test(s)) return 365 * 86400000; // once ever (prototype: 1 year)
  const m = s.match(/(\d+)\s*day/);
  if (m) return Number(m[1]) * 86400000;
  if (/week/.test(s)) return 7 * 86400000;
  return 3 * 86400000; // default 3 days
}
const SENT_LS = "wmams-alert-sent";
function loadSentLog() {
  try {
    const raw = localStorage.getItem(SENT_LS);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}
function saveSentLog(log) {
  try {
    const keys = Object.keys(log).sort().slice(-500); // cap growth
    const trimmed = Object.fromEntries(keys.map((k) => [k, log[k]]));
    localStorage.setItem(SENT_LS, JSON.stringify(trimmed));
  } catch {}
}
export const dedupeKey = (code, entity, username) => `${code}‖${entity}‖${username || "*"}`;
// Filter a fired alert list: drop items already notified within their
// rule's repeat window. Pass rules to resolve per-code windows.
export function dedupeAlerts(alerts, username, rules) {
  const R = rules || ALERT_RULES;
  const log = loadSentLog();
  const t = Date.now();
  return (alerts || []).filter((a) => {
    const r = R.find((x) => x.code === a.code);
    const win = repeatWindowMs(r?.repeat);
    const last = log[dedupeKey(a.code, a.entity, username || a.to)] || 0;
    return t - last >= win;
  });
}
export function recordAlertsSent(alerts, username) {
  if (!alerts?.length) return;
  const log = loadSentLog();
  const t = Date.now();
  for (const a of alerts) log[dedupeKey(a.code, a.entity, username || a.to)] = t;
  saveSentLog(log);
}

// ── NTF-04: digests ──────────────────────────────────────────────────────
// Daily 08:00 NPT → unit heads: overdue + behind + pending approvals.
// Weekly Sunday 08:00 NPT → leadership (PMO / ministry / auditors):
// portfolio health + low utilisation + open directives.
export function buildDailyDigest({ works = [], pending = null, tippanis = [], today = "" } = {}) {
  const enriched = works;
  const overdue = enriched.filter((w) => w.health === "OVERDUE");
  const behind = enriched.filter((w) => w.health === "BEHIND");
  const stuckTip = (tippanis || []).filter((x) => x.status === "IN_REVIEW" && (Number(x.waitDays) || 0) > 5);
  return {
    id: `digest-daily-${today}`,
    kind: "daily",
    schedule: "Daily 08:00 NPT",
    to: "Unit heads",
    counts: {
      overdue: overdue.length,
      behind: behind.length,
      pendingApprovals: pending?.total ?? 0,
      stuckTippani: stuckTip.length,
    },
    top: [
      ...overdue.slice(0, 5).map((w) => ({ code: "ALR-DEADLINE", entity: w.id, text: `${w.id} overdue · gap ${w.gap}` })),
      ...behind.slice(0, 5).map((w) => ({ code: "ALR-BEHIND", entity: w.id, text: `${w.id} behind · gap ${w.gap}` })),
    ],
  };
}
export function buildWeeklyDigest({ works = [], budgetLines = [], directives = [], trimesterTargets = [] } = {}) {
  const enriched = works;
  const health = { ON_TRACK: 0, AT_RISK: 0, BEHIND: 0, OVERDUE: 0, NOT_STARTED: 0 };
  for (const w of enriched) if (health[w.health] !== undefined) health[w.health] += 1;
  const lowUtil = (budgetLines || []).filter((b) => ((Number(b.spent) || 0) / Math.max(1, Number(b.revised) || 0)) * 100 < 50).length;
  const openDir = (directives || []).filter((d) => d.status !== "CLOSED").length;
  const belowTarget = (trimesterTargets || []).filter((x) => x.actual != null && x.actual < x.target).length;
  return {
    id: `digest-weekly-${new Date().toISOString().slice(0, 10)}`,
    kind: "weekly",
    schedule: "Sunday 08:00 NPT",
    to: "Leadership (PMO · ministry · auditors)",
    counts: {
      works: enriched.length,
      overdueBehind: (health.OVERDUE || 0) + (health.BEHIND || 0),
      lowUtil,
      openDirectives: openDir,
      trimesterBelowTarget: belowTarget,
    },
    health,
  };
}
