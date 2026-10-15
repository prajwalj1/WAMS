"use client";
import { useState } from "react";
import Link from "next/link";
import { useApp } from "@/lib/store";
import { t, tx } from "@/lib/i18n";
import { Stat, Card, Table, HealthChip, Bars, StatusChip, TrendChart, DistBar, BudgetBars } from "@/components/ui";
import { useCollection, Loading } from "@/lib/use-data";
import { totalWorks, ongoingWorks, delayedWorks, completedWorks, avgPhysical, avgExpected, enrichWorks, pendingApprovals, utilisation, budgetAllocated, budgetRevised, spentVerified, verifiedSpentByWork, verifiedSpentBySubhead, workingDaysBetween, isSpentBill } from "@/lib/metrics";
import { kathmanduDayKey } from "@/lib/progress";
import { trendWithTargets } from "@/lib/trends";

// Role → dashboard level (§14). Strict: each role sees ONLY its own dashboard —
// there is no cross-level switcher. SUPER_ADMIN sees National, ministry roles
// see Ministry, unit roles see Unit.
const levelFor = (role) => (role === "SUPER_ADMIN" ? "national" : ["MINISTRY_ADMIN", "APPROVER", "AUDITOR", "FINANCE_OFFICER"].includes(role) ? "ministry" : "unit");

// Row-level isolation: non-SUPER_ADMIN users only ever see records under their
// own unit subtree (orgAncestors). SUPER_ADMIN (scopeIds null) sees everything.
const inScope = (rec, scopeIds) => !scopeIds || (rec?.orgAncestors || []).some((a) => scopeIds.includes(a));
const cr = (n) => `${((Number(n) || 0) / 10000000).toFixed(1)}cr`;

// Live ministry key from scoped fields — no pre-aggregated collection.
const ministryKeyOf = (w) => (w?.orgAncestors?.[1] || w?.orgUnitId || "unknown").toString().toLowerCase();
const fyLabelOf = (works) => {
  const fys = [...new Set((works || []).map((w) => w.fy).filter(Boolean))];
  return fys.length ? fys.join(", ") : "—";
};

function KpiRow({ items }) {
  return (
    <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
      {items.map((k, i) => <Stat key={`${k.label}-${i}`} {...k} />)}
    </div>
  );
}

function WorkRow({ w, lang }) {
  return (
    <Link href={`/works/${w.id}`} className="block min-w-0 rounded-lg border border-slate-200 p-2.5 hover:border-nepal-blue">
      <div className="flex flex-col gap-1.5 min-[480px]:flex-row min-[480px]:flex-wrap min-[480px]:items-center min-[480px]:justify-between">
        <div className="min-w-0 flex-1"><div className="break-words text-sm font-bold">{lang === "ne" ? w.titleNe : w.titleEn} <span className="font-mono text-xs font-normal text-slate-400">{w.id}</span></div>
          <div className="break-words text-xs text-slate-500">{w.unit} · {w.owner} · gap {w.gap}</div></div>
        <div className="shrink-0"><HealthChip health={w.health} lang={lang} /></div>
      </div>
      <div className="mt-2"><Bars expected={w.expected} physical={w.physical} financial={w.financialCapped ?? w.financial} financialDisplay={w.financialDisplay} lang={lang} /></div>
    </Link>
  );
}

// ── National (PMO) ───────────────────────────────────────────────────────────
// Everything computed live from WORKS / BUDGET / EXPENDITURES / UNITS.
// No pre-aggregated ministries collection, no hardcoded totals.
// Monthly trend helper lives in lib/trends (spent + targets + projection).

