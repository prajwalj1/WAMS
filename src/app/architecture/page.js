"use client";
import { useState } from "react";
import Link from "next/link";
import { useApp } from "@/lib/store";
import { tx } from "@/lib/i18n";
import { Card, Table } from "@/components/ui";
import { ENDPOINTS } from "@/lib/api-manifest";
import { JOBS } from "@/lib/worker";
import { worker as workerApi } from "@/lib/api/client";

const PEOPLE = [
  ["PMO & leadership", "National dashboard · all ministries"],
  ["Ministry officials", "Ministry dashboard · approvals · budgets"],
  ["Dept / Mahashakha", "Unit dashboard · works · teams"],
  ["Staff & finance", "Updates · expenditures · verification"],
];

const FLOW = ["CLIENTS — browser · mobile PWA (HTTPS)", "EDGE — WAF + LB: TLS, rate limits, OWASP rules", "APP — Next.js web · NestJS API (only writer) · worker (slow jobs)", "DATA — MongoDB replica set · Redis · MinIO · ClamAV", "OPS — Prometheus/Grafana/Loki · backups → DR"];

const COMPONENTS = [
  ["Web browser / mobile PWA", "Office desktops · field updates + photos", "HTTPS"],
  ["WAF + load balancer (Nginx, ModSecurity)", "TLS termination · rate limits · OWASP rules", "Edge"],
  ["Web app (Next.js)", "Nepali/English UI · this prototype", "App"],
  ["API — modular monolith (NestJS · REST · OpenAPI)", "Only component that writes business data · login itself · scope filter", "App"],
  ["Background worker", "Rollups · alerts · PDF · imports · scans · senders", "App"],
  ["MongoDB 7 replica set (primary + 2 secondaries)", "Every work, task, budget line, approval", "Data"],
  ["Redis", "Cache · jobs · rate limits", "Data"],
  ["MinIO (S3) + ClamAV", "TOR, agreements, bills, photos · virus scan on upload", "Data"],
  ["Monitoring & logs (Prometheus · Grafana · Loki)", "Uptime alerts · ops dashboards", "Ops"],
  ["Backups → DR (Percona Backup, point-in-time, encrypted)", "RPO ≤ 15 min · RTO ≤ 4 h", "Ops"],
];

const EXTERNAL = [
  ["Email (SMTP)", "Alerts · OTP · reset links"],
  ["SMS gateway", "OTP · critical alerts"],
  ["LMBIS", "Interface only"],
  ["CGAS / FMIS", "Interface only"],
  ["e-GP (PPMO)", "Interface only"],
];

// §27: a module owns its collections and exposes a service; others call the
// service. Last column maps to this prototype (NestJS target in §26 layout).
const MODULES = [
  ["auth", "sessions, otpChallenges, passwordTokens", "ACC-09 · §28", "src/lib/auth-mock.js + /api/auth/*"],
  ["access", "roles, roleAssignments", "ACC", "Mongo roles collection"],
  ["organisation", "orgUnits, users", "ORG · ACC", "Mongo units/users collections · /org · /users"],
  ["planning", "fiscalYears, works, tasks, torVersions, workTemplates", "WRK", "Mongo works/tasks · /works · /works/new"],
  ["activity", "activities, comments, progressUpdates", "ACT · PRG", "tasks/[id] · TransitionBox"],
  ["tippani", "tippanis", "TIP", "src/lib/lifecycle.js · /tippani"],
  ["budget", "budgetLines, commitments, budgetRevisions, expenditures", "BUD", "/budget · /expenditures · revisions"],
  ["procurement", "procurements, contracts", "PRC", "/procurements · /contracts/[id]"],
  ["workflow", "approvalRoutes, approvals, revisions, statusHistory", "APR · §12", "src/lib/lifecycle.js · /admin"],
  ["measurement", "progressSnapshots", "MSR · §32", "src/lib/progress.js · /progress"],
  ["issues", "issues, directives", "ISS", "/issues · /directives"],
  ["documents", "documents", "DOC", "/documents (scan gate)"],
  ["notifications", "alertRules, messageTemplates, deliveryLog", "NTF · §15", "src/lib/alerts.js (engine only — no UI)"],
  ["reporting", "reportJobs, reportSchedules", "DSH · RPT", "/reports/[code] · dashboards"],
  ["imports", "importBatches", "§17", "src/lib/import-specs.js · /imports"],
  ["audit", "auditLogs", "AUD", "/audit (insert-only view)"],
  ["admin", "lookups, settings, bsCalendar, holidays, counters", "ADM", "/admin/* · /admin/go-live"],
  ["integration", "externalRefs", "§35", "Adapter stubs (SMTP/SMS/e-GP interface-only)"],
];

