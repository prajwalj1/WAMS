"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useApp, LangSwitch } from "@/lib/store";
import { t, tx } from "@/lib/i18n";
import { HEALTH_META } from "@/lib/progress";
import { statusLabel } from "@/lib/lifecycle";
import { digits } from "@/lib/i18n";
import { useCollection } from "@/lib/use-data";
import { permsFor } from "@/lib/scope";
import { Bell } from "./notifications";

export function HealthChip({ health, lang = "en" }) {
  const m = HEALTH_META[health] || HEALTH_META.ON_TRACK;
  const label = m[lang] || m.en;
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${m.cls}`}>● {label}</span>;
}

// Generic status chip — labels come from lifecycle STATUS_META (dynamic, bilingual).
// Health (§10, computed daily) uses HealthChip; record status (§11) uses this.
export function StatusChip({ status, lang = "en" }) {
  const terminal = ["REJECTED", "CANCELLED"].includes(status);
  const good = ["APPROVED", "VERIFIED", "DONE", "CONFIRMED", "CLOSED", "RESOLVED", "RESPONDED"].includes(status);
  const warn = ["ON_HOLD", "RETURNED", "IN_REVIEW", "SUBMITTED", "COMPLETION_SUBMITTED"].includes(status);
  const cls = terminal ? "bg-slate-800 text-white border-slate-900" : good ? "bg-emerald-50 text-emerald-800 border-emerald-300" : warn ? "bg-amber-50 text-amber-800 border-amber-300" : "bg-slate-100 text-slate-700 border-slate-300";
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${cls}`}>{statusLabel(status, lang)} <span className="ml-1 font-mono font-normal opacity-60">{status}</span></span>;
}

// Approval route preview — rendered before sending (§12: system shows route before send).
export function RoutePreview({ route, lang = "en" }) {
  if (!route) return null;
  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50 p-2 text-[12px]">
      <div className="font-bold text-sky-900">{tx("रुट प्रिभ्यु", "Route preview", lang)} · <span className="font-mono">{route.id}</span>{route.otp ? ` · ${tx("अन्तिम निर्णयमा OTP", "OTP on final decision", lang)}` : ""}</div>
      <ol className="mt-1 space-y-0.5">
        {(route.steps || []).map((s, i) => <li key={i} className="text-sky-800">{i + 1}. {s.role}{s.title ? ` (${s.title})` : ""} · {s.unit}</li>)}
      </ol>
    </div>
  );
}

// Status history + audit timeline — every transition writes both (§11).
export function HistoryTimeline({ history = [], lang = "en" }) {
  if (!history.length) return <p className="text-[12px] text-slate-400">{tx("अहिलेसम्म कुनै ट्रान्जिसन छैन", "No transitions yet", lang)}</p>;
  return (
    <ol className="space-y-1.5">
      {history.map((h, i) => (
        <li key={i} className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <StatusChip status={h.from} lang={lang} /><span className="text-slate-400">→ {h.action} →</span><StatusChip status={h.to} lang={lang} />
          <span className="text-slate-500">{h.actor}{h.reason ? ` · ${h.reason}` : ""}</span>
        </li>
      ))}
    </ol>
  );
}

export function Bars({ expected, physical, financial, financialDisplay, lang = "en" }) {
  const row = (label, v, cls, extra) => (
    <div className="flex items-center gap-2 text-xs sm:gap-2.5">
      <span className="w-14 shrink-0 truncate text-slate-500 sm:w-20">{label}</span>
      <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded bg-slate-200"><div className={`h-full rounded ${cls}`} style={{ width: `${Math.min(100, v)}%` }} /></div>
      <span className="w-12 shrink-0 text-right font-semibold">{extra || `${Math.round(v)}%`}</span>
    </div>
  );
  return <div className="space-y-1">{row(tx("अपेक्षित", "Expected", lang), expected, "bg-sky-500")}{row(tx("भौतिक", "Physical", lang), physical, "bg-emerald-500")}{financial == null ? null : row(tx("वित्तीय", "Financial", lang), financial, "bg-amber-500", financialDisplay)}</div>;
}

