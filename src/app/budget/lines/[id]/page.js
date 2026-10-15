"use client";
import { use } from "react";
import Link from "next/link";
import { useApp } from "@/lib/store";
import { tx } from "@/lib/i18n";
import { Card, Table, Stat } from "@/components/ui";
import { useCollection, Loading } from "@/lib/use-data";
import { spentVerified, utilisation } from "@/lib/metrics";

export default function BudgetLine({ params }) {
  const { lang } = useApp();
  const { id } = use(params);
  const budget = useCollection("budget");
  const worksQ = useCollection("works");
  const expsQ = useCollection("expenditures");
  const BUDGET = budget.data, WORKS = worksQ.data, EXPENDITURES = expsQ.data;
  const loading = budget.loading || worksQ.loading || expsQ.loading;
  const error = budget.error || worksQ.error || expsQ.error;
  const line = BUDGET.find((b) => b.subhead === id);
  const linked = line ? WORKS.filter((w) => w.subhead === line.subhead) : [];
  const exps = line ? EXPENDITURES.filter((e) => linked.some((w) => w.id === e.work)) : [];
  if (loading) return <div className="space-y-3"><Card title="…"><Loading lang={lang} /></Card></div>;
  if (error || !line) return <div className="space-y-3"><Card title="…"><Loading error={error || "NOT_FOUND"} lang={lang} /></Card></div>;
  // Spent = verified expenditures only — live, never the stored snapshot.
  const spent = spentVerified(exps);
  const revised = Number(line.revised) || 0;
  const avail = revised - (Number(line.committed) || 0) - spent;
  return (
    <div className="space-y-3">
      <Link href="/budget" className="text-xs font-bold text-nepal-blue">← {tx("बजेट", "Budget", lang)}</Link>
      <h1 className="text-xl font-black">{line.subhead} · {line.name}</h1>
      <p className="mt-1 text-xs text-slate-500">{tx("आ.व.", "FY", lang)} {line.fiscalYear || "—"} · {tx("स्रोत", "Source", lang)} {line.fundingSource || "—"}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label={tx("विनियोजित", "Allocated", lang)} value={(Number(line.allocated) || 0).toLocaleString("en-IN")} />
        <Stat label={tx("संशोधित", "Revised", lang)} value={revised.toLocaleString("en-IN")} />
        <Stat label={tx("प्रतिबद्ध", "Committed", lang)} value={(Number(line.committed) || 0).toLocaleString("en-IN")} />
        <Stat label={tx("खर्च", "Spent", lang)} value={spent.toLocaleString("en-IN")} />
        <Stat label={tx("बाँकी", "Available", lang)} value={avail.toLocaleString("en-IN")} accent="border-emerald-500" />
        <Stat label={tx("उपयोग %", "Util %", lang)} value={`${Math.round(utilisation(spent, revised))}%`} accent="border-nepal-gold" />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title={tx("लिङ्क्ड कार्य", "Linked works", lang)}>
          {linked.map((w) => <div key={w.id} className="border-b py-1.5 text-sm last:border-0"><Link href={`/works/${w.id}`} className="font-bold text-nepal-blue">{w.id}</Link> · {lang === "ne" ? w.titleNe : w.titleEn}</div>)}
        </Card>
        <Card title={tx("प्रतिबद्धता र खर्च", "Commitments & expenditures", lang)} action={<Link href="/expenditures" className="text-xs font-bold text-nepal-blue">{tx("सबै", "All", lang)} →</Link>}>
          <Table cols={[tx("भौचर", "Voucher", lang), tx("रकम", "Net", lang), tx("स्थिति", "Status", lang)]} rows={exps.map((e) => [e.voucher, Number(e.net).toLocaleString("en-IN"), e.status])} />
        </Card>
      </div>
      <Card title={tx("संशोधन", "Revisions", lang)} action={<Link href="/budget/revisions" className="text-xs font-bold text-nepal-blue">{tx("सबै", "All", lang)} →</Link>}>
        <p className="text-[13px] text-slate-500">{tx("रकमान्तर अनुरोध र स्वीकृति — पहिले स्वीकृति, अनि खर्च।", "Transfer requests and approvals — approval first, then spend.", lang)}</p>
      </Card>
    </div>
  );
}
