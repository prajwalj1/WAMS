"use client";
import { useState } from "react";
import Link from "next/link";
import { useApp, LangSwitch } from "@/lib/store";
import { t, tx } from "@/lib/i18n";
import { Field, ServerErrors, passwordLive, useForm, vPassword, vRequired } from "@/components/forms";

export default function ResetPassword() {
  const { lang } = useApp();
  const [done, setDone] = useState(false);
  const [sent, setSent] = useState(false);
  const [apiErr, setApiErr] = useState("");
  const [busy, setBusy] = useState(false);
  const u = useForm({ username: "" }, { username: vRequired });
  const f = useForm({ token: "", password: "", confirm: "" }, {
    token: vRequired,
    password: vPassword,
    confirm: (v, all) => (v === all.password ? null : "PASSWORD_MISMATCH"),
  });
  // Step 1: request a reset code. Unknown usernames are rejected outright
  // (UNKNOWN_USER — no code issued); only an existing ACTIVE account moves
  // to step 2 (code is single-use, 15-min TTL, printed to the dev terminal).
  const request = async () => {
    setApiErr("");
    if (Object.keys(u.validateClient()).length) return;
    setBusy(true);
    let out;
    try {
      out = await fetch("/api/auth/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u.values.username.trim() }) }).then((x) => x.json());
    } catch {
      setApiErr(tx("नेटवर्क असफल", "Network failed", lang));
      setBusy(false);
      return;
    }
    setBusy(false);
    if (!out.ok) {
      setApiErr({ UNKNOWN_USER: tx("प्रयोगकर्ता भेटिएन — नाम जाँच्नुहोस्", "Username not found — check the name", lang), ACCOUNT_LOCKED: tx("खाता लक छ — प्रशासकलाई सम्पर्क गर्नुहोस्", "Account locked — contact an administrator", lang) }[out.code] || out.code || "RESET_FAILED");
      return;
    }
    setSent(true);
  };
  // Step 2: redeem the code with a new password — this call really changes
  // the stored (scrypt-hashed) password.
  const go = async () => {
    setApiErr("");
    const r = await f.submit("reset-password");
    if (!r.ok) return;
    setBusy(true);
    let out;
    try {
      out = await fetch("/api/auth/password/reset", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: u.values.username.trim(), token: f.values.token.trim(), newPassword: f.values.password }) }).then((x) => x.json());
    } catch {
      setApiErr(tx("नेटवर्क असफल", "Network failed", lang));
      setBusy(false);
      return;
    }
    setBusy(false);
    if (!out.ok) {
      setApiErr({ INVALID_TOKEN: tx("गलत कोड — पुनः अनुरोध गर्नुहोस्", "Wrong code — request again", lang), TOKEN_EXPIRED: tx("म्याद सकियो — पुनः अनुरोध गर्नुहोस्", "Expired — request again", lang), PASSWORD_RULES: tx("न्यूनतम १०: ठूलो + सानो + अंक", "Min 10 chars: upper + lower + digit", lang), PASSWORD_COMMON: tx("सजिलो पासवर्ड — अर्को रोज्नुहोस्", "Too common — pick another", lang) }[out.code] || out.code || "RESET_FAILED");
      return;
    }
    setDone(true);
  };
  return (
    <div className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-4">
      <div className="flex justify-end"><LangSwitch /></div>
      <div className="mt-2 rounded-2xl border border-slate-200 bg-white p-6 shadow-lg">
        <h1 className="text-xl font-black">{tx("पासवर्ड सेट / रिसेट", "Set / reset password", lang)}</h1>
        <p className="text-xs text-slate-500">{tx("पहिले कोड माग्नुहोस्, अनि नयाँ पासवर्ड राख्नुहोस्", "Request a code first, then set a new password", lang)}</p>
        {done ? <p className="mt-4 font-bold text-emerald-600">✅ {tx("पासवर्ड परिवर्तन भयो — लगइन गर्नुहोस्", "Password changed — please log in", lang)} — <Link href="/login" className="text-nepal-blue underline">{tx("लगइन", "Login", lang)}</Link></p> : !sent ? (
          <div className="mt-4 space-y-3">
            <Field label={tx("प्रयोगकर्ता नाम", "Username", lang)} error={u.errors.username} lang={lang} required>
              <input value={u.values.username} onChange={u.set("username")} className="mt-1 w-full rounded-lg border px-3 py-2" />
            </Field>
            {apiErr && <p className="text-xs font-bold text-red-600">❌ {apiErr}</p>}
            <button onClick={request} disabled={busy} className="w-full rounded-lg bg-nepal-blue py-2.5 font-bold text-white disabled:opacity-40">{tx("रिसेट कोड पठाउनुहोस्", "Send reset code", lang)}</button>
            <p className="text-[11px] text-slate-500">{tx("सही प्रयोगकर्ता नाममा मात्र कोड जारी हुन्छ (dev: टर्मिनलमा हेर्नुहोस्)", "A code is issued only for a valid username (dev: check the terminal)", lang)}</p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-xs font-bold text-emerald-700">✅ {tx("कोड जारी भयो", "Code issued", lang)} — {u.values.username}{tx(" (dev: टर्मिनलमा हेर्नुहोस्)", " (dev: check the terminal)", lang)}</p>
            <Field label={tx("रिसेट कोड", "Reset code", lang)} error={f.errors.token} lang={lang} required>
              <input value={f.values.token} onChange={f.set("token")} placeholder="------" maxLength={6} inputMode="numeric" className="mt-1 w-full rounded-lg border px-3 py-2 text-center font-mono text-lg font-black tracking-[0.5em]" />
            </Field>
            <Field label={tx("नयाँ पासवर्ड", "New password", lang)} error={f.errors.password} lang={lang} required>
              <input type="password" value={f.values.password} onChange={f.set("password")} className="mt-1 w-full rounded-lg border px-3 py-2" />
              {passwordLive(f.values.password, lang)}
            </Field>
            <Field label={tx("पुनः लेख्नुहोस्", "Confirm", lang)} error={f.errors.confirm} lang={lang} required>
              <input type="password" value={f.values.confirm} onChange={f.set("confirm")} className="mt-1 w-full rounded-lg border px-3 py-2" />
            </Field>
            <ServerErrors errors={f.serverErrors} lang={lang} />
            {apiErr && <p className="text-xs font-bold text-red-600">❌ {apiErr}</p>}
            <button onClick={go} disabled={busy} className="w-full rounded-lg bg-nepal-blue py-2.5 font-bold text-white disabled:opacity-40">{t("save", lang)}</button>
            <button onClick={() => { setSent(false); setApiErr(""); }} className="w-full rounded-lg border py-2 text-xs font-bold">{tx("अर्को प्रयोगकर्ता / पुनः अनुरोध", "Different user / request again", lang)}</button>
          </div>
        )}
      </div>
    </div>
  );
}