// Authenticated file preview — images render inline, PDFs embed, anything
// else offers a download link. Fetches the bytes with the x-sid session
// header (an <img>/<iframe> src cannot send headers, and query-string sids
// get stripped by some setups) and renders from a blob URL, so an admin with
// a valid session always sees the document itself — never just a filename.
// Scope/scan failures render the reason + a direct-open link, never blank.
export function DocPreview({ docId, name, variant = "full", lang = "en" }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState("");
  // Fullscreen lightbox for photos (all roles — same authenticated blob).
  // Esc or backdrop click closes; body scroll locks while open.
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e) => { if (e.key === "Escape") setZoom(false); };
    try {
      document.addEventListener("keydown", onKey);
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.removeEventListener("keydown", onKey);
        document.body.style.overflow = prev;
      };
    } catch { return undefined; }
  }, [zoom]);
  useEffect(() => {
    let alive = true;
    let obj = null;
    (async () => {
      try {
        let sid = "";
        try { sid = sessionStorage.getItem("wmams-sid") || ""; } catch {}
        const r = await fetch(`/api/documents/${encodeURIComponent(docId || "")}/download`, { headers: sid ? { "x-sid": sid } : {} });
        const ct = r.headers.get("content-type") || "";
        if (!r.ok || ct.includes("application/json")) {
          let code = `VIEW_FAILED_${r.status}`;
          try {
            const j = await r.json();
            code = j.code || j?.error?.code || code;
          } catch {}
          if (alive) setErr(code);
          return;
        }
        const blob = await r.blob();
        obj = URL.createObjectURL(blob);
        if (alive) setUrl(obj);
      } catch {
        if (alive) setErr("NETWORK_FAILED");
      }
    })();
    return () => {
      alive = false;
      try { if (obj) URL.revokeObjectURL(obj); } catch {}
    };
  }, [docId]);
  const direct = `/api/documents/${encodeURIComponent(docId || "")}/download`;
  if (err) {
    const hint = err === "UNAUTHENTICATED"
      ? tx("सत्र सकियो — लगआउट–लगइन गर्नुहोस्", "Session expired — log out and log in again", lang)
      : err === "OUT_OF_SCOPE"
        ? tx("अर्को शाखाको फाइल", "File belongs to another unit", lang)
        : err === "FILE_NOT_STORED"
          ? tx("फाइल भण्डारमा छैन — पुनः अपलोड", "No stored bytes — re-upload", lang)
          : err;
    return (
      <span className="inline-block rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[12px]">
        📎 <a href={direct} target="_blank" rel="noopener" className="font-bold text-nepal-blue hover:underline">{name || docId}</a>
        <span className="ml-1 text-amber-700">{hint}</span>
      </span>
    );
  }
  if (!url) return <span className="text-[12px] text-slate-400">{tx("लोड हुँदै…", "Loading…", lang)}</span>;
  if (/\.(jpe?g|png|gif|webp|bmp)$/i.test(String(name || ""))) {
    // Blob object URLs can't use next/image — plain <img> like the evidence cards.
    // Click opens the fullscreen lightbox (all roles).
    // eslint-disable-next-line @next/next/no-img-element
    const thumb = <button onClick={() => setZoom(true)} title={`${tx("पूर्ण स्क्रिन", "Fullscreen", lang)} · ${name || ""}`} className="cursor-zoom-in"><img src={url} alt={name} loading="lazy" className="h-28 w-40 rounded-lg border border-slate-200 object-cover hover:opacity-90" /></button>;
    // eslint-disable-next-line @next/next/no-img-element
    const full = <button onClick={() => setZoom(true)} title={tx("पूर्ण स्क्रिन", "Fullscreen", lang)} className="cursor-zoom-in"><img src={url} alt={name} className="max-h-[30rem] w-auto max-w-full rounded-lg border border-slate-200 object-contain hover:opacity-95" /></button>;
    return (
      <>
        {variant === "thumb" ? thumb : full}
        {zoom && (
          <div onClick={() => setZoom(false)} role="dialog" aria-label={name || "photo"}
            className="fixed inset-0 z-[100] flex flex-col bg-black/90 p-3 sm:p-6">
            <div className="no-print mb-2 flex items-center justify-between gap-2 text-white">
              <span className="truncate text-xs font-bold sm:text-sm">{name}</span>
              <button onClick={() => setZoom(false)} className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs font-black text-slate-900">✕ {tx("बन्द", "Close", lang)}</button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={name} onClick={(e) => e.stopPropagation()}
              className="mx-auto max-h-full min-h-0 w-auto max-w-full flex-1 rounded-lg object-contain" />
          </div>
        )}
      </>
    );
  }
  if (/\.pdf$/i.test(String(name || ""))) {
    return variant === "thumb"
      ? <span>📄 <span className="font-bold text-nepal-blue">{name}</span></span>
      : <iframe src={url} title={name} className="h-[480px] w-full rounded-lg border border-slate-200 bg-white" />;
  }
  return <a href={url} target="_blank" rel="noopener" className="text-xs font-bold text-nepal-blue hover:underline">{tx("नयाँ ट्याबमा खोल्नुहोस्", "Open in new tab", lang)} →</a>;
}

