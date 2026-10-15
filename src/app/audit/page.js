"use client";
import { useApp } from "@/lib/store";
import { t, tx } from "@/lib/i18n";
import { Card, Table } from "@/components/ui";
import { useList, ListToolbar, Pager, exportCsv } from "@/components/list";
import { useCollection, Loading } from "@/lib/use-data";

export default function Audit() {
  const { lang } = useApp();
  const { data, loading, error } = useCollection("auditlogs");
  const rows = data.map((r) => ({ at: r.at, actor: r.actor, action: r.action, entity: r.entity }));
  const ctl = useList({
    rows,
    searchKeys: ["actor", "action", "entity"],
    filters: [{ key: "action", label: tx("कार्य", "Action", lang), options: [...new Set(rows.map((r) => r.action))].map((a) => ({ value: a, label: a })) }],
    sortOptions: [{ value: "at", label: tx("समय", "At", lang), get: (r) => r.at }],
  });
  return (<div className="space-y-3"><h1 className="text-xl font-black">{t("auditTitle", lang)}</h1>
  <Card title={tx("कसले के कहिले — कहिल्यै सम्पादन हुँदैन", "Who did what, when — never edited", lang)}>
    {loading ? <Loading lang={lang} /> : error ? <Loading error={error} lang={lang} /> : <>
    <ListToolbar ctl={ctl} lang={lang} filters={[]} sortOptions={[{ value: "at", label: tx("समय", "At", lang) }]}
      onExport={() => exportCsv("audit", ["At", "Actor", "Action", "Entity"], ctl.pageRows.map((r) => [r.at, r.actor, r.action, r.entity]))} />
    <div className="mt-2">
    <Table cols={[tx("समय", "At", lang), tx("कर्ता", "Actor", lang), tx("कार्य", "Action", lang), tx("वस्तु", "Entity", lang)]}
      rows={ctl.pageRows.map((r) => [r.at, r.actor, r.action, r.entity])} />
    </div>
    <Pager ctl={ctl} lang={lang} />
    {rows.length === 0 && <p className="mt-1 text-xs text-slate-400">{tx("अडिट प्रविष्टि कार्यबाट बन्छ (जस्तै: कार्य प्रगति पेश)", "Entries are written by actions (e.g. submit task progress)", lang)}</p>}
    </>}
  </Card></div>);
}
