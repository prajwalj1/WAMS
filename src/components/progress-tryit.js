"use client";
import { useMemo, useState } from "react";
import { calcExpected, calcFinancial, healthOf, round2, daysBetween, HEALTH_META } from "@/lib/progress";
import { Card, HealthChip } from "@/components/ui";
import { tx } from "@/lib/i18n";

const PAYMENTS = ["AFTER_COMPLETION", "STAGED", "NONE"];

export default function ProgressTryIt({ lang = "en" }) {
  const [start, setStart] = useState("2026-07-17");
  const [deadline, setDeadline] = useState("2027-05-17");
  const [today, setToday] = useState("2026-12-17");
  const [physical, setPhysical] = useState(30);
  const [payment, setPayment] = useState("AFTER_COMPLETION");
  const [contract, setContract] = useState(5000000);
  const [spent, setSpent] = useState(0);

  const r = useMemo(() => {
    const expectedRaw = calcExpected({ start, deadline, today });
    const expected = round2(expectedRaw);
    const phys = Number(physical) || 0;
    const base = payment === "NONE" ? 0 : Number(contract) || 0;
    const financialRaw = payment === "NONE" ? null : calcFinancial({ spentPaisa: Number(spent) || 0, contractPaisa: base });
    const financial = financialRaw == null ? null : round2(financialRaw);
    const health = healthOf({ expected: expectedRaw, physical: phys, start, deadline, today });
    const gap = round2(phys - expectedRaw);
    const totalDays = daysBetween(start, deadline);
    const elapsedDays = daysBetween(start, today);
    const months = (d) => round2(d / 30.44);
    return { expected, phys, financial, health, gap, totalDays, elapsedDays, monthsTotal: months(totalDays), monthsPassed: months(elapsedDays) };
  }, [start, deadline, today, physical, payment, contract, spent]);

  const meta = HEALTH_META[r.health];
  const num = (v, set, min = 0) => (
    <input type="number" min={min} value={v} onChange={(e) => set(Number(e.target.value))} className="w-full rounded-lg border px-2 py-1.5 text-sm" />
  );
  const date = (v, set) => (
    <input type="date" value={v} onChange={(e) => set(e.target.value)} className="w-full rounded-lg border px-2 py-1.5 text-sm" />
  );

  return (
    <Card title={tx("प्रगति जाँच — Try it", "Check progress — Try it", lang)}>
      <p className="mb-3 text-[13px] text-slate-600">
        {tx(
          "प्रयास गर्नुहोस्। पूर्वनिर्धारित मान आवश्यकताको उदाहरण हो: १०-महिने कार्यमा ५ महिना बित्यो, त्यसैले ५०% अपेक्षित छ।",
          "Try it. The defaults are the example from the requirement: a 10-month work with 5 months gone, so 50% is expected.",
          lang
        )}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2 text-[13px]">
          <label className="block"><span className="mb-0.5 block font-semibold text-slate-600">{tx("सुरु मिति", "Start date", lang)}</span>{date(start, setStart)}</label>
          <label className="block"><span className="mb-0.5 block font-semibold text-slate-600">{tx("समयसीमा", "Deadline", lang)}</span>{date(deadline, setDeadline)}</label>
          <label className="block"><span className="mb-0.5 block font-semibold text-slate-600">{tx("जाँच मिति", "Check progress on", lang)}</span>{date(today, setToday)}</label>
          <label className="block"><span className="mb-0.5 block font-semibold text-slate-600">{tx("भौतिक प्रगति %", "Physical progress %", lang)}</span>{num(physical, setPhysical)}</label>
          <label className="block"><span className="mb-0.5 block font-semibold text-slate-600">{tx("भुक्तानी तरिका", "Payment mode", lang)}</span>
            <select value={payment} onChange={(e) => setPayment(e.target.value)} className="w-full rounded-lg border px-2 py-1.5 text-sm">
              {PAYMENTS.map((p) => <option key={p} value={p}>{p === "AFTER_COMPLETION" ? tx("सम्पन्नपछि", "After completion", lang) : p === "STAGED" ? tx("चरणगत", "Staged", lang) : tx("बजेट छैन", "None (no budget)", lang)}</option>)}
            </select>
          </label>
          {payment !== "NONE" && (
            <>
              <label className="block"><span className="mb-0.5 block font-semibold text-slate-600">{tx("सम्झौता रकम (NPR)", "Contract amount (NPR)", lang)}</span>{num(contract, setContract)}</label>
              <label className="block"><span className="mb-0.5 block font-semibold text-slate-600">{tx("अहिलेसम्म खर्च (NPR)", "Spent so far (NPR)", lang)}</span>{num(spent, setSpent)}</label>
            </>
          )}
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold">{tx("नतिजा", "Result", lang)}</span>
            <HealthChip health={r.health} lang={lang} />
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            {[["Expected", r.expected], ["Physical", r.phys], ["Financial", r.financial]].map(([l, v]) => (
              <div key={l} className="rounded-lg border bg-white p-2">
                <div className="text-[11px] text-slate-500">{l}</div>
                <div className="text-lg font-black">{v == null ? "—" : `${Math.round(v)}%`}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[13px] text-slate-700">
            {tx(
              `${r.monthsPassed} / ${r.monthsTotal} महिना बित्यो, त्यसैले करिब ${Math.round(r.expected)}% हुनुपर्ने। वास्तविक भौतिक प्रगति ${Math.round(r.phys)}% हो, अन्तर ${r.gap} अंक।`,
              `${r.monthsPassed} of ${r.monthsTotal} months have passed, so about ${Math.round(r.expected)}% should be done. Actual physical progress is ${Math.round(r.phys)}%, a gap of ${r.gap} points.`,
              lang
            )}
          </p>
          {r.health === "BEHIND" && (
            <p className="mt-1 text-[13px] font-semibold text-red-700">
              {tx("१५ अंकभन्दा पछाडि। WMAMS ले रातो झण्डा लगाउँछ, एकाइ प्रमुखलाई सूचना दिन्छ र मालिकसँग ढिलाइको कारण माग्छ।", "More than 15 points behind. WMAMS flags it red, alerts the unit head and asks the owner for a delay reason.", lang)}
            </p>
          )}
          {payment !== "STAGED" && (
            <p className="mt-1 text-[13px] text-slate-500">
              {payment === "NONE"
                ? tx("बजेट छैन — वित्तीय प्रगति देखाइँदैन।", "Payment is none, so financial progress is not shown.", lang)
                : tx("भुक्तानी सम्पन्नपछि हुने भएकाले ०% खर्च अपेक्षित हो र प्रगति मूल्यांकनमा प्रयोग हुँदैन।", "Payment is after completion, so 0% spent is expected and is not used to judge progress.", lang)}
            </p>
          )}
          {r.financial != null && r.financial > 100 && (
            <p className="mt-1 text-[13px] font-semibold text-amber-700">100%+ · {tx("भेरिएसन — चेतावनी", "variation — warning", lang)}</p>
          )}
          <p className="mt-1 text-[11px] text-slate-400">{meta?.en} · gap {r.gap} · {tx("आज एसिया/काठमाडौं मिति", "today is Asia/Kathmandu date", lang)}</p>
        </div>
      </div>
    </Card>
  );
}