// Simple dependency-free SVG charts (§14 trends & distributions).
export function TrendChart({ series = [], lang = "en" }) {
  const max = Math.max(1, ...series.flatMap((s) => [s.spent || 0, s.target || 0]));
  const W = 560, H = 150, P = 26;
  const n = series.length;
  // A single month is a dot, not a line — center it so it reads as data.
  const x = (i) => (n <= 1 ? W / 2 : P + (i * (W - 2 * P)) / Math.max(1, n - 1));
  const y = (v) => H - P - ((v / max) * (H - 2 * P));
  const line = (key) => series.map((s, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(s[key] || 0).toFixed(1)}`).join(" ");
  // Full YYYY-MM labels while they fit; MM only on crowded axes.
  const labelOf = (m) => (n <= 8 ? m : String(m).slice(5));
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[280px]" role="img" aria-label="trend">
        {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1={P} x2={W - P} y1={y(max * f)} y2={y(max * f)} stroke="#e2e8f0" />)}
        {n > 1 && <path d={line("target")} fill="none" stroke="#c9a227" strokeDasharray="5 3" strokeWidth="2" />}
        {n > 1 && <path d={line("spent")} fill="none" stroke="#003893" strokeWidth="2.5" />}
        {series.map((s, i) => (
          <g key={s.m ?? i}>
            {s.projected ? (
              <circle cx={x(i)} cy={y(s.target || 0)} r={n <= 1 ? 6 : 3.5} fill="none" stroke="#c9a227" strokeWidth="2" />
            ) : (
              <circle cx={x(i)} cy={y(s.spent || 0)} r={n <= 1 ? 6 : 3.5} fill="#003893" />
            )}
            {!s.projected && <text x={x(i)} y={y(s.spent || 0) - 10} textAnchor="middle" fontSize="11" fontWeight="bold" fill="#003893">{s.spent}</text>}
            <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill={s.projected ? "#c9a227" : "#64748b"}>{labelOf(s.m)}</text>
          </g>
        ))}
      </svg>
      <div className="flex gap-3 text-[11px] text-slate-500"><span><span className="mr-1 inline-block h-2 w-4 bg-nepal-blue" />{lang === "ne" ? "खर्च" : "Spent"}</span><span><span className="mr-1 inline-block h-2 w-4 bg-nepal-gold" />{lang === "ne" ? "लक्ष्य" : "Target"}</span>{series.some((s) => s.projected) && <span><span className="mr-1 inline-block h-2 w-4 rounded-full border-2 border-nepal-gold" />{lang === "ne" ? "अनुमानित" : "Projected"}</span>}</div>
    </div>
  );
}

// Stacked health distribution bar (counts per health state).
export function DistBar({ dist = {}, lang = "en" }) {
  const total = Object.values(dist).reduce((a, b) => a + b, 0) || 1;
  const color = { ON_TRACK: "bg-emerald-500", AT_RISK: "bg-amber-400", BEHIND: "bg-red-400", OVERDUE: "bg-red-700", NOT_STARTED: "bg-slate-300" };
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
        {Object.entries(dist).map(([k, v]) => <div key={k} className={color[k] || "bg-slate-400"} style={{ width: `${(v / total) * 100}%` }} title={`${k}: ${v}`} />)}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
        {Object.entries(dist).map(([k, v]) => <span key={k}><span className={`mr-1 inline-block h-2 w-2 rounded-full ${color[k]}`}></span>{k} {v}</span>)}
      </div>
    </div>
  );
}

// Allocated vs spent horizontal bars per ministry/unit.
export function BudgetBars({ rows = [] }) {
  const max = Math.max(1, ...rows.map((r) => r.allocated));
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={r.code ?? r.id ?? r._id ?? `row-${i}`} className="min-w-0 text-[11px]">
          <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5"><b className="min-w-0 break-words">{r.code}{r.minister ? ` · ${r.minister}` : ""}</b><span className="shrink-0 text-slate-500">{Math.round((r.spent / Math.max(1, r.allocated)) * 100)}% · {(r.spent / 10000000).toFixed(1)}cr / {(r.allocated / 10000000).toFixed(1)}cr</span></div>
          <div className="h-2 overflow-hidden rounded bg-slate-200"><div className="h-full rounded bg-gradient-to-r from-nepal-blue to-sky-500" style={{ width: `${Math.min(100, (r.spent / Math.max(1, r.allocated)) * 100)}%` }} data-max={max} /></div>
        </div>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, accent = "border-nepal-blue" }) {
  const { lang, npDigits } = useApp();
  return (
    <div className={`min-w-0 rounded-xl border border-slate-200 border-t-4 ${accent} bg-white p-2.5 shadow-sm sm:p-3`}>
      <div className="truncate text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="truncate text-lg font-bold text-slate-900 sm:text-xl">{digits(value, lang, npDigits)}</div>
      {sub && <div className="mt-0.5 break-words text-[11px] text-slate-500 sm:text-xs">{sub}</div>}
    </div>
  );
}

export function Card({ title, action, children, className = "" }) {
  return (
    <section className={`anim-card min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <h3 className="min-w-0 flex-1 text-sm font-bold text-slate-800">{title}</h3>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className="p-2.5 sm:p-3">{children}</div>
    </section>
  );
}

