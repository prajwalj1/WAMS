"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApp } from "@/lib/store";
import { tx } from "@/lib/i18n";
import { runAlertChecks, alertsFor } from "@/lib/alerts";
import { enrichWorks } from "@/lib/metrics";
import { kathmanduDayKey } from "@/lib/progress";
import { useCollection } from "@/lib/use-data";

// Same row-level isolation as the dashboards: non-SUPER_ADMIN roles only
// ever feed their own unit subtree into the engine.
const inScopeRec = (rec, scopeIds) => !scopeIds || (rec?.orgAncestors || []).some((a) => (scopeIds || []).includes(a));

export function useNotifications() {
  const { role, user } = useApp();
  // Cheap identity derivation — recomputed per render, no memo needed.
  const scopeIds = role === "SUPER_ADMIN" ? null
    : (user?.scopeUnitIds?.length ? user.scopeUnitIds : user?.unitId ? [user.unitId] : []).filter(Boolean);
  const works = useCollection("works");
  const tasks = useCollection("tasks");
  const tippanis = useCollection("tippanis");
  const procurements = useCollection("procurements");
  const contracts = useCollection("contracts");
  const directives = useCollection("directives");
  const budget = useCollection("budget");
  const todayKey = kathmanduDayKey(new Date());
  const loading = [works, tasks, tippanis, procurements, contracts, directives, budget]
    .some((c) => c.loading && !(c.data || []).length);

  const { items, lookups } = useMemo(() => {
    try {
      const sWorks = (works.data || []).filter((w) => inScopeRec(w, scopeIds));
      const sTasks = (tasks.data || []).filter((x) => inScopeRec(x, scopeIds));
      const sTips = (tippanis.data || []).filter((x) => inScopeRec(x, scopeIds));
      const snap = {
        works: enrichWorks(sWorks, new Date()),
        tasks: sTasks,
        // Completion/tippani waits surface as review waits.
        reviews: sTips.filter((x) => x.status === "IN_REVIEW").map((x) => ({ id: x.ref, since: x.stepSince })),
        tippanis: sTips,
        procurements: (procurements.data || []).filter((p) => inScopeRec(p, scopeIds)),
        contracts: (contracts.data || []).filter((c) => inScopeRec(c, scopeIds)),
        directives: (directives.data || []).filter((d) => inScopeRec(d, scopeIds)),
        budgetLines: (budget.data || []).filter((b) => inScopeRec(b, scopeIds)),
        today: todayKey,
      };
      const allowed = alertsFor(role);
      const fired = runAlertChecks(snap);
      const mine = allowed ? fired.filter((a) => allowed.includes(a.code)) : fired;
      return {
        items: mine.slice(-50).reverse(),
        lookups: {
          tasks: new Set(sTasks.map((x) => x.ref)),
          contracts: new Set((contracts.data || []).filter((c) => inScopeRec(c, scopeIds)).map((c) => c.id)),
          directives: new Set((directives.data || []).filter((d) => inScopeRec(d, scopeIds)).map((d) => d.id)),
          budget: new Set((budget.data || []).filter((b) => inScopeRec(b, scopeIds)).map((b) => b.subhead)),
        },
      };
    } catch {
      return { items: [], lookups: { tasks: new Set(), contracts: new Set(), directives: new Set(), budget: new Set() } };
    }
  }, [works.data, tasks.data, tippanis.data, procurements.data, contracts.data, directives.data, budget.data, todayKey, role, scopeIds]);

  return { items, lookups, loading, count: items.length };
}

const linkFor = (a, lookups) => {
  const e = a?.entity || "";
  if (e.startsWith("TIP-")) return `/tippani/${e}`;
  if (e.startsWith("W-")) return `/works/${e}`;
  if (lookups.tasks.has(e)) return `/tasks/${e}`;
  if (lookups.contracts.has(e)) return `/contracts/${e}`;
  if (lookups.directives.has(e)) return "/directives";
  if (lookups.budget.has(e)) return "/budget";
  return null;
};

const isCritical = (a) => String(a?.channel || "").includes("SMS");

// Header bell: live role-scoped in-app alerts (information + warnings).
// Different roles see different codes via alertsFor(); counts/scopes match
// the dashboards. No persistence — the count is recomputed from live data.
export function Bell() {
  const { lang } = useApp();
  const { items, lookups, loading } = useNotifications();
  const [open, setOpen] = useState(false);
  const path = usePathname();
  /* eslint-disable react-hooks/set-state-in-effect -- dropdown follows the route */
  useEffect(() => {
    setOpen(false);
  }, [path]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const count = loading ? 0 : items.length;
  return (
    <span className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={tx("सूचना", "Notifications", lang)}
        aria-haspopup="true"
        aria-expanded={open}
        title={tx("सूचना", "Notifications", lang)}
        className="relative rounded-md p-1.5 text-white transition hover:bg-white/20"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-nepal-crimson px-1 text-[10px] font-black text-white ring-2 ring-nepal-blue">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      {open && (
        <>
          <button aria-hidden="true" tabIndex={-1} onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default bg-transparent" />
          <div role="dialog" aria-label={tx("सूचना", "Notifications", lang)} className="absolute right-0 z-50 mt-2 max-h-[60vh] w-[min(92vw,22rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white text-slate-800 shadow-xl">
            <div className="sticky top-0 flex items-center justify-between gap-2 border-b border-slate-100 bg-white px-3 py-2">
              <b className="text-[13px]">{tx("सूचना", "Notifications", lang)} {count > 0 && <span className="text-slate-400">({count})</span>}</b>
              <button onClick={() => setOpen(false)} aria-label={tx("बन्द", "Close", lang)} className="rounded-md px-2 py-0.5 text-sm font-bold text-slate-400 hover:bg-slate-100">✕</button>
            </div>
            <div className="p-2">
              {loading ? (
                [1, 2, 3].map((i) => <div key={i} className="skel mx-1 my-1.5 h-10 rounded-lg" />)
              ) : items.length === 0 ? (
                <p className="px-2 py-4 text-center text-[13px] text-slate-400">{tx("सबै ठीक छ — नयाँ सूचना छैन", "All clear — no new notifications", lang)}</p>
              ) : (
                items.map((a, i) => {
                  const href = linkFor(a, lookups);
                  const body = (
                    <>
                      <span className={`mt-0.5 h-8 w-1 shrink-0 self-start rounded-full ${isCritical(a) ? "bg-nepal-crimson" : "bg-nepal-blue"}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-[12px] font-semibold leading-snug">{a.message}</span>
                        <span className="mt-0.5 block font-mono text-[10px] text-slate-400">{a.code} · {a.at}</span>
                      </span>
                    </>
                  );
                  return href ? (
                    <Link key={`${a.code}-${a.entity}-${i}`} href={href} onClick={() => setOpen(false)} className="mb-1 flex gap-2 rounded-lg px-2 py-2 hover:bg-slate-50">
                      {body}
                    </Link>
                  ) : (
                    <div key={`${a.code}-${a.entity}-${i}`} className="mb-1 flex gap-2 rounded-lg px-2 py-2">
                      {body}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </span>
  );
}