// §25 layer choices + what this repo pins today (prod target in Why).
const LAYERS = [
  ["Language", "TypeScript everywhere, Node.js 20 LTS", "JS prototype on Node 20/22 · TS at NestJS build", "One language, shared formulas"],
  ["Web app", "Next.js 14 (App Router), React 18 …", "Next.js 16.3.7 · React 19.2.8 (pinned)", "Phone-friendly, Nepali i18n, PWA shell"],
  ["API", "NestJS 10, Mongoose 8, class-validator, Passport-JWT, Swagger, Pino", "Contract live at /api/openapi", "Guards match scope/audit design"],
  ["Database", "MongoDB 7, 3-member replica set", "Dev compose rs0 · prod 2 GIDC + 1 DR", "Transactions + aggregation roll-ups"],
  ["Jobs & cache", "Redis 7 + BullMQ", "Contract live at /api/worker", "Retries · perm cache · rate limits"],
  ["Files", "MinIO (S3) + ClamAV, sharp, file-type", "Quarantine → scan → main (UI enforced)", "Versioning + replication"],
  ["Auth", "argon2, jose/@nestjs/jwt, otplib", "OTP flow in UI · JWT at API", "Built into the API, no IdP"],
  ["Reports", "Puppeteer, ExcelJS, Noto/Mukta", "CSV export live · PDF via print", "Correct Nepali shaping"],
  ["Calendar", "bsCalendar collection + shared converter", "BS lookup validated (2070–2100)", "Month lengths vary by year"],
  ["Testing", "Jest, Supertest, memory-server, Playwright", "/acceptance runs §9 live", "Unit + API + e2e in CI"],
  ["Build & run", "pnpm + Turborepo, Docker, RKE2/Helm, GitLab CI", "npm · Docker Compose dev · pinned deps", "Repeatable, zero-downtime"],
  ["Ops", "Prometheus, Grafana, Loki, Percona Backup", "/api/health · backups → DR", "Self-hosted monitoring"],
];

function WorkerRunner({ lang }) {
  const [job, setJob] = useState("nightly-rollup");
  const [out, setOut] = useState(null);
  const run = async () => {
    setOut(await workerApi.run(job));
  };
  return (
    <div className="space-y-2">
      <div className="no-print flex flex-wrap gap-2 text-xs font-bold">
        <select value={job} onChange={(e) => setJob(e.target.value)} className="rounded-lg border px-2 py-1.5">{JOBS.map((j) => <option key={j.id} value={j.id}>{j.id} ({j.schedule})</option>)}</select>
        <button onClick={run} className="rounded-lg bg-nepal-blue px-3 py-1.5 text-white">▶ {tx("चलाउनुहोस्", "Run", lang)}</button>
      </div>
      {out && <pre className="overflow-x-auto rounded-lg bg-slate-900 p-2 font-mono text-[11px] text-emerald-200">{JSON.stringify(out, null, 1)}</pre>}
    </div>
  );
}