function National({ lang, D }) {
  const { WORKS, TIPPANIS, BUDGET, UNITS, EXPENDITURES } = D;
  const today = new Date();
  const [weighted, setWeighted] = useState(true);
  const [selMin, setSelMin] = useState("all");
  const triQ = useCollection("trimester");
  const usersQ = useCollection("users");

  // PMO monitors the whole portfolio — every status including DRAFT works
  // under preparation, so nothing stays invisible at national level.
  // `counted` (non-draft) is kept only as a sub-label, not as a filter.
  const all = WORKS || [];
  const enrichedAll = enrichWorks(all, today);
  const counted = totalWorks(all);
  const delayed = delayedWorks(enrichedAll);

  const avgP = avgPhysical(enrichedAll, weighted);
  const avgE = avgExpected(enrichedAll, weighted);

  // Budget live: prefer budget lines, fall back to works sums.
  const alloc = (BUDGET?.length ? budgetAllocated(BUDGET) : (WORKS || []).reduce((a, w) => a + (Number(w.budgetPaisa) || 0), 0)) || 0;
  const revised = (BUDGET?.length ? budgetRevised(BUDGET) : alloc) || 0;
  const spent = (EXPENDITURES?.length ? spentVerified(EXPENDITURES) : (BUDGET || []).reduce((a, b) => a + (Number(b.spent) || 0), 0)) || 0;

  const norm = (v) => String(v ?? "").trim().toLowerCase();
  const unitsById = Object.fromEntries((UNITS || []).map((u) => [norm(u.id || u.code || u._id), u]));
  // Also index by code so minister accounts carrying code-form unitIds match.
  (UNITS || []).forEach((u) => {
    if (u.code && !unitsById[norm(u.code)]) unitsById[norm(u.code)] = u;
  });
  const ministryName = (key) => {
    const u = unitsById[norm(key)];
    if (!u) return String(key || "").toUpperCase();
    return lang === "ne" ? (u.nameNe || u.nameEn || u.code || key) : (u.nameEn || u.nameNe || u.code || key);
  };
  const ministryCode = (key) => unitsById[norm(key)]?.code || String(key || "").toUpperCase();

  // Dynamic minister lookup: live MINISTRY_ADMIN user posted to each
  // unit (matches id/code/_id, case-insensitive, resolved to the canonical
  // unit id). A minister posted to a non-MINISTRY unit (e.g. Municipal is
  // stored as DEPARTMENT under MOICS) still counts — that unit gets its own
  // ministry-level row below. Falls back to the unit's stored `head`
  // string so seeded/manual heads still display.
  const ministerByMin = {};
  (usersQ.data || []).filter((u) => u.role === "MINISTRY_ADMIN").forEach((u) => {
    const hit = unitsById[norm(u.unitId)];
    const ck = hit ? norm(hit.id || hit.code) : norm(u.unitId);
    if (ck && !ministerByMin[ck]) ministerByMin[ck] = u;
  });
  const ministerUnitKeys = new Set(Object.keys(ministerByMin));
  const ministerNameOf = (key) => {
    const m = ministerByMin[norm(key)];
    if (m) return m.nameEn || m.name || m.username || "—";
    const u = unitsById[norm(key)];
    if (u?.head && u.head !== "—") return u.head;
    return "—";
  };

  // Dynamic ministry key: scan orgAncestors deepest-first for the unit that
  // acts as a ministry — TYPE is MINISTRY or a minister is posted there —
  // so renames/moves/new ministries (and minister-led departments like
  // Municipal) keep working. Falls back to the legacy orgAncestors[1].
  const ministryKeyDynamic = (rec) => {
    const anc = rec?.orgAncestors || [];
    for (let i = anc.length - 1; i >= 0; i--) {
      const u = unitsById[norm(anc[i])];
      const ck = u ? norm(u.id || u.code) : norm(anc[i]);
      if (u?.type === "MINISTRY" || ministerUnitKeys.has(ck)) return ck;
    }
    return ministryKeyOf(rec);
  };

  // Group all monitored works by ministry. Seed groups from the live
  // MINISTRY-type units AND every unit with a minister posted to it, so a
  // ministry with zero works — or a minister-led unit stored as DEPARTMENT
  // (Municipal) — still appears (previously only ministries WITH works did).
  const blankHealth = () => ({ ON_TRACK: 0, AT_RISK: 0, BEHIND: 0, OVERDUE: 0, NOT_STARTED: 0 });
  const groups = {};
  (UNITS || []).filter((u) => !u.archivedAt && (u.type === "MINISTRY" || ministerUnitKeys.has(norm(u.id || u.code)))).forEach((u) => {
    const k = norm(u.id || u.code);
    groups[k] = groups[k] || { key: k, works: [], health: blankHealth() };
  });
  enrichedAll.forEach((w) => {
    const k = norm(ministryKeyDynamic(w));
    groups[k] = groups[k] || { key: k, works: [], health: blankHealth() };
    groups[k].works.push(w);
    if (groups[k].health[w.health] == null) groups[k].health[w.health] = 0;
    groups[k].health[w.health] += 1;
  });
  // Budget per ministry: allocated from live lines, spent from verified
  // expenditures only (stored line.spent is never trusted).
  const budgetByMin = {};
  (BUDGET || []).forEach((b) => {
    const k = norm(ministryKeyDynamic(b));
    budgetByMin[k] = budgetByMin[k] || { allocated: 0 };
    budgetByMin[k].allocated += Number(b.allocated) || 0;
  });
  const verifiedByWork = verifiedSpentByWork(EXPENDITURES);
  const ministries = Object.values(groups).map((g) => {
    const n = g.works.length || 1;
    const bb = budgetByMin[g.key] || {};
    const wAlloc = g.works.reduce((a, w) => a + (Number(w.budgetPaisa) || 0), 0);
    const wSpent = g.works.reduce((a, w) => a + (verifiedByWork[w.id] ?? Number(w.spentPaisa) ?? 0), 0);
    return {
      key: g.key,
      name: ministryName(g.key),
      code: ministryCode(g.key),
      minister: ministerNameOf(g.key),
      works: g.works.length,
      delayed: g.works.filter((w) => ["BEHIND", "OVERDUE"].includes(w.health)).length,
      avgPhysical: Math.round(g.works.reduce((a, w) => a + (Number(w.physical) || 0), 0) / n),
      avgExpected: Math.round(g.works.reduce((a, w) => a + (Number(w.expected) || 0), 0) / n),
      allocated: bb.allocated || wAlloc,
      spent: wSpent,
      health: g.health,
    };
  }).sort((a, b) => b.works - a.works);

  const fyLabel = fyLabelOf(WORKS);

  // Ministry/minister filter — makes the work lists dynamic per minister.
  const scopedWorks = selMin === "all" ? enrichedAll : (groups[selMin]?.works || []);
  const topDelayed = [...scopedWorks].sort((a, b) => a.gap - b.gap).slice(0, 10);
  const atRisk = scopedWorks.filter((w) => w.health === "AT_RISK").sort((a, b) => a.gap - b.gap).slice(0, 10);
  // Wait is computed live from the step start — the stored waitDays snapshot
  // goes stale (nothing recomputes it). Same rule as the tippani inbox.
  const waitOf = (x) => (x.status === "IN_REVIEW" && x.stepSince ? workingDaysBetween(x.stepSince, kathmanduDayKey(today)) : (Number(x.waitDays) || 0));
  const stuckTip = (TIPPANIS || [])
    .filter((x) => waitOf(x) > 5)
    .filter((x) => selMin === "all" || norm(ministryKeyDynamic(x)) === selMin);

  // Monthly verified spending (lakh) — live from expenditures.
  const monthly = {};
  (EXPENDITURES || []).filter((e) => e.status === "VERIFIED" && e.date).forEach((e) => {
    const m = (e.date || "").slice(0, 7);
    monthly[m] = (monthly[m] || 0) + (Number(e.net ?? e.spent) || 0);
  });
  const trend = trendWithTargets(monthly, (triQ.data || []).filter((r) => r.kind === "target"));

  return (
    <div className="space-y-3">
      <div className="no-print flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
        <button onClick={() => setWeighted(true)} className={`rounded-full border px-2.5 py-1 ${weighted ? "bg-nepal-blue text-white" : "bg-white text-slate-600"}`}>{tx("बजेट-भारित", "Budget-weighted", lang)}</button>
        <button onClick={() => setWeighted(false)} className={`rounded-full border px-2.5 py-1 ${!weighted ? "bg-nepal-blue text-white" : "bg-white text-slate-600"}`}>{tx("साधारण औसत", "Simple mean", lang)}</button>
        <label className="ml-1 flex items-center gap-1.5 rounded-full border bg-white px-2.5 py-1 text-slate-600">
          {tx("मन्त्री/मन्त्रालय:", "Minister/ministry:", lang)}
          <select value={selMin} onChange={(e) => setSelMin(e.target.value)} className="max-w-[220px] bg-transparent font-bold text-slate-900 outline-none">
            <option value="all">{tx("सबै", "All", lang)}</option>
            {ministries.map((m) => <option key={m.key} value={m.key}>{m.code} · {m.minister}</option>)}
          </select>
        </label>
        {usersQ.loading && <span className="font-normal text-slate-400">…</span>}
      </div>
      <KpiRow items={[
        { label: t("totalWorks", lang), value: all.length, sub: `${counted.length} counted · ${ministries.length} ministries · FY ${fyLabel}` },
        { label: t("ongoing", lang), value: ongoingWorks(WORKS || []).length, sub: "ONGOING + ON_HOLD", accent: "border-emerald-500" },
        { label: t("delayed", lang), value: delayed.length, sub: "BEHIND / OVERDUE", accent: "border-nepal-crimson" },
        { label: t("completed", lang), value: completedWorks(WORKS || []).length, sub: "VERIFIED + CLOSED", accent: "border-emerald-500" },
        { label: tx("औसत भौतिक / अपेक्षित", "Avg physical / expected", lang), value: `${Math.round(avgP)} / ${Math.round(avgE)}`, sub: `gap ${Math.round(avgP - avgE)} · ${weighted ? tx("बजेट-भारित", "budget-weighted", lang) : tx("साधारण औसत", "simple mean", lang)}`, accent: "border-nepal-gold" },
        { label: t("spentPct", lang), value: `${Math.round(utilisation(spent, revised || alloc))}%`, sub: `${cr(spent)} / ${cr(revised || alloc)}`, accent: "border-nepal-gold" },
      ]} />

      <div className="grid gap-3 xl:grid-cols-2">
        <Card title={tx("मन्त्रालय तुलना", "Ministry comparison", lang)}>
          {ministries.length === 0 ? <p className="text-sm text-slate-400">—</p> : (
            <Table cols={[tx("मन्त्रालय", "Ministry", lang), tx("मन्त्री", "Minister", lang), tx("कार्य", "Works", lang), tx("ढिलो", "Delayed", lang), tx("भौतिक/अपेक्षित", "Phy/Exp", lang), tx("खर्च%", "Spent%", lang)]}
              rows={ministries.map((m) => [m.name, m.minister, m.works, m.delayed, `${m.avgPhysical}/${m.avgExpected}`, `${Math.round(utilisation(m.spent, m.allocated))}%`])} />
          )}
        </Card>
        <Card title={tx("स्वास्थ्य वितरण (मन्त्रालयअनुसार)", "Health distribution by ministry", lang)}>
          {ministries.length === 0 ? <p className="text-sm text-slate-400">—</p> : (
            <div className="space-y-2">{ministries.map((m) => <div key={m.key}><div className="mb-0.5 text-xs font-bold">{m.code} · {m.minister}</div><DistBar dist={m.health} lang={lang} /></div>)}</div>
          )}
        </Card>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <Card title={tx("बजेट — विनियोजित vs खर्च", "Budget — allocated vs spent", lang)}>
          {ministries.length === 0 ? <p className="text-sm text-slate-400">—</p> : <BudgetBars rows={ministries} />}
        </Card>
        <Card title={tx("मासिक खर्च प्रवृत्ति (लाख)", "Monthly spending trend (lakh)", lang)} action={<Link href="/budget" className="text-xs font-bold text-nepal-blue">Set target →</Link>}>
          {trend.length === 0 ? <p className="text-sm text-slate-400">—</p> : <TrendChart series={trend} lang={lang} />}
        </Card>
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        <Card title={selMin === "all" ? tx("शीर्ष १० ढिलो कार्य", "Top 10 delayed works", lang) : `${tx("शीर्ष १० ढिलो कार्य", "Top 10 delayed works", lang)} · ${ministryCode(selMin)} · ${ministerNameOf(selMin)}`} action={<Link href="/works" className="text-xs font-bold text-nepal-blue">{t("all", lang)} →</Link>} className="xl:col-span-2">
          {topDelayed.length === 0 ? <p className="text-sm text-slate-400">—</p> : (
            <div className="space-y-3">{topDelayed.map((w) => <WorkRow key={w.id} w={w} lang={lang} />)}</div>
          )}
        </Card>
        <Card title={selMin === "all" ? tx("५ दिनभन्दा बढी बाँकी स्वीकृति", "Pending approvals > 5 days", lang) : `${tx("५ दिनभन्दा बढी बाँकी स्वीकृति", "Pending approvals > 5 days", lang)} · ${ministryCode(selMin)}`}>
          {stuckTip.length === 0 && <p className="text-[13px] text-slate-400">—</p>}
          {stuckTip.map((x) => <div key={x.ref} className="border-b border-slate-100 py-1.5 text-[13px] last:border-0"><Link href={`/tippani/${x.ref}`} className="font-bold text-nepal-blue">{x.ref}</Link><div className="text-slate-600">{x.subject}</div><div className="text-xs text-red-600">{x.step} · {waitOf(x)}{tx(" दिन", "d", lang)} 🔴</div></div>)}
        </Card>
      </div>
      <Card title={selMin === "all" ? tx("जोखिममा परेका कार्य", "At-risk works", lang) : `${tx("जोखिममा परेका कार्य", "At-risk works", lang)} · ${ministryCode(selMin)} · ${ministerNameOf(selMin)}`} action={<Link href="/works" className="text-xs font-bold text-nepal-blue">{t("all", lang)} →</Link>}>
        {atRisk.length === 0 ? <p className="text-sm text-slate-400">—</p> : (
          <div className="space-y-3">{atRisk.map((w) => <WorkRow key={w.id} w={w} lang={lang} />)}</div>
        )}
      </Card>
    </div>
  );
}

