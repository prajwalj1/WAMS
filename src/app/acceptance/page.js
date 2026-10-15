"use client";
import { useMemo, useState } from "react";
import { useApp } from "@/lib/store";
import { tx } from "@/lib/i18n";
import { Card, Table } from "@/components/ui";
import { runAcceptance } from "@/lib/rules";

export default function Acceptance() {
  const { lang } = useApp();
  const [filter, setFilter] = useState("ALL");
  const results = useMemo(() => runAcceptance(), []);
  const pass = results.filter((r) => r.pass).length;
  const shown = results.filter((r) => filter === "ALL" || r.id.startsWith(filter));
  const mods = ["ALL", "ORG", "ACC", "WRK", "ACT", "PRG", "TIP", "BUD", "PRC", "MSR", "APR", "ISS", "DOC", "ADM"];
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-gradient-to-r from-nepal-blue to-sky-700 p-4 text-white">
        <h1 className="text-xl font-black">{tx("स्वीकृति परीक्षण — §9 QA चेकलिस्ट", "Acceptance tests — §9 QA checklist", lang)}</h1>
        <p className="text-[13px] opacity-90">{tx(`प्रत्येक requirement ID लाइभ चल्छ · ${pass}/${results.length} पास`, `Every requirement ID runs live · ${pass}/${results.length} pass`, lang)}</p>
        <div className="no-print mt-2 flex flex-wrap gap-1.5">
          {mods.map((m) => <button key={m} onClick={() => setFilter(m)} className={`rounded-lg px-2.5 py-1 text-xs font-bold ${filter === m ? "bg-white text-nepal-blue" : "bg-white/20"}`}>{m}</button>)}
        </div>
      </div>
      <Card title={`${tx("परिणाम", "Results", lang)} — ${pass}/${results.length} ✅`}>
        <Table cols={[tx("आईडी", "ID", lang), tx("आवश्यकता", "Requirement", lang), tx("स्थिति", "Status", lang), tx("प्रमाण", "Evidence", lang)]}
          rows={shown.map((r) => [r.id, r.req, r.pass ? "✅ PASS" : `❌ FAIL`, r.detail])} />
        <p className="mt-2 text-xs text-slate-500">{tx("नियम src/lib/rules.js मा — UI फारम र भविष्यको API ले एउटै कोड प्रयोग गर्छन्। त्रुटि सन्देश प्रयोगकर्ताको भाषामा देखिन्छ।", "Rules live in src/lib/rules.js — UI forms and the future API share the same codes. Error text shows in the user's language.", lang)}</p>
      </Card>
    </div>
  );
}