// Global toast stack — every add / update / delete / deactivate across the
// project reports through toast(msg) from useApp(). Fixed bottom-right,
// auto-dismissed by the provider, click to dismiss early.
export function Toaster() {
  const { toasts, dismissToast } = useApp();
  if (!toasts?.length) return null;
  const kindCls = {
    ok: "border-emerald-300 bg-emerald-50 text-emerald-900",
    info: "border-sky-300 bg-sky-50 text-sky-900",
    err: "border-red-300 bg-red-50 text-red-900",
    del: "border-red-400 bg-red-600 text-white",
  };
  const kindIcon = { ok: "✅", info: "ℹ️", err: "❌", del: "🗑️" };
  return (
    <div className="no-print fixed bottom-4 right-4 z-[60] flex w-[86vw] max-w-80 flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((x) => (
        <button key={x.id} onClick={() => dismissToast(x.id)}
          className={`anim-toast flex items-start gap-2 rounded-xl border px-3 py-2 text-left text-[13px] font-semibold shadow-lg ${kindCls[x.kind] || kindCls.ok}`}>
          <span aria-hidden="true">{kindIcon[x.kind] || kindIcon.ok}</span>
          <span className="min-w-0 flex-1 break-words">{x.msg}</span>
          <span aria-hidden="true" className="opacity-50">✕</span>
        </button>
      ))}
    </div>
  );
}