// ── Ministry ─────────────────────────────────────────────────────────────────
// Every number below is computed live from the database collections — no
// hardcoded totals. Empty collections render as 0 / —.
function Ministry({ lang, D }) {
  const triQ = useCollection("trimester");
  const { WORKS, TIPPANIS, BUDGET, PROCUREMENTS, DIRECTIVES, EXPENDITURES, UNITS } = D;
  const today = new Date();
  const enriched = enrichWorks(WORKS || [], today);
  const counted = totalWorks(WORKS || []);
  const delayed = delayedWorks(enriched);
  const atRiskMin = enriched.filter((w) => w.health === "AT_RISK").sort((a, b) => a.gap - b.gap).slice(0, 10);
  const pend = pendingApprovals({ tippanis: TIPPANIS || [], works: WORKS || [], revisions: [] });
  // Approvals stuck over 5 working days — live wait from step start (same
  // rule as National + inbox; never the stored snapshot).
  const waitMin = (x) => (x.status === "IN_REVIEW" && x.stepSince ? workingDaysBetween(x.stepSince, kathmanduDayKey(today)) : (Number(x.waitDays) || 0));
  const stuckMin = (TIPPANIS || []).filter((x) => waitMin(x) > 5);
  // Unit breakdown grouped by org identity (unit record when known), so
  // inconsistent display-name strings can't fragment a unit into many rows.
  const unitById = new Map((UNITS || []).map((u) => [u.id ?? u._id, u]));
  const byUnit = {};
  // Whole portfolio like National (drafts under preparation included) —
  // counting only submitted works hid entire departments from the minister.
  enriched.forEach((w) => {
    const u = unitById.get(w.orgUnitId);
    const k = w.orgUnitId || w.unit || "—";
    byUnit[k] = byUnit[k] || { name: (lang === "ne" ? (u?.nameNe || u?.nameEn) : (u?.nameEn || u?.nameNe)) || w.unit || "—", works: 0, physical: 0, expected: 0 };
    byUnit[k].works += 1;
    byUnit[k].physical += Number(w.physical) || 0;
    byUnit[k].expected += Number(w.expected) || 0;
  });
  const units = Object.values(byUnit).map((u) => ({
    ...u,
    physical: Math.round(u.physical / Math.max(1, u.works)),
    expected: Math.round(u.expected / Math.max(1, u.works)),
  }));
  const stages = {};
  (PROCUREMENTS || []).forEach((p) => { stages[p.stage] = (stages[p.stage] || 0) + 1; });
  const byStep = {};
  (TIPPANIS || []).filter((x) => x.status === "IN_REVIEW").forEach((x) => { byStep[x.step] = (byStep[x.step] || 0) + 1; });
  // Same fallback as National: scoped works' budgets stand in when no
  // budget lines are visible, so Spent % never divides by a missing base.
  const allocMin = (BUDGET?.length ? budgetAllocated(BUDGET) : (WORKS || []).reduce((a, w) => a + (Number(w.budgetPaisa) || 0), 0)) || 0;
  const spent = (EXPENDITURES?.length ? spentVerified(EXPENDITURES) : (BUDGET || []).reduce((a, b) => a + (Number(b.spent) || 0), 0)) || 0;
  const revised = (BUDGET?.length ? budgetRevised(BUDGET) : allocMin) || 0;
  // Bars use live verified sums per sub-head — stored line.spent is stale (0).
  const spentBySub = verifiedSpentBySubhead(EXPENDITURES, WORKS);
  const fyLabel = fyLabelOf(WORKS);
  // Monthly verified spending (lakh) — live from expenditures.
  const monthly = {};
  (EXPENDITURES || []).filter((e) => e.status === "VERIFIED" && e.date).forEach((e) => {
    const m = (e.date || "").slice(0, 7);
    monthly[m] = (monthly[m] || 0) + (Number(e.net ?? e.spent) || 0);
  });
  const trend = trendWithTargets(monthly, (triQ.data || []).filter((r) => r.kind === "target"));
  return (
    <div className="space-y-3">
      <KpiRow items={[
        { label: t("totalWorks", lang), value: (WORKS || []).length, sub: `${counted.length} ${tx("गनिएका", "counted", lang)} · FY ${fyLabel}` },
        { label: t("ongoing", lang), value: ongoingWorks(WORKS || []).length, sub: "ONGOING + ON_HOLD", accent: "border-emerald-500" },
        { label: t("delayed", lang), value: delayed.length, sub: "BEHIND / OVERDUE", accent: "border-nepal-crimson" },
        { label: t("completed", lang), value: completedWorks(WORKS || []).length, sub: "VERIFIED + CLOSED", accent: "border-emerald-500" },
        { label: t("spentPct", lang), value: `${Math.round(utilisation(spent, revised))}%`, sub: "spent ÷ revised", accent: "border-nepal-gold" },
        { label: t("pendingTip", lang), value: pend.total, sub: `tip ${pend.tippani} · sub ${pend.submitted} · rev ${pend.revisions} · comp ${pend.completions}`, accent: "border-amber-500" },
      ]} />
      <div className="grid gap-3 xl:grid-cols-2">
        <Card title={tx("विभाग vs महाशाखा", "Department vs Mahashakha", lang)}>
          {units.length === 0 ? <p className="text-sm text-slate-400">—</p> : (
            <Table cols={[tx("एकाइ", "Unit", lang), tx("कार्य", "Works", lang), tx("भौतिक", "Physical", lang), tx("अपेक्षित", "Expected", lang), tx("अन्तर", "Gap", lang)]}
              rows={units.map((u) => [u.name, u.works, `${u.physical}%`, `${u.expected}%`, u.physical - u.expected])} />
          )}
        </Card>
        <Card title={tx("बजेट — विनियोजित vs खर्च (उप-शीर्षक)", "Budget — allocated vs spent (sub-heads)", lang)}>
          {(BUDGET || []).length === 0 ? <p className="text-sm text-slate-400">—</p> : (
            <BudgetBars rows={BUDGET.map((b) => ({ code: b.subhead, allocated: Number(b.allocated) || 0, spent: spentBySub[b.subhead] || 0 }))} />
          )}
          <div className="mt-2"><DistBar dist={{ ON_TRACK: enriched.filter((w) => w.health === "ON_TRACK").length, AT_RISK: enriched.filter((w) => w.health === "AT_RISK").length, BEHIND: enriched.filter((w) => w.health === "BEHIND").length, OVERDUE: enriched.filter((w) => w.health === "OVERDUE").length, NOT_STARTED: enriched.filter((w) => w.health === "NOT_STARTED").length }} lang={lang} /></div>
        </Card>
      </div>
      <div className="grid items-start gap-3 xl:grid-cols-3">
        <div className="space-y-3 xl:col-span-2">
        <Card title={tx("खरिद चरण वितरण", "Procurement stage distribution", lang)}>
          <Table cols={[tx("चरण", "Stage", lang), "#"]} rows={Object.entries(stages).map(([s, n]) => [s, n])} />
          <div className="mt-2 text-[13px] font-bold">{tx("चरणअनुसार टिप्पणी प्रतीक्षा", "Tippani waiting by step", lang)}</div>
          <Table cols={[tx("चरण", "Step", lang), "#"]} rows={Object.entries(byStep).map(([s, n]) => [s, n])} />
        </Card>
        <Card title={tx("ढिलो + म्याद नाघेका", "Delayed and overdue", lang)} action={<Link href="/works" className="text-xs font-bold text-nepal-blue">{t("all", lang)} →</Link>}>
          <div className="space-y-3">{delayed.map((w) => <WorkRow key={w.id} w={w} lang={lang} />)}{delayed.length === 0 && <p className="text-sm text-slate-400">—</p>}</div>
        </Card>
        <Card title={tx("जोखिममा परेका कार्य", "At-risk works", lang)} action={<Link href="/works" className="text-xs font-bold text-nepal-blue">{t("all", lang)} →</Link>}>
          <div className="space-y-3">{atRiskMin.map((w) => <WorkRow key={w.id} w={w} lang={lang} />)}{atRiskMin.length === 0 && <p className="text-sm text-slate-400">—</p>}</div>
        </Card>
        </div>
        {/* Fixed right rail — directives, trend and stuck approvals stay
            visible while the main column scrolls. Own scroll when taller
            than the viewport; stacks below on small screens. */}
        <div className="nice-scroll space-y-3 self-start xl:sticky xl:top-3 xl:max-h-[calc(100vh-1rem)] xl:overflow-y-auto">
          <Card title={tx("खुला निर्देशन", "Directives open", lang)}>
            {(DIRECTIVES || []).length === 0 && <p className="text-sm text-slate-400">—</p>}
            {(DIRECTIVES || []).map((d) => <div key={d.id} className="border-b border-slate-100 py-1.5 text-[13px] last:border-0"><b>{d.id}</b> · {d.text}<div className="text-xs text-slate-500">{d.due} · {d.status}</div></div>)}
          </Card>
          <Card title={tx("मासिक खर्च (प्रमाणित)", "Monthly spending (verified)", lang)} action={<Link href="/budget" className="text-xs font-bold text-nepal-blue">Set target →</Link>}>
            {trend.length === 0 ? <p className="text-sm text-slate-400">—</p> : <TrendChart series={trend} lang={lang} />}
          </Card>
          <Card title={tx("५ दिनभन्दा बढी बाँकी स्वीकृति", "Pending approvals > 5 days", lang)}>
            {stuckMin.length === 0 && <p className="text-[13px] text-slate-400">—</p>}
            {stuckMin.map((x) => <div key={x.ref} className="border-b border-slate-100 py-1.5 text-[13px] last:border-0"><Link href={`/tippani/${x.ref}`} className="font-bold text-nepal-blue">{x.ref}</Link><div className="text-slate-600">{x.subject}</div><div className="text-xs text-red-600">{x.step} · {waitMin(x)}{tx(" दिन", "d", lang)} 🔴</div></div>)}
          </Card>
        </div>
      </div>
    </div>
  );
}

