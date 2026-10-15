"use client";
import { useState } from "react";
import { tx } from "@/lib/i18n";
import { errMsg } from "@/lib/errors";

// ── Client validators (mirror server: POST /api/validate re-checks) ─────────
export const vRequired = (v) => (String(v ?? "").trim() ? null : "REQUIRED");
export const vMinLen = (n) => (v) => (String(v || "").length >= n ? null : "MIN_LENGTH");
export const vPassword = (v) => {
  const s = String(v || "");
  if (s.length < 10) return "PASSWORD_RULES";
  if (!/[A-Z]/.test(s) || !/[a-z]/.test(s) || !/[0-9]/.test(s)) return "PASSWORD_RULES";
  return null;
};
export const vOtp = (v) => (/^\d{6}$/.test(String(v || "")) ? null : "OTP_RULES");
export const vRange = (min, max) => (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return "OUT_OF_RANGE";
  return null;
};

export const FORM_ERR = {
  REQUIRED: { ne: "आवश्यक छ", en: "Required" },
  MIN_LENGTH: { ne: "छोटो भयो", en: "Too short" },
  PASSWORD_RULES: { ne: "न्यूनतम १०: ठूलो + सानो + अंक", en: "Min 10 chars: upper + lower + digit" },
  OTP_RULES: { ne: "६ अंकको कोड", en: "6-digit code" },
  OUT_OF_RANGE: { ne: "सीमा बाहिर", en: "Out of range" },
};

export function Field({ label, error, children, lang = "en", required = false }) {
  const msg = error && (FORM_ERR[error]?.[lang] || errMsg(error, lang));
  return (
    <label className="block text-xs font-bold">
      <span className="mb-1 block text-slate-600">
        {label}
        {required && <span className="ml-0.5 text-red-600" aria-hidden="true">*</span>}
        {required && <span className="sr-only">{lang === "ne" ? "(अनिवार्य)" : "(required)"}</span>}
      </span>
      {children}
      {msg && <span className="mt-0.5 block font-bold text-red-600">❌ {msg}</span>}
    </label>
  );
}

// useForm: values + per-field rules; validate() returns {ok, errors}.
// submit() runs client checks, then POSTs to /api/validate for server re-check.
export function useForm(initial, rules = {}) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [serverErrors, setServerErrors] = useState([]);
  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e?.target ? e.target.value : e }));

  const validateClient = () => {
    const errs = {};
    for (const [k, fns] of Object.entries(rules)) {
      for (const fn of [].concat(fns)) {
        const code = fn(values[k], values);
        if (code) { errs[k] = code; break; }
      }
    }
    setErrors(errs);
    return errs;
  };

  const submit = async (form, extra = {}) => {
    const errs = validateClient();
    if (Object.keys(errs).length) return { ok: false, stage: "client", errors: errs };
    try {
      const res = await fetch("/api/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ form, payload: { ...values, ...extra } }),
      });
      const data = await res.json();
      if (!data.ok) setServerErrors(data.errors || []);
      else setServerErrors([]);
      return data;
    } catch {
      return { ok: false, stage: "server", errors: ["SERVER_UNREACHABLE"] };
    }
  };

  return { values, set, errors, serverErrors, validateClient, submit };
}

export function ServerErrors({ errors = [], lang = "en" }) {
  if (!errors.length) return null;
  return (
    <div className="rounded-lg border border-red-300 bg-red-50 p-2 text-xs font-bold text-red-700">
      {errors.map((e, i) => <div key={i}>❌ {typeof e === "string" ? e : `${e.code} — ${errMsg(e.code, lang)}`}</div>)}
    </div>
  );
}

// Summary at the top for long forms — field messages stay next to fields too.
export function ErrorSummary({ errors = {}, lang = "en" }) {
  const keys = Object.keys(errors);
  if (!keys.length) return null;
  return (
    <div className="rounded-lg border border-red-300 bg-red-50 p-2 text-xs font-bold text-red-700" role="alert">
      <div className="mb-1">{tx("फारममा त्रुटि", "Form has errors", lang)} ({keys.length})</div>
      <ul className="list-inside list-disc">
        {keys.map((k) => <li key={k}>{k}: {FORM_ERR[errors[k]]?.[lang] || errMsg(errors[k], lang)}</li>)}
      </ul>
    </div>
  );
}

export function passwordLive(pw, lang = "en") {
  const s = String(pw || "");
  const checks = [
    [s.length >= 10, tx("न्यूनतम १० अक्षर", "Min 10 chars", lang)],
    [/[A-Z]/.test(s), "A–Z"],
    [/[a-z]/.test(s), "a–z"],
    [/[0-9]/.test(s), "0–9"],
  ];
  return (
    <ul className="mt-1 space-y-0.5 text-[11px]">
      {checks.map(([ok, l], i) => <li key={i} className={ok ? "font-bold text-emerald-600" : "text-slate-400"}>{ok ? "✅" : "○"} {l}</li>)}
    </ul>
  );
}
