"use client";
import Link from "next/link";
import { useApp } from "@/lib/store";
import { t, tx } from "@/lib/i18n";
import { Card, Table } from "@/components/ui";
import { useCollection, Loading } from "@/lib/use-data";
import { FALLBACK_REPORTS } from "./[code]/page";

export default function Reports() {
  const { lang } = useApp();
  const { data: REPORT_DEFS, loading, error } = useCollection("reports");
  // DB rows win; fallbacks keep every report linked when the collection is empty.
  const merged = [...FALLBACK_REPORTS.map((f) => ({ ...f, ...((REPORT_DEFS || []).find((r) => r.code === f.code) || {}) })),
    ...((REPORT_DEFS || []).filter((r) => !FALLBACK_REPORTS.some((f) => f.code === r.code)))];
  return (<div className="space-y-3"><h1 className="text-xl font-black">{t("reportsTitle", lang)}</h1>
  <Card title={tx("लाइभ डेटा · PDF + Excel", "Live data · PDF + Excel", lang)}>
  {loading ? <Loading lang={lang} /> : error ? <Loading error={error} lang={lang} /> : (
  <Table cols={[tx("कोड", "Code", lang), tx("रिपोर्ट", "Report", lang), tx("फिल्टर", "Filters", lang)]}
    rows={merged.map((r) => [<Link key={r.code} href={`/reports/${r.code}`} className="font-mono font-bold text-nepal-blue">{r.code}</Link>, lang === "ne" ? r.ne : r.en, (r.filters || []).join(", ")])} />)}
  </Card></div>);
}
