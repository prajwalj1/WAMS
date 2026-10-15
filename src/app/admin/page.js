"use client";
import Link from "next/link";
import { useApp } from "@/lib/store";
import { t, tx } from "@/lib/i18n";
import { Card } from "@/components/ui";

export default function Admin() {
  const { lang } = useApp();
  return (<div className="space-y-3"><h1 className="text-xl font-black">{t("adminTitle", lang)}</h1>
  <Card title={tx("सेटिङ खण्डहरू (/admin/*)", "Settings sections (/admin/*)", lang)}>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {["fiscal-years", "holidays", "work-types", "templates", "procurement-methods", "expense-heads", "document-types", "thresholds", "system"].map((s) => (
        <Link key={s} href={`/admin/${s}`} className="rounded-lg border p-2.5 text-[13px] font-bold hover:border-nepal-blue">
          <span className="font-mono text-[11px] text-slate-400">/admin/{s}</span><div>{s}</div>
        </Link>
      ))}
    </div>
  </Card>
  </div>);
}
