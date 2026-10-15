"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { loadWorkflowConfig, saveWorkflowConfig, seedRoutes, LARGE_BAND_DEFAULT_NPR } from "./lifecycle";
import { permsFor } from "./scope";

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

const ROLES = ["SUPER_ADMIN", "MINISTRY_ADMIN", "APPROVER", "UNIT_HEAD", "SECTION_HEAD", "STAFF", "FINANCE_OFFICER", "EXTERNAL", "VIEWER", "AUDITOR", "SYSTEM"];

export function AppProvider({ children }) {
  // NOTE: defaults render identically on server + first client pass (no
  // hydration mismatch); persisted values sync from localStorage after mount.
  // Identity is NEVER hardcoded here — it hydrates from the login session
  // profile only (empty until then).
  const EMPTY_USER = { name: "", nameEn: "", username: "", unit: "", unitId: "", unitType: "", scopeUnitIds: [] };
  const [lang, setLang] = useState("en");
  const [role, setRoleState] = useState("MINISTRY_ADMIN");
  const [user, setUser] = useState(EMPTY_USER);
  const [routes, setRoutes] = useState(() => seedRoutes(LARGE_BAND_DEFAULT_NPR));
  const [largeNpr, setLargeNpr] = useState(LARGE_BAND_DEFAULT_NPR);
  const [npDigits, setNpDigits] = useState(false);
  // True once the mount effect below has hydrated role/unit/lang from the
  // session profile. Consumers (sidebar) gate on this so a refresh never
  // flashes the default-role menu before the real identity arrives.
  const [ready, setReady] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const l = window.localStorage.getItem("wmams-lang");
      if (l === "ne" || l === "en") setLang(l);
      if (window.localStorage.getItem("wmams-npdigits") === "1") setNpDigits(true);
      // Session profile (set at login) drives role + scope — dashboard lands by role.
      const raw = window.sessionStorage.getItem("wmams-profile");
      if (raw) {
        const p = JSON.parse(raw);
        // Accept SUPER_ADMIN-managed custom roles too (roles collection) —
        // unknown codes fall back to the read-only sidebar, never escalate.
        if (p.role && (ROLES.includes(p.role) || /^[A-Z][A-Z0-9_]{2,30}$/.test(p.role))) setRoleState(p.role);
        setUser((u) => ({ ...u, name: p.name || u.name, nameEn: p.nameEn || u.nameEn, unit: p.unit || u.unit, unitId: p.unitId || u.unitId, unitType: p.unitType || u.unitType, scopeUnitIds: p.scopeUnitIds || u.scopeUnitIds, username: p.username || u.username }));
      }
      const cfg = loadWorkflowConfig();
      setRoutes(cfg.routes);
      setLargeNpr(cfg.largeNpr);
    } catch {}
    setReady(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      document.documentElement.lang = lang;
      localStorage.setItem("wmams-lang", lang);
    } catch {}
  }, [lang]);
  const setLanguage = (l) => setLang(l === "en" ? "en" : "ne");
  const toggleLang = () => setLang((p) => (p === "ne" ? "en" : "ne"));
  // Role switcher persists for the demo; login overwrites from the profile.
  const setRole = (r) => {
    setRoleState(r);
    try { document.cookie = `wmams-role=${r}; path=/; max-age=604800`; } catch {}
  };
  // Applied at login: profile (role/unit/scope) takes effect immediately.
  const applyProfile = (p) => {
    if (!p) return;
    if (p.role && (ROLES.includes(p.role) || /^[A-Z][A-Z0-9_]{2,30}$/.test(p.role))) setRoleState(p.role);
    setUser((u) => ({ ...u, name: p.name || u.name, nameEn: p.nameEn || u.nameEn, unit: p.unit || u.unit, unitId: p.unitId || u.unitId, unitType: p.unitType || u.unitType, scopeUnitIds: p.scopeUnitIds || u.scopeUnitIds, username: p.username || u.username }));
  };
  // Workflow routes below are admin-editable config (persisted via /admin),
  // not identity data — they hydrate from stored config in the mount effect.
  // Seeded defaults above (SSR-safe); stored config hydrates in the mount effect.
  const updateRoutes = (next, band) => {
    const b = band ?? largeNpr;
    setRoutes(next);
    if (band != null) setLargeNpr(band);
    saveWorkflowConfig({ routes: next, largeNpr: b });
  };
  const resetWorkflow = () => {
    const fresh = seedRoutes(LARGE_BAND_DEFAULT_NPR);
    setRoutes(fresh);
    setLargeNpr(LARGE_BAND_DEFAULT_NPR);
    saveWorkflowConfig({ routes: fresh, largeNpr: LARGE_BAND_DEFAULT_NPR });
  };
  const toggleDigits = () => {
    const next = !npDigits;
    setNpDigits(next);
    try { window.localStorage.setItem("wmams-npdigits", next ? "1" : "0"); } catch {}
  };
  // ── Global toasts: every add / update / delete / deactivate across the
  // project reports through toast() — one stack, auto-dismissed. ──────────
  const [toasts, setToasts] = useState([]);
  const dismissToast = (id) => setToasts((t) => t.filter((x) => x.id !== id));
  const toast = (msg, kind = "ok") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((t) => [...t.slice(-3), { id, msg: String(msg), kind }]);
    setTimeout(() => dismissToast(id), 4000);
    return id;
  };
  return <AppCtx.Provider value={{ lang, setLanguage, toggleLang, role, setRole, applyProfile, roles: ROLES, user, ready, perms: permsFor(role), npDigits, toggleDigits, routes, largeNpr, updateRoutes, resetWorkflow, toasts, toast, dismissToast }}>{children}</AppCtx.Provider>;
}

// Project-wide access to the dynamic lifecycle config. Pages must read routes
// + band from here — never hardcode chains.
export function useWorkflow() {
  const ctx = useApp();
  return { routes: ctx?.routes || seedRoutes(), largeNpr: ctx?.largeNpr || LARGE_BAND_DEFAULT_NPR, updateRoutes: ctx?.updateRoutes || (() => {}), resetWorkflow: ctx?.resetWorkflow || (() => {}) };
}

// Segmented EN / NE switch — use everywhere (header, login, profile)
export function LangSwitch({ compact = false }) {
  const { lang, setLanguage } = useApp();
  const btn = (l, label) => (
    <button
      key={l}
      onClick={() => setLanguage(l)}
      aria-pressed={lang === l}
      className={`rounded-md px-2.5 py-1 text-xs font-bold transition ${lang === l ? "bg-nepal-crimson text-white shadow" : "text-slate-600 hover:bg-slate-100"}`}
    >
      {label}
    </button>
  );
  return (
    <div className={`no-print flex items-center gap-0.5 rounded-lg border border-slate-300 bg-white p-0.5 ${compact ? "scale-90" : ""}`} role="group" aria-label="Language / भाषा">
      {btn("ne", "नेपाली")}
      {btn("en", "EN")}
    </div>
  );
}
