"use client";
import Link from "next/link";
import { useApp } from "@/lib/store";
import { tx } from "@/lib/i18n";
import { Card, Table } from "@/components/ui";

// §20 Requirement coverage — every line of the original requirement mapped to
// what delivers it. Links go to the live screen or test.
const GROUPS = [
  { h: "SuperAdmin: PMO Office", rows: [
    ["Able to add Ministries", "ORG-01", "/org"],
    ["Account creation with roles and permissions", "ACC-01 – ACC-04 · §5", "/users"],
    ["Monitor all activities and work, along with progress", "DSH-01 · MSR-08 · §14 National", "/"],
  ] },
  { h: "Ministry of Industry, Commerce and Supplies", rows: [
    ["Able to add Departments / Mahashakha", "ORG-02", "/org"],
    ["Create accounts with roles and permissions", "ACC-01 · ACC-02 · ACC-03", "/users"],
    ["Departments: independent work with budgets", "ORG-02 · BUD-02 · TIP-06 · §7", "/budget"],
    ["Mahashakha: ministry budgets", "ORG-02 · BUD-02 · TIP-06 · BR-07", "/budget"],
    ["Manage work of Departments and Mahashakha with budgets", "WRK-03 · BUD-03 · BUD-04 · APR-01", "/works"],
    ["Monitor all activities and work, along with progress", "§14 Ministry · NTF-04", "/"],
  ] },
  { h: "Departments and Mahashakha", rows: [
    ["Able to add staff · create accounts", "ORG-03 · ACC-01", "/users"],
    ["Manage the work · add tasks/subtasks", "WRK-02 · WRK-04 · APR-01", "/works/new"],
    ["Monitor all activities and work, along with progress", "§14 Unit", "/"],
  ] },
  { h: "Staff", rows: [
    ["Add tasks/subtasks with work description and TOR", "WRK-04 · WRK-05", "/works"],
    ["Keep activities · updates on the work", "ACT-02 · PRG-01 – PRG-08", "/my-work"],
    ["Progress in quantitative and qualitative terms", "PRG-02 · PRG-07 · MSR-02", "/progress"],
    ["Updates on tender, company selection, agreement and full process", "PRC-01 – PRC-10", "/procurements"],
    ["Progress % calculated from budget expenses", "MSR-03 · MSR-05", "/progress"],
    ["Progress not measured by expenses (payment after completion)", "MSR-04 · WRK-02", "/progress"],
    ["Progress rate example: 5 of 10 months → 50%", "MSR-01 · MSR-06 · §10", "/progress"],
  ] },
  { h: "Note", rows: [
    ["Most work depends on budget. Tippani processes budget work. Budget work is ministry work.", "TIP-01 – TIP-12 · BUD-01 – BUD-11 · BR-07 · §12", "/tippani"],
  ] },
];

const DECISIONS = [
  ["Tippani is fully digital; paper Tippani recorded with a scan", "/tippani/new"],
  ["Budget, expenditure and tender data by entry or Excel; external systems get interfaces only", "/imports"],
  ["Stack: Next.js, NestJS, MongoDB, Redis, MinIO; auth built into the API", "/api/health"],
  ["Phone use through the web app (PWA)", "/profile"],
  ["Hosting at GIDC with a DR site", "/api/health"],
];

export default function Coverage() {
  const { lang } = useApp();
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-black">{tx("आवश्यकता कभरेज", "Requirement coverage", lang)}</h1>
      <p className="text-[13px] text-slate-600">{tx("मूल आवश्यकताको हरेक लाइन → त्यसलाई दिने सुविधा (§20)।", "Every line of the original requirement → what delivers it (§20).", lang)}</p>
      {GROUPS.map((g) => (
        <Card key={g.h} title={g.h}>
          <Table cols={[tx("मूल आवश्यकता", "Original requirement", lang), tx("दिने सुविधा", "Covered by", lang), "→"]}
            rows={g.rows.map(([req, cov, href]) => [req, <span key={href} className="font-mono text-[11px]">{cov}</span>, <Link key={href + "l"} href={href} className="font-bold text-nepal-blue">→</Link>])} />
        </Card>
      ))}
      <Card title={tx("निर्णयहरू (§21 — विकास रोकिँदैन)", "Decisions taken (§21 — non-blocking)", lang)}>
        <Table cols={[tx("निर्णय", "Decision", lang), tx("कहाँ देखिन्छ", "Reflected in", lang)]}
          rows={DECISIONS.map(([d, href]) => [d, <Link key={href} href={href} className="font-bold text-nepal-blue">{href} →</Link>])} />
      </Card>
      <Card title={tx("स्वीकृति परीक्षण", "Acceptance tests", lang)}>
        <p className="text-[13px] text-slate-600"><Link href="/acceptance" className="font-bold text-nepal-blue">/acceptance</Link> {tx("— हरेक requirement ID लाइभ चल्छ।", "— every requirement ID runs live.", lang)}</p>
      </Card>
    </div>
  );
}
