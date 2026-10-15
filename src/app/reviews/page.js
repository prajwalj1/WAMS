"use client";
import Link from "next/link";
import { useApp } from "@/lib/store";
import { t, tx } from "@/lib/i18n";
import { Card, Table, StatusChip } from "@/components/ui";
import { useCollection, Loading } from "@/lib/use-data";
import TransitionBox from "@/components/transitions";
import { mutate } from "@/lib/mutate";

// COMPLETION route (lib/lifecycle COMPLETION): verifier is UNIT_HEAD or
// APPROVER — never the submitter. Everyone else gets a read-only queue.
const VERIFIER_ROLES = ["UNIT_HEAD", "APPROVER"];

export default function Reviews() {
  const { lang, toast, role, user } = useApp();
  const tasks = useCollection("tasks");
  const works = useCollection("works");
  const loading = tasks.loading || works.loading;
  const error = tasks.error || works.error;
  const canVerify = VERIFIER_ROLES.includes(role);
  // Actually submitted completions — the only rows a verifier can act on.
  const submitted = works.data.filter((w) => w.status === "COMPLETION_SUBMITTED");
  // At 100% but not submitted: owner action still pending (completion report
  // + submit), so no verify buttons here — listing only, no dead actions.
  const awaitingOwner = works.data.filter((w) => w.status === "ONGOING" && (w.physical ?? 0) >= 100);
  // In-progress tasks: there is no confirm API (progressUpdate confirmation
  // is local-only everywhere), so this queue links to the task detail where
  // the activity log lives — instead of placebo Confirm buttons.
  const pendingUpdates = tasks.data.filter((x) => x.status === "IN_PROGRESS");
  const setWorkStatus = async (w, next) => {
    await mutate("/api/data/works", { method: "PATCH",
      body: { match: { id: w.id }, update: { status: next }, __v: w.__v ?? 1 },
      okMsg: `${w.id} → ${next}`,
      toast, reload: works.reload });
  };
  const empty = (s) => <p className="py-1 text-[13px] text-slate-400">{s}</p>;
  return (<div className="space-y-3"><h1 className="text-xl font-black">{t("reviewsTitle", lang)}</h1>
  <Card title={tx("प्रमाणित गर्न बाँकी सम्पन्नता", "Completions to verify", lang)}>
  {loading ? <Loading lang={lang} /> : error ? <Loading error={error} lang={lang} /> : (<>
    {submitted.length === 0 && empty(tx("बाँकी सम्पन्नता छैन", "No completions waiting", lang))}
    {submitted.length > 0 && (
    <Table cols={[tx("वस्तु", "Item", lang), tx("द्वारा", "By", lang), tx("स्थिति", "Status", lang), tx("कार्य", "Action", lang)]}
      rows={submitted.map((w) => {
        const selfSubmitted = !!(w.owner && user?.username && w.owner === user.username);
        return [`${w.id} completion`, w.owner, <StatusChip key={w.id} status={w.status} lang={lang} />,
          <div key={w.id + "a"} className="max-w-60">
            {!canVerify
              ? <span className="text-xs text-slate-400">{tx("UNIT_HEAD / APPROVER कार्य", "UNIT_HEAD / APPROVER action", lang)}</span>
              : selfSubmitted
                ? <span className="text-xs text-slate-400">{tx("तपाईंले पेश गर्नुभयो — अर्को प्रमाणिकरणकर्ता आवश्यक", "You submitted this — another verifier must act", lang)}</span>
                : <TransitionBox recordType="work" status={w.status} lang={lang} allow={["verify", "return"]}
                    extraCtx={{ actor: user?.username || "", submitter: w.owner }}
                    onStatus={(next) => setWorkStatus(w, next)} />}
          </div>];
      })} />)}
    {awaitingOwner.length > 0 && (
      <div className="mt-2 border-t pt-2 text-[13px]">
        <div className="mb-1 text-xs font-bold text-slate-500">{tx("१००% तर पेश बाँकी (स्वामित्व कार्य)", "At 100% but not submitted (owner action)", lang)}</div>
        {awaitingOwner.map((w) => <div key={w.id} className="border-b py-1 text-slate-600 last:border-0"><b>{w.id}</b> · {w.owner || "—"} · {tx("सम्पन्न प्रतिवेदनसहित पेश गर्न बाँकी", "yet to submit with completion report", lang)}</div>)}
      </div>)}
  </>)}
  </Card>
  <Card title={tx("सदर गर्न बाँकी अपडेट", "Updates to review", lang)}>
  {loading ? <Loading lang={lang} /> : error ? <Loading error={error} lang={lang} /> : (<>
    {pendingUpdates.length === 0 && empty(tx("बाँकी अपडेट छैन", "No updates waiting", lang))}
    {pendingUpdates.length > 0 && (
    <Table cols={[tx("वस्तु", "Item", lang), tx("द्वारा", "By", lang), tx("भौतिक", "Physical", lang), tx("समीक्षा", "Review", lang)]}
      rows={pendingUpdates.map((x) => [`${x.workId}/${x.ref} — ${x.physical}%`, x.owner, `${x.physical ?? 0}%`,
        <Link key={x.ref} href={`/tasks/${encodeURIComponent(x.ref)}`} className="font-bold text-nepal-blue">{tx("कार्य खोल्नुहोस्", "Open task", lang)} →</Link>])} />)}
  </>)}
  </Card></div>);
}
