"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApp, LangSwitch } from "@/lib/store";
import { t, tx } from "@/lib/i18n";
import { Field, ServerErrors, useForm, vRequired, vMinLen } from "@/components/forms";
import { setSession } from "@/lib/session";
import { auth } from "@/lib/api/client";

export default function Login() {
  const { lang, applyProfile } = useApp();
  const r = useRouter();
  const [apiErr, setApiErr] = useState("");
  const f = useForm({ username: "", password: "" }, { username: vRequired, password: vMinLen(10) });
  // Already logged in → skip login and go straight to the dashboard.
  useEffect(() => {
    try {
      const sid = sessionStorage.getItem("wmams-sid");
      const hasCookie = document.cookie.split(";").some((c) => c.trim().startsWith("wmams-auth=1"));
      if (sid && hasCookie) r.replace("/");
    } catch {}
  }, [r]);
  const go = async () => {
    setApiErr("");
    const client = f.validateClient();
    if (Object.keys(client).length) return;
    const res = await auth.login(f.values.username, f.values.password);
    if (!res.ok && !res.mfaRequired) {
      setApiErr(res.code === "ACCOUNT_LOCKED" ? tx("खाता लक — १५ मिनेट वा प्रशासक अनलक", "Account locked — 15 min or admin unlock", lang) : tx("गलत लगइन", "Invalid credentials", lang));
      return;
    }
    if (res.mfaRequired) {
      try {
        sessionStorage.setItem("wmams-challenge", res.challengeId);
        sessionStorage.setItem("wmams-otp-sent", String(Date.now()));
      } catch {}
      // DEV ONLY: SMS is mocked — print the OTP to the browser console.
      console.log(`%c[WMAMS OTP — dev only] challenge=${res.challengeId} code=${res.devCode}`, "font-weight:bold");
      // Profile lands after OTP; role-based dashboard follows.
      try { sessionStorage.setItem("wmams-pending-profile", JSON.stringify(res.user)); } catch {}
      r.push("/login/otp");
    } else {
      setSession({ ...res.tokens, username: f.values.username, profile: res.user });
      applyProfile(res.user);
      r.push("/");
    }
  };
  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-md flex-col justify-center px-3 py-6 sm:px-4">
      <div className="flex justify-end"><LangSwitch /></div>
      <div className="mt-2 rounded-2xl border border-slate-200 border-t-4 border-t-nepal-crimson bg-white p-4 shadow-lg sm:p-6">
        <div className="text-center">
          <img src="/images/logo.png" alt={lang === "ne" ? "नेपालको राष्ट्रिय चिन्ह" : "National emblem of Nepal"} className="mx-auto h-16 w-16 object-contain sm:h-20 sm:w-20" width={80} height={80} />
          <div className="mt-2 text-sm font-bold text-nepal-blue">🇳🇵 {t("gov", lang)}</div>
          <div className="text-xs font-semibold text-nepal-crimson">{t("pilot", lang)}</div>
          <h1 className="mt-1 break-words text-xl font-black">{t("loginTitle", lang)}</h1>
          <p className="text-xs text-slate-500">{tx("विशेष भूमिकालाई OTP चाहिन्छ · ६ अंक · ५ मिनेट", "Privileged roles require OTP · 6-digit · 5 min", lang)}</p></div>
        <div className="mt-4 space-y-2">
          <Field label={tx("प्रयोगकर्ता नाम", "Username", lang)} error={f.errors.username} lang={lang} required>
            <input value={f.values.username} onChange={f.set("username")} className="mt-1 w-full rounded-lg border px-3 py-2" />
          </Field>
          <Field label={tx("पासवर्ड (न्यूनतम १०, ठूलो+सानो+अंक)", "Password (min 10, upper+lower+digit)", lang)} error={f.errors.password} lang={lang} required>
            <input type="password" value={f.values.password} onChange={f.set("password")} className="mt-1 w-full rounded-lg border px-3 py-2" />
          </Field>
          <ServerErrors errors={f.serverErrors} lang={lang} />
          {apiErr && <p className="text-xs font-bold text-red-600">❌ {apiErr}</p>}
        </div>
        <button onClick={go} className="mt-4 w-full rounded-lg bg-nepal-blue py-2.5 font-bold text-white">{tx("लगइन → OTP", "Login → OTP", lang)}</button>
        <div className="mt-3 flex justify-between text-xs font-bold text-nepal-blue"><Link href="/login/otp">{tx("OTP पुनः पठाउनुहोस्", "Resend OTP", lang)}</Link><Link href="/reset-password">{tx("पासवर्ड बिर्सनुभयो?", "Forgot password?", lang)}</Link></div>
      </div>
    </div>
  );
}
