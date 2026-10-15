"use client";
import { use } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useApp } from "@/lib/store";
import { tx } from "@/lib/i18n";
import { Card, Table } from "@/components/ui";
import { useCollection, Loading } from "@/lib/use-data";

export default function UnitDetail({ params }) {
  const { lang, perms, ready } = useApp();
  const { id } = use(params);
  const units = useCollection("units");
  const worksQ = useCollection("works");
  const budgetQ = useCollection("budget");
  const usersQ = useCollection("users");
  const UNITS = units.data, WORKS = worksQ.data, BUDGET = budgetQ.data;
  const loading = units.loading || worksQ.loading || budgetQ.loading || usersQ.loading;
  const error = units.error || worksQ.error || budgetQ.error || usersQ.error;
  const u = UNITS.find((x) => x.id === id);
  const works = u ? WORKS.filter((w) => w.orgUnitId === u.id || w.unit === u.nameEn || w.unit === u.nameNe) : [];
  const lines = u ? BUDGET.filter((b) => b.orgUnitId === u.id || (b.orgAncestors || []).includes(u.id)) : [];
  const members = u ? usersQ.data.filter((x) => x.unitId === u.id) : [];
  // Same PMO-only gate as /org: ministry roles see Page Not Found here.
  if (ready && !(perms || []).includes("org.unit.manage")) notFound();
  if (loading) return <div className="space-y-3"><Card title="…"><Loading lang={lang} /></Card></div>;
  if (error || !u) return <div className="space-y-3"><Card title="…"><Loading error={error || "NOT_FOUND"} lang={lang} /></Card></div>;
  return (
    <div className="space-y-3">
      <Link href="/org" className="text-xs font-bold text-nepal-blue">← {tx("संगठन", "Organisation", lang)}</Link>
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <h1 className="text-lg font-black">{lang === "ne" ? u.nameNe : u.nameEn} <span className="font-mono text-xs text-slate-400">{u.code}</span></h1>
        <p className="text-xs text-slate-500">{u.type} · {tx("बजेट मोड", "Budget mode", lang)} {u.mode} · {tx("प्रमुख", "Head", lang)} {u.head}</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title={tx("प्रयोगकर्ता", "Users", lang)} action={<Link href="/users" className="text-xs font-bold text-nepal-blue">{tx("सबै", "All", lang)} →</Link>}>
          {members.length === 0 ? <p className="text-sm text-slate-400">—</p> : (
            <Table cols={[tx("नाम", "Name", lang), tx("भूमिका", "Role", lang)]} rows={members.map((m) => [<Link key={m.username} href={`/users/${m.username}`} className="font-bold text-nepal-blue">{m.username}</Link>, m.role])} />
          )}
        </Card>
        <Card title={tx("कार्य सारांश", "Works summary", lang)} action={<Link href="/works" className="text-xs font-bold text-nepal-blue">{tx("सबै", "All", lang)} →</Link>}>
          {works.length === 0 ? <p className="text-sm text-slate-400">{tx("कुनै कार्य छैन", "No works", lang)}</p> :
            works.map((w) => <div key={w.id} className="border-b py-1.5 text-sm last:border-0"><Link href={`/works/${w.id}`} className="font-bold text-nepal-blue">{lang === "ne" ? w.titleNe : w.titleEn}</Link> · {w.status}</div>)}
        </Card>
      </div>
      <Card title={tx("बजेट मोड र लाइन", "Budget mode & lines", lang)}>
        {lines.length === 0 ? <p className="text-sm text-slate-400">—</p> : (
          <Table cols={["Sub-head", tx("नाम", "Name", lang), tx("उपलब्ध", "Available", lang)]} rows={lines.map((b) => [b.subhead, b.name, ((Number(b.revised) || 0) - (Number(b.spent) || 0)).toLocaleString("en-IN")])} />
        )}
      </Card>
    </div>
  );
}