export function Table({ cols, rows }) {
  return (
    <div className="nice-scroll -mx-2.5 overflow-x-auto px-2.5 sm:mx-0 sm:rounded-lg sm:border sm:border-slate-200 sm:px-0">
      <table className="w-full min-w-[520px] text-left text-[12px] sm:min-w-[640px] sm:text-[13px]">
        <thead><tr className="bg-slate-50 text-slate-500">{cols.map((c, i) => <th key={i} className="whitespace-nowrap px-2 py-2 font-semibold sm:px-3">{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">{r.map((c, j) => <td key={j} className="break-words px-2 py-2 align-top sm:px-3">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

// ── Per-role sidebars (§5 hierarchy) ─────────────────────────────────────────
// Every role gets its OWN sidebar — no shared whole-app menu. A user only
// ever sees the links for their role; nothing outside it. The per-role lists
// below are the authorization source for navigation, and sidebarFor() applies
// a second permission guard (NAV_GUARDS + permsFor) so a sensitive item can
// never leak into a role that lacks the permission — even if the lists drift.
const OPS = [
  ["/progress", "progress"], ["/my-work", "myWork"], ["/works", "works"], ["/tippani", "tippani"],
  ["/budget", "budget"], ["/expenditures", "expenditures"], ["/procurements", "procurement"],
  ["/issues", "issues"], ["/directives", "directives"], ["/documents", "documents"], ["/reports", "reports"],
];
const pick = (all, hrefs) => all.filter(([h]) => hrefs.includes(h));
// Sensitive destinations require a permission on top of being in the role's
// list (aligned with infra/seed/permissions.json via permsFor). Read-only
// destinations (works/tippani/documents/reports/…) are authorized by the
// role list itself, so record-level scope checks still apply on the page/API.
export const NAV_GUARDS = {
  "/org": "org.unit.manage",
  "/users": "user.manage",
  "/audit": "audit.view",
  "/admin": "org.ministry.manage",
};
const hasPerm = (role, need) => {
  if (!need) return true;
  const p = permsFor(role) || [];
  return p.includes("*") || p.includes(need);
};
export const ROLE_SIDEBARS = {
  // PMO Super Admin: ministers + monitoring ONLY — manages ministries and
  // accounts (/org, /users), monitors everything read-only
  // (dashboard, works, documents, reports, reviews, audit) plus system
  // config. No operational items: no progress/my-work, tippani, budget,
  // expenditures, procurements, issues, directives or imports.
  // Reviews stay verify-locked (UNIT_HEAD/APPROVER-only, server-enforced).
  SUPER_ADMIN: [
    ["/", "dashboard"],
    ["/org", "org"], ["/users", "users"],
    ...pick(OPS, ["/works", "/documents", "/reports"]),
    ["/reviews", "reviews"],
    ["/audit", "audit"],
    ["/admin", "admin"], ["/profile", "profile"],
  ],
  // Ministry (minister): strictly ministry activities — own dashboard areas
  // (works, tippani, budget, expenditures, procurements, documents, reports)
  // plus directive/issue APPROVAL (close is top-level-only, server-enforced),
  // account management (users) and read-only completion
  // reviews (verifying stays UNIT_HEAD/APPROVER-only, server-enforced).
  // No staff tools (progress, my-work), no imports, no org/audit
  // screens — Organisation is PMO-only.
  MINISTRY_ADMIN: [
    ["/", "dashboard"], ...pick(OPS, ["/works", "/tippani", "/budget", "/procurements", "/issues", "/directives", "/documents", "/reports"]),
    ["/users", "users"],
    ["/reviews", "reviews"], ["/profile", "profile"],
  ],
  // Approver: tippani decisions + directive/issue approval + reviews.
  APPROVER: [
    ["/", "dashboard"], ...pick(OPS, ["/works", "/tippani", "/issues", "/directives", "/documents", "/reports"]),
    ["/reviews", "reviews"], ["/profile", "profile"],
  ],
  // Department head: own budget + own works, independently — works,
  // tippani, budget lines, bill entry, procurement, documents, reports,
  // directive/issue approval (close is top-level-only, server-enforced),
  // team, section accounts (users), completion reviews.
  // No progress board, personal tasks, or org admin.
  UNIT_HEAD: [
    ["/", "dashboard"], ...pick(OPS, ["/works", "/tippani", "/budget", "/expenditures", "/procurements", "/issues", "/directives", "/documents", "/reports"]),
    ["/users", "users"],
    ["/reviews", "reviews"], ["/profile", "profile"],
  ],
  // Staff: tasks/subtasks + TOR, activities, progress updates,
  // procurement recording, tippani drafts.
  STAFF: [
    ["/", "dashboard"], ...pick(OPS, ["/progress", "/my-work", "/works", "/tippani", "/expenditures", "/procurements", "/issues", "/directives", "/documents", "/reports"]),
    ["/profile", "profile"],
  ],
  // Finance officer: budget lines, bills, payments (+ Excel imports of
  // budget_lines / expenditures templates) plus e-Tippani drafts/views
  // (holds tippani.draft — decisions stay ministry-only, server-enforced).
  // /expenditures is required: only budget.manage holders (finance) can
  // Record payment / Reverse APPROVED bills.
  FINANCE_OFFICER: [
    ["/", "dashboard"], ...pick(OPS, ["/works", "/tippani", "/budget", "/expenditures", "/documents", "/reports"]),
    ["/imports", "imports"],
    ["/profile", "profile"],
  ],
  // Leadership / Auditor: read-only dashboards, reports, audit trail.
  AUDITOR: [
    ["/", "dashboard"], ...pick(OPS, ["/works", "/tippani", "/budget", "/procurements", "/documents", "/reports"]),
    ["/audit", "audit"], ["/profile", "profile"],
  ],
  // Section head: own section works + tippani actions + procurement, plus
  // staff accounts for the section (/users, scoped to own unit).
  SECTION_HEAD: [
    ["/", "dashboard"], ...pick(OPS, ["/my-work", "/works", "/tippani", "/expenditures", "/procurements", "/issues", "/directives", "/documents", "/reports"]),
    ["/users", "users"], ["/reviews", "reviews"], ["/profile", "profile"],
  ],
  // Viewer: strictly read-only national/ministry view.
  VIEWER: [
    ["/", "dashboard"], ...pick(OPS, ["/works", "/documents", "/reports"]),
    ["/profile", "profile"],
  ],
  // External (e.g. contractor): minimal — documents only.
  EXTERNAL: [
    ["/", "dashboard"], ...pick(OPS, ["/documents"]),
    ["/profile", "profile"],
  ],
  // System: non-human service account — never a full menu.
  SYSTEM: [
    ["/", "dashboard"], ["/profile", "profile"],
  ],
};
// Minimal read-only sidebar for any unknown role — never the whole menu.
export const DEFAULT_SIDEBAR = [
  ["/", "dashboard"], ...pick(OPS, ["/works", "/documents", "/reports"]),
  ["/profile", "profile"],
];
// Mahashakha (Division) sidebar: spends the ministry budget via Tippani,
// manages its tasks and submits updates (/progress, /my-work, /works —
// task.update is role-held, server-enforced), approves directives/issues
// for its people (close is top-level-only, server-enforced), plus staff
// accounts for its own people (/users, scoped to own unit). Applies by UNIT
// TYPE (whoever is posted in a mahashakha), overriding the role sidebar.
export const MAHASHAKHA_SIDEBAR = [
  ["/", "dashboard"], ...pick(OPS, ["/progress", "/my-work", "/works", "/tippani", "/expenditures", "/issues", "/directives", "/documents", "/reports"]),
  ["/users", "users"],
  ["/profile", "profile"],
];
// Authorized sidebar for a role (+ unit type): whoever is posted in a
// mahashakha gets the Mahashakha sidebar — EXCEPT the doers (STAFF and
// SECTION_HEAD), who always keep their role sidebars with the staff-work
// tools (tasks, procurement, progress…).
// Consistency fallback: any role holding tippani.draft / tippani.act always
// sees /tippani (draft + view; decisions stay ministry-only server-side), so
// SUPER_ADMIN-managed custom roles with tippani permissions are never stuck
// without the menu their permission implies.
export const sidebarFor = (role, unitType = null) => {
  const doer = ["STAFF", "SECTION_HEAD"].includes(role);
  const base = (unitType === "MAHASHAKHA" && !doer) ? MAHASHAKHA_SIDEBAR : (ROLE_SIDEBARS[role] || DEFAULT_SIDEBAR);
  const visible = base.filter(([href]) => hasPerm(role, NAV_GUARDS[href]));
  const p = permsFor(role) || [];
  if (!visible.some(([h]) => h === "/tippani") && (p.includes("tippani.draft") || p.includes("tippani.act"))) {
    const at = visible.findIndex(([h]) => h === "/works");
    visible.splice(at === -1 ? visible.length - 1 : at + 1, 0, ["/tippani", "tippani"]);
  }
  return visible;
};

export function Shell({ children }) {
  const { lang, role, user, ready } = useApp();
  // Sidebar is role AND unit-type aware: whoever is posted in a mahashakha
  // gets the Mahashakha sidebar (tippani spending only) — never the whole
  // menu of their role.
  const unitsQ = useCollection("units");
  // Match by id, code or _id (profile may carry any of them) — matching by
  // id alone silently drops the mahashakha override for code-based profiles.
  const myUnit = (unitsQ.data || []).find((u) =>
    [u.id, u.code, u._id].filter(Boolean).map(String).includes(String(user?.unitId || "")));
  // Unit type preferably from the login profile (correct on the first render
  // after login AND refresh); the live units list is only a fallback. Never
  // derive it from an unloaded list, or the menu flips mid-load.
  const myUnitType = user?.unitType || myUnit?.type || null;
  // Identity (role + username) lands synchronously via applyProfile() at
  // login, so the authorized menu renders on the very first dashboard paint.
  // It must never wait for the units collection (async, may have 401'd
  // pre-login) — otherwise only skeletons/a partial menu show until a hard
  // refresh. Skeletons render only while identity itself is still unknown.
  const navReady = !!ready && !!user?.username;
  const visibleNav = navReady ? sidebarFor(role, myUnitType) : [];
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const isAuthPage = path?.startsWith("/login") || path?.startsWith("/reset-password");
  // Client-side login-first gate (defence in depth behind middleware):
  // fresh visitors without a session never see the dashboard — they bounce
  // to /login instead of flashing app content. Requires BOTH the session id
  // and the auth cookie so a stale cookie alone cannot skip login.
  const [authState, setAuthState] = useState("checking");
  /* eslint-disable react-hooks/set-state-in-effect -- session hydrates after mount; SSR renders the redirecting gate */
  useEffect(() => {
    if (isAuthPage) { setAuthState("auth-page"); return; }
    let sid = null;
    try { sid = sessionStorage.getItem("wmams-sid"); } catch {}
    const hasCookie = typeof document !== "undefined" && document.cookie.split(";").some((c) => c.trim() === "wmams-auth=1" || c.trim().startsWith("wmams-auth=1;") || c.trim().startsWith("wmams-auth=1 "));
    if (sid && hasCookie) {
      setAuthState("authed");
    } else {
      setAuthState("redirecting");
      // Drop a stale auth cookie (sid gone but cookie lingers, e.g. new tab)
      // so the server gate and this client gate agree on logged-out.
      try {
        document.cookie = "wmams-auth=; path=/; max-age=0";
        document.cookie = "wmams-role=; path=/; max-age=0";
      } catch {}
      router.replace("/login");
    }
  }, [isAuthPage, router]);
  /* eslint-enable react-hooks/set-state-in-effect */
  // Post-login org refetch: Shell mounts (and fetches units) on the login
  // page WITHOUT a session — the proxy answers 401 and the stable collection
  // key never refires on its own. Refetch once authenticated so the
  // unit-type fallback converges without a hard refresh. All visibility
  // stays server-enforced; this only refreshes client data.
  const authedRef = useRef(false);
  const reloadUnits = unitsQ.reload;
  useEffect(() => {
    if (authState === "authed" && !authedRef.current) {
      authedRef.current = true;
      try { reloadUnits?.(); } catch {}
    }
    if (authState !== "authed") authedRef.current = false;
  }, [authState, reloadUnits]);
  // Close the mobile drawer on navigation (link clicks already close it;
  // this covers back/forward + programmatic pushes).
  /* eslint-disable react-hooks/set-state-in-effect -- drawer follows the route */
  useEffect(() => {
    setOpen(false);
  }, [path]);
  /* eslint-enable react-hooks/set-state-in-effect */
  if (isAuthPage) return <>{children}</>;
  if (authState !== "authed") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-100 p-6 text-center">
        <img src="/images/logo.png" alt="" className="h-14 w-14 object-contain" aria-hidden="true" />
        <p className="text-sm font-bold text-nepal-blue">{lang === "ne" ? "लगइनमा पठाउँदै…" : "Redirecting to login…"}</p>
      </div>
    );
  }
  const logout = async () => {
    try {
      const { clearSession, getSid, getUsername } = await import("@/lib/session");
      const sid = getSid();
      if (sid) await fetch("/api/auth/sessions", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ sid, user: getUsername() }) }).catch(() => {});
      clearSession();
    } catch {}
    router.push("/login");
  };
  const side = (
    <nav className="nice-scroll h-full min-h-0 space-y-0.5 overflow-y-auto p-2" aria-label={lang === "ne" ? "मुख्य मेनु" : "Main menu"}>
      {!navReady ? (
        [1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="skel mx-1 my-1.5 h-8 rounded-lg" />)
      ) : (
        visibleNav.map(([href, k]) => {
          const active = path === href;
          return (
            <Link key={href} href={href} onClick={() => setOpen(false)}
              className={`block rounded-lg px-3 py-2 text-[13px] font-medium ${active ? "bg-nepal-blue text-white" : "text-slate-700 hover:bg-slate-100"}`}>
              {href === "/acceptance" ? (lang === "ne" ? "स्वीकृति परीक्षण" : "Acceptance") : href === "/coverage" ? (lang === "ne" ? "कभरेज" : "Coverage") : href === "/architecture" ? (lang === "ne" ? "संरचना" : "Architecture") : t(k, lang)}
            </Link>
          );
        })
      )}
    </nav>
  );
  return (
    <div className="app-root flex min-h-screen flex-col bg-slate-100">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-bold">{lang === "ne" ? "मुख्य सामग्रीमा जानुहोस्" : "Skip to main content"}</a>

      {/* ── Nepal Government utility strip ── */}
      <div className="bg-nepal-blue text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-3 gap-y-1 px-2 py-1.5 text-[11px] sm:px-3 sm:text-[12px]">
          <span className="flex min-w-0 items-center gap-1.5 font-semibold">
            <span aria-hidden="true">🇳🇵</span>
            <span className="truncate">{t("gov", lang)} · {t("appName", lang)}</span>
          </span>
          <span className="no-print relative flex shrink-0 items-center gap-2">
            <Bell />
            <span className="hidden rounded bg-white/20 px-2 py-0.5 font-semibold min-[420px]:inline">{t("fy", lang)}</span>
            <span className="hidden sm:inline"><LangSwitch /></span>
          </span>
        </div>
      </div>

      {/* ── National masthead: emblem + bilingual ministry title ── */}
      <div className="border-b-4 border-nepal-crimson bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-2 py-2.5 sm:px-3 sm:py-3 md:flex-row md:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
            <button className="no-print shrink-0 rounded-lg border border-slate-300 p-2 text-lg leading-none lg:hidden" onClick={() => setOpen(!open)} aria-label="menu" aria-expanded={open}>☰</button>
            {/* National emblem of Nepal */}
            <img
              src="/images/logo.png"
              alt={lang === "ne" ? "नेपालको राष्ट्रिय चिन्ह" : "National emblem of Nepal"}
              className="h-12 w-12 shrink-0 object-contain sm:h-16 sm:w-16"
              width={64}
              height={64}
            />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold text-nepal-blue sm:text-xs">
                {lang === "ne" ? "नेपाल सरकार" : "Government of Nepal"}
              </div>
              <div className="truncate text-[15px] font-black leading-tight text-nepal-crimson sm:text-xl sm:leading-tight">
                {t("pilot", lang)}
              </div>
              <div className="truncate text-[11px] text-slate-500 sm:text-xs">
                {t("appName", lang)} · WMAMS-SPEC-001 v2.0
              </div>
              <div className="hidden text-[11px] text-slate-400 md:block">PMO → Ministry → Dept / Mahashakha → Section</div>
            </div>
          </div>
          {/* Account / session controls — identity comes strictly from the login
              profile; there is no role switcher (each user sees only their own role). */}
          <div className="no-print flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2 text-xs md:justify-end md:border-0 md:pt-0">
            <span className="mr-auto text-[11px] text-slate-500 md:hidden">{user?.unit || ""}</span>
            <span className="max-w-[220px] truncate rounded-lg border border-slate-300 bg-slate-50 px-2 py-1.5 text-xs font-semibold text-slate-700 sm:max-w-none" title={`${user?.username || ""} · ${user?.unit || ""}`}>
              {user?.username || "—"} · {role} · {user?.unit || ""}
            </span>
            <button onClick={logout} className="rounded-lg border border-nepal-crimson px-2.5 py-1.5 text-xs font-bold text-nepal-crimson hover:bg-red-50" title={user?.username || ""}>{lang === "ne" ? "बाहिरिनुहोस्" : "Logout"}</button>
            <span className="sm:hidden"><LangSwitch compact /></span>
          </div>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-3 px-2 py-3 sm:px-3">
        <aside className="no-print sticky top-0 hidden h-screen max-h-screen w-52 shrink-0 self-start overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:block">{side}</aside>
        {open && <div className="fixed inset-0 z-40 lg:hidden"><div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} /><aside role="dialog" aria-modal="true" aria-label={lang === "ne" ? "मुख्य मेनु" : "Main menu"} className="anim-drawer absolute left-0 top-0 h-full w-[85vw] max-w-72 overflow-y-auto bg-white shadow-xl">{side}</aside></div>}
        <main id="main" className="anim-page min-w-0 flex-1">{children}</main>
      </div>

      {/* ── Gov footer ── */}
      <footer className="mt-auto border-t-4 border-nepal-crimson bg-nepal-blue text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-3 py-3 text-[11px] sm:flex-row sm:items-center sm:justify-between sm:text-xs">
          <div className="flex items-center gap-2">
            <img src="/images/logo.png" alt="" className="h-7 w-7 object-contain brightness-[1.1]" aria-hidden="true" />
            <span>🇳🇵 {t("gov", lang)} · {t("pilot", lang)}</span>
          </div>
          <div className="opacity-80">{t("appName", lang)} · {t("fy", lang)}</div>
        </div>
      </footer>
      <Toaster />
    </div>
  );
}
