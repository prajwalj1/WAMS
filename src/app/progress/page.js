"use client";
import { useState } from "react";
import Link from "next/link";
import { useApp } from "@/lib/store";
import { tx } from "@/lib/i18n";
import { Card, Table, HealthChip, Bars } from "@/components/ui";
import { useCollection, Loading } from "@/lib/use-data";
import { useList } from "@/components/list";
import { workHealth } from "@/lib/progress";
import { verifiedSpentByWork } from "@/lib/metrics";
import { inScopeRecord } from "@/lib/scope";
import ProgressTryIt from "@/components/progress-tryit";

function EnginePanel({ lang }) {
  const { toast } = useApp();
  const [out, setOut] = useState(null);
  const run = async (op, extra = {}) => {
    const r = await fetch("/api/engine", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op, ...extra }) }).then((x) => x.json());
    setOut(r);
    toast(`${op} · ${tx("इन्जिन चल्यो", "Engine ran", lang)}`);
  };
  return (
    <Card title={tx("नाइटली इन्जिन (§32) — 00:30 NPT", "Nightly engine (§32) — 00:30 NPT", lang)}
      action={<div className="no-print flex flex-wrap gap-2">
        <button onClick={() => run("nightly")} className="rounded-lg bg-nepal-blue px-3 py-1.5 text-xs font-bold text-white">▶ {tx("नाइटली", "Nightly", lang)}</button>
        <button onClick={() => run("rollup", { unitId: "it" })} className="rounded-lg border px-3 py-1.5 text-xs font-bold">unit:it</button>
      </div>}>
      <p className="mb-2 text-[12px] text-slate-500">{tx("घटनाले work:{id} मा पुनःगणना कतार गर्छ (collapse) · रातिले स्न्यापसट लेख्छ (कहिल्यै पुनर्लेखन हुँदैन) · ड्यासबोर्ड स्न्यापसटबाट पढ्छ।", "Events queue work:{id} recomputes (collapsed) · nightly writes snapshots (never rewritten) · dashboards read snapshots.", lang)}</p>
      {out && <pre className="overflow-x-auto rounded-lg bg-slate-900 p-2 font-mono text-[11px] text-emerald-200">{JSON.stringify(out, null, 1)}</pre>}
    </Card>
  );
}

export default function ProgressPage() {
  const { lang, role, user, toast } = useApp();
  const [scoped, setScoped] = useState(true);
  // Live results: every work with calculated Expected / Physical / Financial
  // (shared formulas in lib/progress — same as dashboards), spent joined
  // from VERIFIED expenditures. Scoped to the user's subtree like /works.
  const worksQ = useCollection("works");
  const expsQ = useCollection("expenditures");
  const scopeIds = !scoped ? null : role === "SUPER_ADMIN" ? null : (user?.scopeUnitIds?.length ? user.scopeUnitIds : user?.unitId ? [user.unitId] : []);
  const spentByWork = verifiedSpentByWork(expsQ.data || []);
  const allResults = (worksQ.data || [])
    .map((w) => ({ ...w, ...workHealth({ ...w, spentVerifiedPaisa: spentByWork[w.id] ?? 0 }, new Date()) }))
    .sort((a, b) => a.gap - b.gap);
  const results = scopeIds ? allResults.filter((w) => inScopeRecord(w.orgAncestors, scopeIds)) : allResults;
  const hidden = allResults.length - results.length;
  const ctl = useList({
    rows: results,
    searchKeys: ["id", "titleNe", "titleEn"],
    filters: [],
    sortOptions: [
      { value: "gap", label: "Gap", get: (r) => r.gap },
      { value: "expected", label: tx("अपेक्षित", "Expected", lang), get: (r) => r.expected },
      { value: "physical", label: tx("भौतिक", "Physical", lang), get: (r) => r.physical },
    ],
  });
  const loading = worksQ.loading || expsQ.loading;
  const error = worksQ.error || expsQ.error;
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-black">{tx("प्रगति मापन", "Measuring progress", lang)}</h1>
      <p className="text-[13px] text-slate-600">
        {tx(
          "WMAMS ले हरेक कार्यबारे तीन प्रश्न सोध्छ। अहिलेसम्म कहाँ हुनुपर्ने? (समय)। वास्तवमा कहाँ छ? (सम्पन्न कार्य)। कति पैसा गयो? (खर्च)। पहिलो दुईबीचको अन्तरले ढिलो हो/होइन बताउँछ। चरणगत भुक्तानीमा मात्र खर्च तुलना गरिन्छ।",
          "WMAMS asks three separate questions about every work. Where should it be by now? (time). Where is it really? (work done). How much money has gone out? (spending). The gap between the first two tells you whether the work is late. Spending is only compared when the work is paid in stages.",
          lang
        )}
      </p>
      <Card title={tx("परिणाम — हरेक कार्यको गणना गरिएको अपेक्षित / भौतिक / वित्तीय", "Results — calculated Expected / Physical / Financial per work", lang)}>
        {loading ? <Loading lang={lang} /> : error ? <Loading error={error} lang={lang} /> : <>
        <div className="no-print mb-2 flex flex-wrap items-center gap-2 text-[11px] font-bold">
          <button onClick={() => setScoped((s) => !s)} className={`rounded-full border px-2.5 py-1 ${scoped ? "bg-nepal-blue text-white" : "bg-white text-slate-600"}`}>
            {tx("स्कोप: मेरो एकाइ + मातहत", "Scope: my unit + below", lang)} ({user?.unit || ""})
          </button>
          {scoped && hidden > 0 && <span className="text-slate-500">{hidden} {tx("बाहिर", "outside", lang)}</span>}
        </div>
        <Table cols={[tx("कार्य", "Work", lang), `${tx("अपेक्षित", "Expected", lang)} / ${tx("भौतिक", "Physical", lang)} / ${tx("वित्तीय", "Financial", lang)} (100% बार)`, tx("स्वास्थ्य", "Health", lang)]}
          rows={ctl.pageRows.map((w) => [
            <Link key={w.id} href={`/works/${w.id}`} className="font-bold text-nepal-blue">{lang === "ne" ? w.titleNe : w.titleEn} <span className="font-mono font-normal text-slate-400">{w.id}</span></Link>,
            <div key={`${w.id}-bars`} className="flex min-w-52 items-center gap-2">
              <div className="min-w-0 flex-1"><Bars expected={w.expected} physical={w.physical} financial={w.financial} financialDisplay={w.financialDisplay} lang={lang} /></div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-black ${w.gap < 0 ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}>{w.gap} {w.gap < 0 ? tx("पछाडि", "behind", lang) : tx("अगाडि", "ahead", lang)}</span>
            </div>,
            <HealthChip key={`${w.id}-h`} health={w.health} lang={lang} />,
          ])} />
        </>}
      </Card>
      <EnginePanel lang={lang} />
    </div>
  );
}