export default function Architecture() {
  const { lang } = useApp();
  const live = ENDPOINTS.filter((e) => e.status === "live").length;
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-black">{tx("प्रणाली संरचना", "System architecture", lang)}</h1>
      <p className="text-[13px] text-slate-600">
        {tx("ब्राउजर/फोनमा खुल्ने वेबसाइट · नियम राख्ने एउटा एप्लिकेसन · MongoDB मा सबै रेकर्ड · फाइल भण्डार · आफ्नै तालिकामा चल्ने सहायक। सबै GIDC, नेपालमा। हरेक कार्य भूमिका+एकाइमा जाँच हुन्छ र अपरिवर्तनीय लगमा लेखिन्छ।",
          "A site officials open in a browser or phone · one app holding all rules · MongoDB for every record · a file store · a scheduled helper. All on government servers in Nepal. Every action is role+unit checked and written to an immutable log.", lang)}
      </p>
      <div className="no-print flex flex-wrap items-center gap-1 text-[11px] font-bold" aria-label="traffic">
        {FLOW.map((f, i) => <span key={f} className="flex items-center gap-1"><span className="rounded-lg bg-nepal-blue px-2 py-1 text-white">{f}</span>{i < FLOW.length - 1 && <span>→</span>}</span>)}
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <Card title="PEOPLE">
          <Table cols={["Who", "Sees"]} rows={PEOPLE} />
        </Card>
        <Card title={tx("बाह्य प्रणाली (इन्टरफेस मात्र)", "Other systems (interface only)", lang)}>
          <Table cols={["System", "Use"]} rows={EXTERNAL} />
        </Card>
      </div>
      <Card title={tx("कम्पोनेन्ट (§24)", "Components (§24)", lang)}>
        <Table cols={["Component", "Role", "Plane"]} rows={COMPONENTS} />
      </Card>
      <Card title={tx("एप्लिकेसन मोड्युल (§27) — संग्रह, सेवा, स्रोत", "Application modules (§27) — collections, service, source", lang)}>
        <Table cols={["Module", "Collections", "Spec", "In this repo"]} rows={MODULES} />
        <p className="mt-2 text-[12px] text-slate-500">{tx("नियम: मोड्युलले आफ्ना संग्रह राख्छ; अरूले सेवा बोलाउँछन्। क्रस-मोड्युल असर एउटै सेवा विधि + एउटै DB ट्रान्जाक्सनमा।", "Rule: a module owns its collections; others call its service. Cross-module effects happen in one service method + one DB transaction.", lang)}</p>
      </Card>
      <Card title={tx("स्कोपिङ (§29) — तीन तह", "Scoping (§29) — three layers", lang)}>
        <div className="no-print mb-2 flex flex-wrap items-center gap-1 text-[11px] font-bold" aria-label="scope layers">
          {[tx("१. अनुमति गार्ड", "1. Permission guard", lang), tx("२. स्कोप फिल्टर", "2. Scope filter", lang), tx("३. रेकर्ड नियम", "3. Record rules", lang)].map((s, i, a) => <span key={s} className="flex items-center gap-1"><span className="rounded-lg bg-emerald-700 px-2 py-1 text-white">{s}</span>{i < a.length - 1 && <span>→</span>}</span>)}
        </div>
        <p className="text-[13px] text-slate-600">{tx("हरेक रेकर्डमा orgAncestors (Mongo मा stamped) — 'मेरो एकाइ + मातहत' एउटै indexed match। स्कोप बाहिर = 404। एकाइ सार्दा worker ले descendant रेकर्ड 1,000 को batch मा पुनः लेख्छ (idempotent)।", "Every record carries orgAncestors (stamped in Mongo) — 'my unit + below' is one indexed match. Out of scope = 404. Moving a unit rewrites descendants in batches of 1,000 (idempotent).", lang)}</p>
        <p className="mt-1 text-[13px]"><Link href="/works" className="font-bold text-nepal-blue">/works</Link> {tx("मा स्कोप टगल + /acceptance मा SCP-01…05 भेक्टर।", "has the scope toggle + SCP-01…05 vectors in /acceptance.", lang)}</p>
      </Card>
      <Card title={tx("अनुरोध जीवन (§30) — प्रगति अपडेट", "Life of a request (§30) — progress update", lang)}>
        <div className="no-print mb-2 flex flex-wrap items-center gap-1 text-[11px] font-bold" aria-label="request life">
          {["POST /tasks/:id/progress", "1 verify token", "2 permission?", "3 find (scope→404)", "4 record rules?", "5 handle", "6 txn + audit", "7 recompute"].map((s, i, a) => <span key={s} className="flex items-center gap-1"><span className="rounded-lg bg-sky-700 px-2 py-1 text-white">{s}</span>{i < a.length - 1 && <span>→</span>}</span>)}
        </div>
        <p className="text-[13px]"><Link href="/tasks/T3" className="font-bold text-nepal-blue">/tasks/T3</Link> {tx("मा POST /progress → 201 लाइभ — गार्ड, ट्रान्जाक्सन-अडिट, work पुनःगणना।", "posts live to /progress → 201 — guards, txn-audit, work recompute.", lang)}</p>
      </Card>
      <Card title={tx("डेटा मोडेल परिपाटी (§31)", "Data model conventions (§31)", lang)}>
        <Table cols={[tx("परिपाटी", "Convention", lang), tx("नियम", "Rule", lang), tx("स्रोत", "Source", lang)]}
          rows={[
            [tx("साझा फिल्ड", "Common fields", lang), "orgUnitId · orgAncestors · orgPath · fiscalYearId · createdBy/At · updatedBy/At · archivedAt · __v (concurrency)", "src/lib/models.js · business-rules br16"],
            [tx("पैसा", "Money", lang), "Integer paisa (NPR×100), conversion only in money utils, never floats", "src/lib/money.js"],
            [tx("मिति", "Dates", lang), "Calendar dates 00:00 Asia/Kathmandu · timestamps UTC · BS derived from lookup", "src/lib/progress.js · business-rules"],
            [tx("द्विभाषी", "Bilingual", lang), "{ ne, en } objects for names/titles", "src/messages/*.json"],
            ["Enums", "UPPERCASE strings, defined once", "src/lib/enums.js"],
            [tx("लेनदेन", "Transactions", lang), "Multi-document change + audit in one txn (majority)", "/api/tasks/[id]/progress"],
            [tx("एम्बेड vs संग्रह", "Embed vs collect", lang), "Embed: steps, stages/bids, milestones, versions · Own collection: activities, updates, expenditures, audit", "MODULES ↑"],
          ]} />
      </Card>
      <Card title={tx("तह छनोट (§25) — पिन गरिएको संस्करण", "Layer choices (§25) — pinned versions", lang)}>
        <Table cols={["Layer", "Choice", "In this repo", "Why"]} rows={LAYERS} />
      </Card>
      <div className="grid gap-3 xl:grid-cols-2">
        <Card title={`API · REST · OpenAPI (${live}/${ENDPOINTS.length} live)`} action={<Link href="/api/openapi" className="font-mono text-xs font-bold text-nepal-blue">/api/openapi →</Link>}>
          <Table cols={["Method", "Path", "Status", "Summary"]} rows={ENDPOINTS.map((e) => [e.method, <span key={e.path} className="font-mono text-[11px]">{e.path}</span>, e.status, e.summary])} />
        </Card>
        <Card title={tx("ब्याकग्राउन्ड सहायक (तालिका + डेमो)", "Background helper (schedule + demo)", lang)}>
          <WorkerRunner lang={lang} />
          <p className="mt-1 text-[12px] text-slate-500">{tx("API मात्र व्यवसाय डेटा लेख्छ; सहायक उही DB/queue पढेर ढिलो काम गर्छ — अनुरोध छिटो रहन्छ। ब्राउजरले API को छोटो-आयु signed लिंकबाट MinIO मा सिधै अपलोड गर्छ।", "Only the API writes business data; the helper reads the same DB/queue for slow work — requests stay fast. Browsers upload straight to MinIO on short-lived signed links.", lang)}</p>
        </Card>
      </div>
    </div>
  );
}
