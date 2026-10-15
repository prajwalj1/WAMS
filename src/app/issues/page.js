"use client";
import { useApp } from "@/lib/store";
import { t, tx } from "@/lib/i18n";
import { Card, Table, StatusChip } from "@/components/ui";
import TransitionBox from "@/components/transitions";
import { useCollection, Loading } from "@/lib/use-data";
import { mutate } from "@/lib/mutate";
import { DIRECTIVE_APPROVER_ROLES, DIRECTIVE_TOP_OVERRIDE_ROLES } from "@/lib/rules";
export default function Issues() {
  const { lang, toast, role, user } = useApp();
  const issuesQ = useCollection("issues");
  const dirsQ = useCollection("directives");
  const issues = issuesQ.data, dirs = dirsQ.data;
  const loading = issuesQ.loading || dirsQ.loading;
  const error = issuesQ.error || dirsQ.error;
  const setStatus = async (col, match, next, cur, reload) => {
    await mutate(`/api/data/${col}`, { method: "PATCH",
      body: { match, update: { status: next }, __v: cur?.__v ?? 1 },
      okMsg: `${match.id || ""} → ${next}`,
      toast, reload });
  };
  // Every action here needs a top-level role — staff is read-only on both
  // issues and directives (server-enforced).
  const canClose = DIRECTIVE_APPROVER_ROLES.includes(role);
  const canAct = canClose;
  const noActText = tx("यो भूमिकाले कार्य गर्न मिल्दैन", "This role cannot act", lang);
  const canCloseDirective = (d) => canClose
    && (!d.from || d.from === user?.username || DIRECTIVE_TOP_OVERRIDE_ROLES.includes(role));
  return (<div className="space-y-3"><h1 className="text-xl font-black">{t("issuesTitle", lang)}</h1>
  {loading ? <Card title="…"><Loading lang={lang} /></Card> : error ? <Card title="…"><Loading error={error} lang={lang} /></Card> : (
  <div className="grid gap-3 lg:grid-cols-2">
  <Card title={tx("समस्या — खुला → प्रगति → समाधान → बन्द", "Issues — open → progress → resolved → closed", lang)}>
    <Table cols={["ID", tx("कार्य", "Work", lang), tx("विवरण", "Description", lang), tx("स्थिति", "Status", lang), tx("कार्य", "Action", lang)]}
      rows={issues.map((x) => [x.id, x.work, x.text, <StatusChip key={x.id} status={x.status} lang={lang} />,
        <div key={x.id + "a"} className="max-w-52"><TransitionBox recordType="issue" status={x.status} lang={lang}
          allow={canAct ? null : []}
          emptyText={noActText}
          onStatus={(next) => setStatus("issues", { id: x.id }, next, x, issuesQ.reload)} />
          {x.status === "RESOLVED" && !canClose && (
            <p className="mt-1 text-[11px] font-bold text-amber-700">{tx("शीर्ष तहको स्वीकृति बाँकी", "Pending top-level approval", lang)}</p>)}
        </div>])} />
  </Card>
  <Card title={tx("निर्देशन — जारी → स्वीकृत → जवाफ → बन्द", "Directives — issued → ack → responded → closed", lang)}>
    <Table cols={["ID", tx("निर्देशन", "Instruction", lang), tx("म्याद", "Due", lang), tx("स्थिति", "Status", lang), tx("कार्य", "Action", lang)]}
      rows={dirs.map((d) => [d.id, d.text, d.due, <StatusChip key={d.id} status={d.status} lang={lang} />,
        <div key={d.id + "a"} className="max-w-52"><TransitionBox recordType="directive" status={d.status} lang={lang}
          allow={canCloseDirective(d) ? null : canAct ? ["acknowledge", "respond"] : []}
          emptyText={noActText}
          onStatus={(next) => setStatus("directives", { id: d.id }, next, d, dirsQ.reload)} />
          {d.status === "RESPONDED" && !canCloseDirective(d) && (
            <p className="mt-1 text-[11px] font-bold text-amber-700">{tx("शीर्ष तहको स्वीकृति बाँकी", "Pending top-level approval", lang)}</p>)}
        </div>])} />
  </Card>
  </div>)}</div>);
}
