"use client";
import Link from "next/link";
import { useState } from "react";
import { useApp } from "@/lib/store";
import { t, tx } from "@/lib/i18n";
import { Card, Table, StatusChip, Stat } from "@/components/ui";
import { useCollection, Loading } from "@/lib/use-data";
import { workingDaysBetween } from "@/lib/metrics";
import { kathmanduDayKey } from "@/lib/progress";

export default function MyWork() {
  const { lang, user } = useApp();
  // Unit-scoped fetch: without ?scope= the data API returns every unit's
  // rows, which is why staff saw other units' work (or a confusing mix).
  const scopeIds = user?.scopeUnitIds?.length ? user.scopeUnitIds : user?.unitId ? [user.unitId] : [];
  const scopeParam = scopeIds.join(",");
  const tasks = useCollection("tasks", scopeParam ? { scope: scopeParam } : {});
  const tippanis = useCollection("tippanis", scopeParam ? { scope: scopeParam } : {});
  const dirs = useCollection("directives", scopeParam ? { scope: scopeParam } : {});
  const auditsQ = useCollection("auditlogs");
  // "My" = assigned to me (owner or assignee) or in my own unit. When the
  // profile carries no unit yet, fall back to the scoped rows so the page
  // never goes blank for a logged-in user.
  const inMyUnit = (r) => !user?.unitId || r.orgUnitId === user.unitId;
  const assignedToMe = (t) => {
    const me = [user?.username, user?.nameEn, user?.name].filter(Boolean).map((s) => String(s).toLowerCase());
    if (me.includes(String(t.owner || "").toLowerCase())) return true;
    return (t.assignees || []).some((a) => me.includes(String(a?.name || a?.mobile || a || "").toLowerCase()));
  };
  const TASKS = tasks.data.filter((t) => assignedToMe(t) || inMyUnit(t));
  const TIPPANIS = tippanis.data.filter((t) => inMyUnit(t));
  const DIRECTIVES = dirs.data.filter((d) => inMyUnit(d));
  const loading = tasks.loading || tippanis.loading || dirs.loading || auditsQ.loading;
  const error = tasks.error || tippanis.error || dirs.error || auditsQ.error;
  const todayStr = kathmanduDayKey(new Date());
  const [weekStr] = useState(() => kathmanduDayKey(new Date(Date.now() + 7 * 86400000)));
  const overdue = TASKS.filter((x) => !["DONE", "CANCELLED"].includes(x.status) && x.deadline && x.deadline < todayStr);
  const dueWeek = TASKS.filter((x) => !["DONE", "CANCELLED"].includes(x.status) && x.deadline && x.deadline >= todayStr && x.deadline <= weekStr);
  const myAudits = (auditsQ.data || []).filter((a) => a.actor === user?.username).slice(-3).reverse();
  const updatesDue = TASKS.filter((x) => x.status === "IN_PROGRESS");
  const returned = TIPPANIS.filter((x) => x.status === "RETURNED");
  const waiting = TIPPANIS.filter((x) => x.status === "IN_REVIEW");
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-black">{t("myWorkTitle", lang)} · {user.nameEn} · {user.unit || user.unitId || ""}</h1>
      <div className="no-print flex flex-wrap gap-2 text-[12px] font-semibold">
        <Link href="/documents" className="rounded-lg bg-nepal-blue px-3 py-1.5 text-white">{tx("TOR अपलोड", "Upload TOR", lang)}</Link>
        <Link href="/tippani/new?subject=BUDGET_APPROVAL" className="rounded-lg bg-nepal-crimson px-3 py-1.5 text-white">{tx("इ-टिप्पणी ड्राफ्ट", "Draft e-Tippani", lang)}</Link>
      </div>
      {loading ? <Card title="…"><Loading lang={lang} /></Card> : error ? <Card title="…"><Loading error={error} lang={lang} /></Card> : <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label={tx("यस हप्ता बाँकी", "Due this week", lang)} value={dueWeek.length} />
        <Stat label={tx("म्याद नाघेका", "Overdue", lang)} value={overdue.length} accent="border-nepal-crimson" />
        <Stat label={tx("अपडेट बाँकी", "Updates due", lang)} value={updatesDue.length} accent="border-amber-500" />
        <Stat label={tx("फिर्ता", "Returned to me", lang)} value={returned.length} accent="border-amber-500" />
        <Stat label={tx("प्रतीक्षा टिप्पणी", "Tippani waiting", lang)} value={waiting.length} />
        <Stat label={tx("निर्देशन", "Directives", lang)} value={DIRECTIVES.length} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title={tx("यस हप्ता बाँकी कार्य", "Tasks due this week", lang)}>
          <Table cols={[tx("रेफ", "Ref", lang), tx("शीर्षक", "Title", lang), tx("म्याद", "Deadline", lang), tx("स्थिति", "Status", lang)]}
            rows={[...dueWeek, ...overdue].map((x) => [<Link key={x.ref} href={`/tasks/${x.ref}`} className="font-bold text-nepal-blue">{x.ref}</Link>, lang === "ne" ? x.title : x.titleEn, <span key={x.ref} className={overdue.includes(x) ? "font-bold text-red-600" : ""}>{x.deadline}</span>, <StatusChip key={x.ref + "s"} status={x.status} lang={lang} />])} />
        </Card>
        <Card title={tx("अपडेट बाँकी", "Updates due", lang)} action={<Link href="/reviews" className="text-xs font-bold text-nepal-blue">{tx("समीक्षा", "Reviews", lang)} →</Link>}>
          {updatesDue.map((x) => <div key={x.ref} className="border-b py-1.5 text-sm last:border-0"><Link href={`/tasks/${x.ref}`} className="font-bold text-nepal-blue">{x.ref}</Link> · {x.physical}% · {x.owner}</div>)}
        </Card>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <Card title={tx("मलाई फिर्ता", "Returned to me", lang)}>
          {returned.length === 0 ? <p className="text-[13px] text-slate-400">{tx("फिर्ता केही छैन", "Nothing returned", lang)}</p> :
            returned.map((x) => <div key={x.ref} className="text-sm"><Link href={`/tippani/${x.ref}`} className="font-bold text-nepal-blue">{x.ref}</Link> · {x.subject}</div>)}
        </Card>
        <Card title={tx("मलाई प्रतीक्षा टिप्पणी", "Tippani waiting for me", lang)}>
          {waiting.map((x) => <div key={x.ref} className="border-b py-1.5 text-sm last:border-0"><Link href={`/tippani/${x.ref}`} className="font-bold text-nepal-blue">{x.ref}</Link> · {x.subject}<div className="text-xs text-slate-500">{x.step} · {x.stepSince ? workingDaysBetween(x.stepSince, todayStr) : (Number(x.waitDays) || 0)}d</div></div>)}
        </Card>
        <Card title={tx("तोकिएका निर्देशन + हालको गतिविधि", "Directives assigned + my recent activity", lang)}>
          {DIRECTIVES.map((d) => <div key={d.id} className="py-1 text-sm"><b>{d.id}</b> · {d.text}</div>)}
          {myAudits.length > 0 && (
            <div className="mt-1 border-t pt-1 text-xs text-slate-500">
              {myAudits.map((a, i) => <div key={i}>{a.at} · {a.action} · {a.entity}</div>)}
            </div>
          )}
        </Card>
      </div>
      </>}
    </div>
  );
}
