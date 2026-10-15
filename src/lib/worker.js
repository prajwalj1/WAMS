// Background worker contract (§24). Jobs run on their own schedule in
// production (BullMQ); here each job is a pure function over the same shared
// formulas the UI uses, executable inline via POST /api/worker { job }.
import { enrichWorks, delayedWorks, avgPhysical, utilisation, pendingApprovals } from "./metrics";
import { runAlertChecks, buildDailyDigest, buildWeeklyDigest } from "./alerts";
import { kathmanduDayKey } from "./progress";
import { validateImportRows } from "./import-specs";

export const JOBS = [
  { id: "nightly-rollup", schedule: "Nightly", summary: "Recalculate progress roll-ups (avg physical, utilisation)" },
  { id: "alert-digest", schedule: "Daily 07:00 + nightly", summary: "Evaluate ALR-* rules, queue email/SMS" },
  { id: "digest-daily", schedule: "Daily 08:00 NPT", summary: "Unit-head digest: overdue + behind + pending approvals (NTF-04)" },
  { id: "digest-weekly", schedule: "Sunday 08:00 NPT", summary: "Leadership digest: portfolio health + low utilisation + open directives (NTF-04)" },
  { id: "import-commit", schedule: "On demand", summary: "Validate + commit Excel rows (rollback window enforced)" },
  { id: "trimester-pdf", schedule: "On demand / scheduled", summary: "Build trimester PDF + Excel (queued, slow work off-request)" },
  { id: "tippani-pdf", schedule: "After decision", summary: "Official Tippani PDF by the worker (routeSnapshot frozen at submit)" },
  { id: "virus-scan", schedule: "On upload", summary: "ClamAV scan before leaving quarantine" },
  { id: "notify-flush", schedule: "Every 5 min", summary: "Send queued email (SMTP) + SMS (gateway)" },
];

export function runJob(id, snapshot = {}) {
  const today = snapshot.today || kathmanduDayKey(new Date());
  switch (id) {
    case "nightly-rollup": {
      const enriched = enrichWorks(snapshot.works || [], new Date(today));
      const spent = (snapshot.budgetLines || []).reduce((a, b) => a + b.spent, 0);
      const revised = (snapshot.budgetLines || []).reduce((a, b) => a + b.revised, 0);
      return { ok: true, job: id, result: {
        works: enriched.length,
        delayed: delayedWorks(enriched).length,
        avgPhysical: Math.round(avgPhysical(enriched) * 100) / 100,
        utilisation: Math.round(utilisation(spent, revised) * 100) / 100,
      } };
    }
    case "alert-digest": {
      const alerts = runAlertChecks({ ...snapshot, today });
      const queued = { email: alerts.filter((a) => /email/i.test(a.channel)).length, sms: alerts.filter((a) => /sms/i.test(a.channel)).length, inapp: alerts.length };
      return { ok: true, job: id, result: { fired: alerts.length, queued, codes: [...new Set(alerts.map((a) => a.code))] } };
    }
    case "digest-daily": {
      const enriched = enrichWorks(snapshot.works || [], new Date(today));
      const digest = buildDailyDigest({
        works: enriched,
        tippanis: snapshot.tippanis || [],
        pending: pendingApprovals({ tippanis: snapshot.tippanis || [], works: snapshot.works || [], revisions: snapshot.revisions || [] }),
        today,
      });
      return { ok: true, job: id, result: { ...digest, queued: { inapp: 1, email: 1 } } };
    }
    case "digest-weekly": {
      const enriched = enrichWorks(snapshot.works || [], new Date(today));
      const digest = buildWeeklyDigest({
        works: enriched,
        budgetLines: snapshot.budgetLines || [],
        directives: snapshot.directives || [],
        trimesterTargets: (snapshot.trimesterTargets || []).filter((x) => x.kind === "target"),
      });
      return { ok: true, job: id, result: { ...digest, queued: { inapp: 1, email: 1 } } };
    }
    case "import-commit": {
      const checked = validateImportRows(snapshot.template, snapshot.rows || [], snapshot.ctx || {});
      const bad = checked.filter((r) => !r.valid);
      return { ok: bad.length === 0, job: id, result: { rows: checked.length, valid: checked.length - bad.length, bad: bad.length, firstError: bad[0] || null } };
    }
    case "trimester-pdf":
      return { ok: true, job: id, result: { queued: true, note: "Puppeteer (Noto/Mukta) in production; inline preview served from /reports" } };
    case "tippani-pdf":
      return { ok: true, job: id, result: { queued: true, ref: snapshot.ref || null, note: "Rendered from routeSnapshot; later route edits do not affect it" } };
    case "virus-scan":
      return { ok: true, job: id, result: { verdict: /eicar/i.test(snapshot.name || "") ? "INFECTED" : "CLEAN", bucket: "quarantine → main" } };
    case "notify-flush":
      return { ok: true, job: id, result: { sent: { email: snapshot.pendingEmail || 0, sms: snapshot.pendingSms || 0 }, via: "SMTP relay · SMS gateway (src/lib/integration.js sendSms)" } };
    default:
      return { ok: false, job: id, error: "UNKNOWN_JOB" };
  }
}
