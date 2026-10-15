"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useApp, useWorkflow } from "@/lib/store";
import { tx } from "@/lib/i18n";
import { Card } from "@/components/ui";
import { RoutePreview } from "@/components/ui";
import { Field, ServerErrors, ErrorSummary, useForm, vRequired } from "@/components/forms";
import { useCollection, Loading } from "@/lib/use-data";
import { matchApprovalRoute } from "@/lib/lifecycle";
import { ancestorsOfUnit } from "@/lib/scope";
import { kathmanduDayKey } from "@/lib/progress";
import { mutate } from "@/lib/mutate";
import { useFiscalYears } from "@/lib/fiscal";

const STEPS = ["details", "budget", "tasks", "review"];
const TEMPLATES = { none: [], standard: [{ ref: "T1", title: "तयारी", weight: 20 }, { ref: "T2", title: "कार्यान्वयन", weight: 60 }, { ref: "T3", title: "समापन", weight: 20 }] };

export default function WorkNew() {
  const { lang, user, role, perms, toast } = useApp();
  // Works are determined by the industry side only — without work.create
  // this wizard never opens (monitor-only roles get a notice, and the API
  // refuses their POSTs regardless).
  const canCreateWork = (perms || []).includes("*") || (perms || []).includes("work.create");
  const { routes } = useWorkflow();
  const units = useCollection("units");
  const budgetQ = useCollection("budget");
  const worksQ = useCollection("works");
  const usersQ = useCollection("users");
  // De-duplicated by id — the collection may hold repeat-seeded rows.
  const UNITS = [...new Map((units.data || []).map((u) => [u.id ?? u._id, u])).values()];
  const BUDGET = budgetQ.data;
  const todayStr = kathmanduDayKey(new Date());
  const nextYearStr = kathmanduDayKey(new Date(Date.now() + 365 * 86400000));
  // FY options resolve live (admin fiscal-years config + FYs already used) —
  // never empty, even with zero works in the database.
  const fys = useFiscalYears(worksQ.data);
  const [step, setStep] = useState(0);
  const [tasks, setTasks] = useState(TEMPLATES.standard);
  const [done, setDone] = useState(null);
  const f = useForm({ titleNe: "", unitId: "", fy: "", start: todayStr, end: nextYearStr, subhead: "", amount: "", owner: "" }, {
    titleNe: vRequired, unitId: vRequired, fy: vRequired,
  });
  // Owner unit defaults to the CREATOR's own unit (never the first unit in
  // the database — that silently filed works under another unit where the
  // creator's scoped list could never show them). Staff are locked to
  // their own unit; other roles may pick any unit.
  const isStaffCreator = role === "STAFF";
  const ownUnitId = user?.unitId || "";
  const unitVal = isStaffCreator ? ownUnitId : (f.values.unitId || ownUnitId || UNITS[0]?.id || "");
  // Assignable owners: accounts visible to the creator (server filters by
  // role), defaulting to self. Departments/mahashakhas assign work this way.
  const OWNER_USERS = usersQ.data || [];
  const ownerVal = f.values.owner || user?.username || "";
  const fyVal = f.values.fy || fys[0] || "";
  const subheadVal = f.values.subhead || BUDGET[0]?.subhead || "";
  const weights = tasks.map((t) => t.weight);
  const line = BUDGET.find((b) => b.subhead === subheadVal);
  const available = line ? (Number(line.revised) || 0) - (Number(line.committed) || 0) - (Number(line.spent) || 0) : 0;
  const unit = UNITS.find((u) => u.id === unitVal);
  const mode = unit?.mode === "OWN" ? "OWN" : "MINISTRY";
  let preview = null;
  try {
    if (mode === "MINISTRY" && f.values.amount > 0)
      preview = matchApprovalRoute({ subject: "BUDGET_APPROVAL", mode, amountNpr: Number(f.values.amount) }, routes);
  } catch { preview = null; }

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));
  // Displayed dropdown defaults (first unit / FY) must also live in form
  // state — otherwise validation fails with unitId/fy Required even though
  // a value is visibly selected.
  useEffect(() => {
    if (!f.values.unitId && unitVal) f.set("unitId")(unitVal);
    if (!f.values.fy && fyVal) f.set("fy")(fyVal);
    if (!f.values.owner && ownerVal) f.set("owner")(ownerVal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitVal, fyVal, ownerVal]);

  const submit = async () => {
    // No owner unit (e.g. staff profile without a unit) would file an
    // orphaned work no scoped list can show — stop with a clear message.
    if (!unitVal) { toast(tx("तपाईंको खातामा एकाइ छैन — PMO लाई एकाइ सेट गर्न लगाउनुहोस्।", "Your account has no unit — ask PMO to set your unit first.", lang), "err"); return; }
    const r = await f.submit("work-new", {
      weights, amountPaisa: Number(f.values.amount) * 100, availablePaisa: available * 100,
      end: f.values.end, parentEnd: f.values.end,
    });
    if (!r.ok) return;
    // Work id derives live: FY tag from the chosen FY + max existing sequence + 1.
    const fyTag = (fyVal.split("/")[0] || new Date().getFullYear()).toString().replace(/\D/g, "").slice(-4) || "2083";
    const maxSeq = worksQ.data.reduce((a, w) => {
      const m = String(w.id || "").match(new RegExp(`^W-${fyTag}-(\\d+)$`));
      return m ? Math.max(a, Number(m[1])) : a;
    }, 0);
    const id = `W-${fyTag}-${String(maxSeq + 1).padStart(3, "0")}`;
    const chain = ancestorsOfUnit(unitVal, UNITS);
    const ancestors = chain.length > 1 ? chain : [unitVal];
    const created = await mutate("/api/data/works", { method: "POST",
      body: { doc: { id, titleNe: f.values.titleNe, titleEn: f.values.titleNe, unit: unit?.nameEn || user?.unit || "", fy: fyVal, status: "DRAFT", startDate: f.values.start, deadline: f.values.end, physical: 0, spentPaisa: 0, contractPaisa: 0, budgetPaisa: Number(f.values.amount), owner: ownerVal, subhead: subheadVal, orgUnitId: unitVal, orgAncestors: ancestors, orgPath: ancestors.join(".") } },
      toast });
    if (created.ok) {
      for (const t of tasks) {
        await mutate("/api/data/tasks", { method: "POST",
          body: { doc: { ref: `${id}-${t.ref}`, workId: id, title: t.title, titleEn: t.title, weight: Number(t.weight), physical: 0, owner: ownerVal, deadline: f.values.end, status: "NOT_STARTED", orgUnitId: unitVal, orgAncestors: ancestors, orgPath: ancestors.join(".") } },
          toast });
      }
      setDone({ id, route: preview?.id || null });
      toast(`${id} · ${tx("कार्य मस्यौदा बन्यो", "Work drafted", lang)}`);
    }
  };

  return (
    <div className="space-y-3">
      <Link href="/works" className="text-xs font-bold text-nepal-blue">← {tx("कार्यहरू", "Works", lang)}</Link>
      <h1 className="text-xl font-black">{tx("नयाँ कार्य", "New work", lang)}</h1>
      {!canCreateWork ? (
        <Card title="⛔"><p className="text-sm font-bold text-red-700">{tx("अनुमति छैन — कार्य उद्योग पक्षले मात्र निर्धारण गर्छ (पढ्नका लागि सूचीमा फर्कनुहोस्)।", "Not authorized — works are determined by the industry side only (back to the list to monitor).", lang)}</p>
          <Link href="/works" className="mt-2 inline-block text-xs font-bold text-nepal-blue">{tx("सूचीमा फर्कनुहोस्", "Back to list", lang)} →</Link></Card>
      ) : (
      <>
      <div className="flex flex-wrap gap-1.5 text-xs font-bold">
        {STEPS.map((s, i) => <span key={s} className={`rounded-full border px-3 py-1 ${i === step ? "bg-nepal-blue text-white" : i < step ? "bg-emerald-100 text-emerald-800" : "bg-white text-slate-500"}`}>{i + 1}. {tx({ details: "विवरण", budget: "बजेट लिङ्क", tasks: "कार्य", review: "समीक्षा र पेश" }[s], { details: "Details", budget: "Budget links", tasks: "Tasks", review: "Review & submit" }[s], lang)}</span>)}
      </div>
      {done ? (
        <Card title="✅"><p className="text-sm font-bold">{done.id} {tx("मस्यौदा बन्यो", "drafted", lang)}{done.route ? ` · BUDGET_APPROVAL → ${done.route}` : ""}</p>
          <Link href="/works" className="text-xs font-bold text-nepal-blue">{tx("सूचीमा फर्कनुहोस्", "Back to list", lang)} →</Link></Card>
      ) : (units.loading || budgetQ.loading) ? (
        <Card title={tx("विजार्ड", "Wizard", lang)}><Loading lang={lang} /></Card>
      ) : (
        <Card title={tx("विजार्ड", "Wizard", lang)}>
          {step === 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={tx("शीर्षक (ने)", "Title (Ne)", lang)} error={f.errors.titleNe} lang={lang} required><input value={f.values.titleNe} onChange={f.set("titleNe")} className="mt-1 w-full rounded-lg border px-3 py-2" /></Field>
              <Field label={tx("स्वामित्व एकाइ", "Owner unit", lang)} lang={lang} required>
                {isStaffCreator ? (
                  <p className="mt-1 rounded-lg bg-slate-100 px-3 py-2 font-bold">{unit?.nameEn || ownUnitId || tx("एकाइ छैन — PMO लाई सम्पर्क गर्नुहोस्", "No unit — contact PMO", lang)}</p>
                ) : (
                <select value={unitVal} onChange={f.set("unitId")} className="mt-1 w-full rounded-lg border px-3 py-2">{UNITS.map((u, i) => <option key={`${u.id ?? u._id}-${i}`} value={u.id}>{u.nameEn} ({u.mode})</option>)}</select>
                )}
              </Field>
              <Field label="FY" lang={lang} required><select value={fyVal} onChange={f.set("fy")} className="mt-1 w-full rounded-lg border px-3 py-2">{fys.map((y) => <option key={y}>{y}</option>)}</select></Field>
              <Field label={tx("जिम्मेवार (असाइन)", "Owner (assign)", lang)} lang={lang}>
                <select value={ownerVal} onChange={f.set("owner")} className="mt-1 w-full rounded-lg border px-3 py-2">
                  {ownerVal && !OWNER_USERS.some((u) => u.username === ownerVal) && <option value={ownerVal}>{ownerVal}</option>}
                  {OWNER_USERS.map((u) => <option key={u.username} value={u.username}>{u.nameEn || u.username} ({u.username}) · {u.role}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={tx("सुरु", "Start", lang)} lang={lang}><input type="date" value={f.values.start} onChange={f.set("start")} className="mt-1 w-full rounded-lg border px-2 py-2" /></Field>
                <Field label={tx("समाप्ति", "End", lang)} lang={lang}><input type="date" value={f.values.end} onChange={f.set("end")} className="mt-1 w-full rounded-lg border px-2 py-2" /></Field>
              </div>
            </div>
          )}
          {step === 1 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={tx("ब.उ.शी.नं.", "Sub-head", lang)} lang={lang}>
                <select value={subheadVal} onChange={f.set("subhead")} className="mt-1 w-full rounded-lg border px-3 py-2">{BUDGET.map((b) => <option key={b.subhead} value={b.subhead}>{b.subhead} — {b.name}</option>)}</select>
              </Field>
              <Field label={tx("रकम (NPR) — उपलब्ध", "Amount (NPR) — available", lang)} lang={lang}>
                <input type="number" value={f.values.amount} onChange={f.set("amount")} className="mt-1 w-full rounded-lg border px-3 py-2" />
                <span className="text-[11px] text-slate-500">{tx("उपलब्ध", "Available", lang)}: {available.toLocaleString("en-IN")}</span>
              </Field>
              {preview && <div className="sm:col-span-2"><RoutePreview route={preview} lang={lang} /></div>}
            </div>
          )}
          {step === 2 && (
            <div>
              <div className="mb-2 flex gap-2 text-xs font-bold">
                <button onClick={() => setTasks(TEMPLATES.standard)} className="rounded-lg border px-2 py-1">{tx("टेम्प्लेट", "Template", lang)}</button>
                <button onClick={() => setTasks((t) => [...t, { ref: `T${t.length + 1}`, title: tx("नयाँ", "New", lang), weight: 0 }])} className="rounded-lg border px-2 py-1">+ Task</button>
                <span className="self-center text-slate-500">Σ = {weights.reduce((a, b) => a + Number(b), 0)} / 100</span>
              </div>
              {tasks.map((t, i) => (
                <div key={i} className="mb-1.5 flex gap-2">
                  <input value={t.title} onChange={(e) => setTasks((p) => p.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} className="min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-sm" />
                  <input type="number" value={t.weight} onChange={(e) => setTasks((p) => p.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)))} className="w-20 rounded-lg border px-2 py-1.5 text-sm" />
                </div>
              ))}
            </div>
          )}
          {step === 3 && (
            <div className="text-sm">
              <ErrorSummary errors={f.errors} lang={lang} />
              <p><b>{f.values.titleNe || "—"}</b> · {unit?.nameEn} · {f.values.start} → {f.values.end}</p>
              <p className="text-slate-500">{tx("बजेट", "Budget", lang)} {f.values.subhead} · NPR {Number(f.values.amount).toLocaleString("en-IN")} · {tx("तौल", "Weights", lang)} Σ={weights.reduce((a, b) => a + Number(b), 0)}</p>
              {preview && <div className="mt-2"><RoutePreview route={preview} lang={lang} /></div>}
              <ServerErrors errors={f.serverErrors} lang={lang} />
            </div>
          )}
          <div className="mt-3 flex gap-2 text-xs font-bold">
            {step > 0 && <button onClick={back} className="rounded-lg border px-4 py-2">← {tx("फर्कनुहोस्", "Back", lang)}</button>}
            {step < 3 && <button onClick={next} className="rounded-lg bg-nepal-blue px-4 py-2 text-white">{tx("अगाडि", "Next", lang)} →</button>}
            {step === 3 && <button onClick={submit} className="rounded-lg bg-emerald-600 px-4 py-2 text-white">{tx("समीक्षा र पेश", "Review & submit", lang)}</button>}
          </div>
        </Card>
      )}
      </>
      )}
    </div>
  );
}