// ── Unit (Dept / Mahashakha / Section) ───────────────────────────────────────
// Scoped to the logged-in user's unit; every figure comes from the database.
function Unit({ lang, D }) {
  const { user } = useApp();
  const { WORKS, TASKS, BUDGET, ISSUES, EXPENDITURES } = D;
  const today = new Date();
  const unitName = user?.unit || "";
  const uid = user?.unitId || "";
  const enriched = enrichWorks(WORKS || [], today);
  // "My works": match by org identity (orgUnitId / orgAncestors), not by the
  // display-name string — work.unit and user.unit rarely use the same form,
  // which left department/mahashakha dashboards showing 0 works. Name match
  // stays only as a legacy fallback for records without org fields.
  const mine = enriched.filter((w) => {
    if (w.orgUnitId && uid) return w.orgUnitId === uid || (w.orgAncestors || []).includes(uid);
    if (w.orgUnitId || (w.orgAncestors || []).length) return false;
    return unitName ? w.unit === unitName : true;
  });
  const todayStr = kathmanduDayKey(today);
  const wl = {};
  (TASKS || []).forEach((x) => {
    wl[x.owner] = wl[x.owner] || { open: 0, overdue: 0 };
    if (!["DONE", "CANCELLED"].includes(x.status)) {
      wl[x.owner].open += 1;
      if (x.deadline && x.deadline < todayStr) wl[x.owner].overdue += 1;
    }
  });
  const missing = (TASKS || []).filter((x) => x.status === "IN_PROGRESS" && (Number(x.physical) || 0) < 50);
  const openIssues = (ISSUES || []).filter((x) => x.status !== "CLOSED");
  const completions = mine.filter((w) => w.status === "COMPLETION_SUBMITTED");
  const myBudget = mine.reduce((a, w) => a + (Number(w.budgetPaisa) || 0), 0);
  const mySpent = mine.reduce((a, w) => a + (Number(w.spentPaisa) || 0), 0);
  // Monthly verified spending (lakh) for my works only — same source as the
  // National/Ministry trend cards (VERIFIED expenditures with a date).
  const triQ = useCollection("trimester");
  const myIds = new Set(mine.map((w) => w.id));
  const myMonthly = {};
  (EXPENDITURES || []).filter((e) => e.status === "VERIFIED" && e.date && myIds.has(e.work)).forEach((e) => {
    const m = (e.date || "").slice(0, 7);
    myMonthly[m] = (myMonthly[m] || 0) + (Number(e.net ?? e.spent) || 0);
  });
  const myTrend = trendWithTargets(myMonthly, (triQ.data || []).filter((r) => r.kind === "target"));
  return (
    <div className="space-y-3">
      <KpiRow items={[
        { label: tx("मेरा कार्य", "My works", lang), value: mine.length, sub: unitName || "—" },
        { label: t("delayed", lang), value: mine.filter((w) => ["BEHIND", "OVERDUE"].includes(w.health)).length, sub: "BEHIND / OVERDUE", accent: "border-nepal-crimson" },
        { label: tx("खुला समस्या", "Open issues", lang), value: openIssues.length, sub: "issues", accent: "border-amber-500" },
        { label: tx("समीक्षा बाँकी", "Reviews waiting", lang), value: completions.length, sub: "COMPLETION_SUBMITTED" },
        { label: tx("अपडेट छुटेका", "Updates missing", lang), value: missing.length, sub: "stalled tasks", accent: "border-amber-500" },
        { label: t("spentPct", lang), value: `${Math.round(utilisation(mySpent, myBudget))}%`, sub: "unit works spent ÷ budget", accent: "border-nepal-gold" },
      ]} />
      <Card title={tx("कार्य तालिका + स्वास्थ्य", "Works table with health", lang)} action={<Link href="/works" className="text-xs font-bold text-nepal-blue">{t("all", lang)} →</Link>}>
        {mine.length === 0 ? <p className="text-sm text-slate-400">—</p> : (
          <div className="space-y-3">{mine.map((w) => <WorkRow key={w.id} w={w} lang={lang} />)}</div>
        )}
      </Card>
      <Card title={tx("जोखिममा परेका कार्य", "At-risk works", lang)} action={<Link href="/works" className="text-xs font-bold text-nepal-blue">{t("all", lang)} →</Link>}>
        {mine.filter((w) => w.health === "AT_RISK").length === 0 ? <p className="text-sm text-slate-400">—</p> : (
          <div className="space-y-3">{mine.filter((w) => w.health === "AT_RISK").sort((a, b) => a.gap - b.gap).slice(0, 10).map((w) => <WorkRow key={w.id} w={w} lang={lang} />)}</div>
        )}
      </Card>
      <div className="grid gap-3 xl:grid-cols-3">
        <Card title={tx("कर्मचारी कार्यभार", "Staff workload", lang)}>
          {Object.keys(wl).length === 0 ? <p className="text-sm text-slate-400">—</p> : (
            <Table cols={[tx("व्यक्ति", "Person", lang), tx("खुला", "Open", lang), tx("म्याद नाघेका", "Overdue", lang)]} rows={Object.entries(wl).map(([p, v]) => [p, v.open, v.overdue])} />
          )}
        </Card>
        <Card title={tx("बजेट लाइन", "Budget lines", lang)} action={<Link href="/budget" className="text-xs font-bold text-nepal-blue">{t("all", lang)} →</Link>}>
          {(BUDGET || []).length === 0 ? <p className="text-sm text-slate-400">—</p> : (
            <Table cols={["Sub-head", tx("उपयोग %", "Util %", lang)]} rows={BUDGET.map((b) => [<Link key={b.subhead} href={`/budget/lines/${b.subhead}`} className="font-mono text-nepal-blue">{b.subhead}</Link>, `${Math.round(utilisation(Number(b.spent) || 0, Number(b.revised) || 0))}%`])} />
          )}
        </Card>
        <div className="space-y-3">
          <Card title={tx("मासिक खर्च (प्रमाणित)", "Monthly spending (verified)", lang)} action={<div className="flex gap-2"><Link href="/budget" className="text-xs font-bold text-nepal-blue">Set target →</Link><Link href="/expenditures" className="text-xs font-bold text-nepal-blue">{t("all", lang)} →</Link></div>}>
            {myTrend.length === 0 ? <p className="text-sm text-slate-400">—</p> : <TrendChart series={myTrend} lang={lang} />}
          </Card>
          <Card title={tx("समीक्षा बाँकी", "Reviews waiting", lang)} action={<Link href="/reviews" className="text-xs font-bold text-nepal-blue">→</Link>}>
            {completions.length === 0 && <p className="text-sm text-slate-400">—</p>}
            {completions.map((w) => <div key={w.id} className="py-1 text-[13px]"><Link href={`/works/${w.id}`} className="font-bold text-nepal-blue">{w.id}</Link> · {tx("सम्पन्न पेश", "completion submitted", lang)}</div>)}
          </Card>
          <Card title={tx("खुला समस्या + छुटेका अपडेट", "Open issues + missing updates", lang)}>
            {openIssues.length === 0 && missing.length === 0 && <p className="text-sm text-slate-400">—</p>}
            {openIssues.map((x) => <div key={x.id} className="border-b border-slate-100 py-1 text-[13px] last:border-0"><b>{x.id}</b> · {x.text}</div>)}
            {missing.map((x) => <div key={x.ref} className="py-1 text-[13px] text-amber-700">⏳ <Link href={`/tasks/${x.ref}`} className="font-bold">{x.ref}</Link> · {x.physical}% — {tx("अपडेट छैन", "no update", lang)}</div>)}
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { lang, role, perms, user } = useApp();
  // Dashboard is strictly role-derived — the logged-in user cannot switch levels.
  const lv = levelFor(role);
  // Data is scoped to the user's subtree (SUPER_ADMIN sees all). Falsy scope
  // entries (legacy profiles without unitId) are dropped; a unit user with no
  // usable scope sees nothing rather than leaking the whole portfolio.
  const scopeIds = role === "SUPER_ADMIN"
    ? null
    : (() => {
        const raw = user?.scopeUnitIds?.length ? user.scopeUnitIds : user?.unitId ? [user.unitId] : [];
        return raw.filter(Boolean);
      })();
  const works = useCollection("works");
  const tippanis = useCollection("tippanis");
  const budget = useCollection("budget");
  const units = useCollection("units");
  const expenditures = useCollection("expenditures");
  const procurements = useCollection("procurements");
  const tasks = useCollection("tasks");
  const issues = useCollection("issues");
  const directives = useCollection("directives");
  const cols = [works, tippanis, budget, units, expenditures, procurements, tasks, issues, directives];
  const loading = cols.some((c) => c.loading && !(c.data || []).length);
  // Surface backend failures instead of a silent wall of zeros: any
  // collection error (DB_UNAVAILABLE, UNAUTHENTICATED, …) renders a banner
  // with retry, so a Super Admin sees WHY the dashboard reads empty.
  const colErrors = [...new Set(cols.map((c) => c.error).filter(Boolean))];
  const dataError = colErrors.length ? colErrors.join(" · ") : "";
  // Manual refresh: every figure on this dashboard is computed live from the
  // collections below, so one tap re-pulls all of them.
  const reloadAll = () => cols.forEach((c) => { try { c.reload(); } catch {} });
  // No usable unit on the account → every scoped figure reads zero. Say so
  // plainly instead of rendering a wall of zeros that looks static/broken.
  const noScope = role !== "SUPER_ADMIN" && (!scopeIds || scopeIds.length === 0);
  const scopedWorks = (works.data || []).filter((w) => inScope(w, scopeIds));
  const scopedWorkIds = new Set(scopedWorks.map((w) => w.id));
  const D = {
    WORKS: scopedWorks,
    TIPPANIS: (tippanis.data || []).filter((x) => inScope(x, scopeIds)),
    BUDGET: (budget.data || []).filter((b) => inScope(b, scopeIds)),
    UNITS: units.data || [],
    // Expenditures carry no orgAncestors — scope via their parent work.
    EXPENDITURES: scopeIds ? (expenditures.data || []).filter((e) => scopedWorkIds.has(e.work)) : (expenditures.data || []),
    PROCUREMENTS: (procurements.data || []).filter((p) => inScope(p, scopeIds)),
    TASKS: (tasks.data || []).filter((x) => inScope(x, scopeIds)),
    ISSUES: (issues.data || []).filter((x) => inScope(x, scopeIds)),
    DIRECTIVES: (directives.data || []).filter((x) => inScope(x, scopeIds)),
  };
  const can = (need) => (perms || []).includes("*") || (perms || []).includes(need);
  // Expenditure entry is department/mahashakha work specifically.
  const canEnterExp = ["UNIT_HEAD", "SECTION_HEAD", "STAFF"].includes(role);
  const quick = [
    [tx("+ नयाँ कार्य", "+ New work", lang), "/works/new", "work.create"],
    [tx("टिप्पणी मस्यौदा", "Draft Tippani", lang), "/tippani/new", "tippani.draft"],
    ...(canEnterExp ? [[tx("खर्च प्रविष्टि", "Enter expenditure", lang), "/expenditures", null]] : []),
    [tx("चौमासिक रिपोर्ट", "Run trimester report", lang), "/reports/RPT-TRIMESTER", "report.export"],
  ].filter(([, , need]) => !need || can(need));
  const levelLabel = lv === "national" ? tx("राष्ट्रिय", "National", lang) : lv === "ministry" ? tx("मन्त्रालय", "Ministry", lang) : tx("एकाइ", "Unit", lang);
  // Workflow status strip: live counts across the whole chain — tippani
  // inbox, active procurements, bills awaiting verification/paid, completion
  // reviews, overdue works, open issues. Same collections the sections use.
  const wf = {
    tippaniWaiting: D.TIPPANIS.filter((x) => x.status === "IN_REVIEW").length,
    procuring: D.PROCUREMENTS.filter((p) => !["COMPLETION", "CANCELLED"].includes(p.stage)).length,
    billsToVerify: D.EXPENDITURES.filter((e) => e.status === "SUBMITTED").length,
    billsToApprove: D.EXPENDITURES.filter((e) => e.status === "VERIFIED").length,
    billsToPay: D.EXPENDITURES.filter((e) => e.status === "APPROVED" && !e.paidDate).length,
    completions: D.WORKS.filter((w) => w.status === "COMPLETION_SUBMITTED").length,
    issues: D.ISSUES.filter((x) => !["RESOLVED", "CLOSED"].includes(x.status)).length,
  };
  // Unit-type role line: what this viewer's unit does — Mahashakha (Division)
  // spends the ministry budget via Tippani; a Department owns its budget and
  // works independently. Resolved live from the units collection (id/code/_id —
  // the profile may carry any form).
  const myUnit = (D.UNITS || []).find((u) =>
    [u.id, u.code, u._id].filter(Boolean).map(String).includes(String(user?.unitId || "")));
  const unitRoleLine = myUnit?.type === "MAHASHAKHA"
    ? tx("महाशाखा (Division) — मन्त्रालय बजेट टिप्पणीबाट खर्च", "Mahashakha (Division) — Spends ministry budget via Tippani", lang)
    : myUnit?.type === "DEPARTMENT"
      ? tx("विभाग — आफ्नै बजेट, स्वतन्त्र कार्य", "Department — Own budget, works independently", lang)
      : myUnit ? `${myUnit.nameEn || myUnit.code || ""} · ${myUnit.type || ""}` : "";
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-gradient-to-r from-nepal-blue to-sky-700 p-3 text-white sm:p-4">
        <div className="break-words text-xs sm:text-sm opacity-80">{user?.username || role} · {role} · {levelLabel} · {t("gov", lang)}</div>
        {unitRoleLine && <div className="break-words text-xs sm:text-sm font-semibold opacity-95">{unitRoleLine}</div>}
        <h1 className="break-words text-lg font-bold sm:text-2xl">{t("dashTitle", lang)}</h1>
        <p className="mt-1 break-words text-xs sm:text-[13px] opacity-90">{t("dashSub", lang)}</p>
        {quick.length > 0 && (
          <div className="no-print mt-3 flex flex-wrap gap-2 text-[12px] font-semibold">
            {quick.map(([l, h]) => <Link key={h + l} href={h} className="rounded-lg bg-white px-3 py-1.5 text-nepal-blue">{l}</Link>)}
            <button onClick={reloadAll} className="rounded-lg bg-white/20 px-3 py-1.5 text-white">↻ {tx("ताजा", "Refresh", lang)}</button>
          </div>
        )}
      </div>
      {noScope && !loading && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-[13px] font-semibold text-amber-900">
          ⚠️ {tx("तपाईंको खातामा एकाइ छैन — ड्यासबोर्ड खाली देखिन्छ। PMO (Super Admin) लाई तपाईंको मन्त्रालय/एकाइ सेट गर्न लगाउनुहोस्, अनि लगआउट–लगइन गर्नुहोस्।", "Your account has no unit — the dashboard reads empty. Ask PMO (Super Admin) to set your ministry/unit, then log out and log in again.", lang)}
        </div>
      )}
      {dataError && !loading && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-[13px] font-semibold text-red-900">
          ❌ {tx("डाटा लोड भएन", "Data failed to load", lang)} — {dataError}
          <button onClick={reloadAll} className="no-print ml-2 rounded-lg border border-red-300 bg-white px-2 py-0.5 text-xs font-bold">↻ {tx("पुनः प्रयास", "Retry", lang)}</button>
        </div>
      )}

      {loading ? <Card title={t("dashTitle", lang)}><Loading lang={lang} /></Card> : <>
        <Card title={tx("कार्यप्रवाह स्थिति", "Workflow status", lang)}>
          <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-3 xl:grid-cols-7">
            {[
              [tx("टिप्पणी प्रतीक्षा", "Tippani waiting", lang), wf.tippaniWaiting, "/tippani"],
              [tx("खरिद जारी", "Procuring", lang), wf.procuring, "/procurements"],
              [tx("बिल प्रमाणीकरण", "Bills to verify", lang), wf.billsToVerify, "/expenditures"],
              [tx("भुक्तानी स्वीकृति", "Bills to approve", lang), wf.billsToApprove, "/expenditures"],
              [tx("भुक्तानी बाँकी", "Bills to pay", lang), wf.billsToPay, "/expenditures"],
              [tx("सम्पन्न समीक्षा", "Completions to review", lang), wf.completions, "/reviews"],
              [tx("खुला समस्या", "Open issues", lang), wf.issues, "/issues"],
            ].map(([label, n, href]) => (
              <Link key={href + label} href={href} className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 hover:border-nepal-blue">
                <div className="text-xl font-black text-slate-900">{n}</div>
                <div className="text-[11px] text-slate-500">{label}</div>
              </Link>
            ))}
          </div>
        </Card>
        {lv === "national" && <National lang={lang} D={D} />}
        {lv === "ministry" && <Ministry lang={lang} D={D} />}
        {lv === "unit" && <Unit lang={lang} D={D} />}
      </>}
    </div>
  );
}
