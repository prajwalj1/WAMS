"use client";
import { useEffect, useState } from "react";
import { useApp, LangSwitch } from "@/lib/store";
import { t, tx } from "@/lib/i18n";
import { Card, Table } from "@/components/ui";
import { Field, ServerErrors, useForm, vRequired } from "@/components/forms";
import { getSid, getUsername } from "@/lib/session";
import { useCollection } from "@/lib/use-data";
import { mutate } from "@/lib/mutate";

export default function Profile() {
  const { lang, user, toast } = useApp();
  const [sessions, setSessions] = useState([]);
  const usersQ = useCollection("users");
  const me = getUsername() || user?.username || "";
  const myRecord = (usersQ.data || []).find((x) => x.username === me);
  const f = useForm({ phone: myRecord?.mobile || "", langPref: lang, dateStyle: "BS", password: "" }, { phone: vRequired });
  const mySid = getSid();
  useEffect(() => {
    fetch(`/api/auth/sessions?user=${me}`).then((r) => r.json()).then((d) => setSessions(d.sessions || [])).catch(() => {});
  }, [me]);
  const load = () => fetch(`/api/auth/sessions?user=${me}`).then((r) => r.json()).then((d) => setSessions(d.sessions || [])).catch(() => {});
  const signOutOthers = async () => {
    for (const s of sessions.filter((x) => x.sid !== mySid)) {
      await fetch("/api/auth/sessions", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ sid: s.sid, user: me }) });
    }
    load();
    toast(tx("अरू सत्र बन्द", "Other sessions signed out", lang));
  };
  // Friendly reason for each token failure — never a raw code alone.
  const tokenMsg = (code) => ({
    OTP_REQUIRED: tx("OTP आवश्यक — पहिले OTP पठाउनुहोस्", "OTP required — send an OTP first", lang),
    TOKEN_MISMATCH: tx("OTP कोड मिलेन — कन्सोल हेर्नुहोस्", "OTP is wrong code — check console", lang),
    OTP_EXPIRED: tx("OTP म्याद सकियो — फेरि पठाउनुहोस्", "OTP expired — send again", lang),
    STEP_UP_REQUIRED: tx("टोकन मान्य छैन", "Token is not valid", lang),
  }[code] || code);
  // PMO password change via received OTP only: request a single-use step-up
  // token, enter the received OTP alongside the new password. No OTP, no change.
  const [otpState, setOtpState] = useState({ sent: false, code: "", msg: "" });
  const sendOtp = async () => {
    setOtpState({ sent: false, code: "", msg: "" });
    const r = await fetch("/api/auth/stepup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: me, purpose: "password-change" }) }).then((x) => x.json()).catch(() => ({}));
    if (!r.otpToken) { setOtpState({ sent: false, code: "", msg: "OTP_FAILED" }); return; }
    try { console.log(`%c[WMAMS OTP — dev only] user=${me} token=${r.otpToken}`, "font-weight:bold"); } catch {}
    setOtpState({ sent: true, code: "", msg: tx("OTP पठाइयो — कन्सोल हेर्नुहोस् (F12) · ५ मिनेट मान्य", "OTP sent — check the console (F12) · valid 5 min", lang) });
  };
  const changePassword = async () => {
    if (String(f.values.password || "").length < 10) { setOtpState((s) => ({ ...s, msg: tx("न्यूनतम १० अक्षर चाहिन्छ", "Minimum 10 characters required", lang) })); return; }
    if (!otpState.code.trim()) { setOtpState((s) => ({ ...s, msg: "OTP_REQUIRED" })); return; }
    // Token validity is decided server-side; failures toast the exact
    // reason (mismatch / expired) and change nothing in the database.
    // The success toast below fires ONLY on an actual DB change.
    const r = await mutate("/api/auth/password/change", { method: "POST",
      body: { username: me, newPassword: f.values.password, otpToken: otpState.code.trim() } });
    if (!r.ok) {
      const m = tokenMsg(r.code);
      setOtpState((s) => ({ ...s, msg: m }));
      toast(m, "err");
      return;
    }
    f.set("password")("");
    setOtpState({ sent: false, code: "", msg: "" });
    toast(tx("पासवर्ड परिवर्तन भयो", "Password changed", lang));
  };
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-black">{tx("मेरो प्रोफाइल", "My profile", lang)}</h1>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title={tx("सम्पर्क विवरण", "Contact details", lang)}>
          <div className="space-y-3">
            <p className="text-sm"><b>{user.nameEn}</b> · {user.unit}</p>
            <Field label={tx("मोबाइल", "Phone", lang)} error={f.errors.phone} lang={lang} required>
              <input value={f.values.phone} onChange={f.set("phone")} className="mt-1 w-full rounded-lg border px-3 py-2" />
            </Field>
            <div className="flex flex-wrap gap-3 text-xs">
              <label className="font-bold">{tx("भाषा", "Language", lang)} <LangSwitch compact /></label>
            </div>

            <Field label={tx("पासवर्ड परिवर्तन (OTP आवश्यक)", "Change password (OTP required)", lang)} lang={lang}>
              <div className="mb-1 text-xs text-slate-500">{tx("खाता", "Account", lang)}: <b className="font-mono">{me || "—"}</b></div>
              <input type="password" value={f.values.password} onChange={f.set("password")} placeholder="••••••••••" disabled={otpState.code.replace(/\D/g, "").length !== 6} className="mt-1 w-full rounded-lg border px-3 py-2 disabled:bg-slate-100" />
            </Field>
            <div className="flex flex-wrap items-end gap-2">
              <button onClick={sendOtp} className="rounded-lg border px-4 py-2 text-xs font-bold">{tx("OTP पठाउनुहोस्", "Send OTP", lang)}</button>
              {otpState.sent && (
                <input value={otpState.code} onChange={(e) => setOtpState((s) => ({ ...s, code: e.target.value.replace(/\D/g, "").slice(0, 6) }))} placeholder="------" maxLength={6} inputMode="numeric" className="w-36 rounded-lg border px-3 py-2 text-center font-mono text-xs tracking-[0.3em]" />
              )}
              <button onClick={changePassword} disabled={!otpState.sent || otpState.code.replace(/\D/g, "").length !== 6} className="rounded-lg bg-nepal-blue px-4 py-2 text-xs font-bold text-white disabled:opacity-40">{tx("OTP बाट परिवर्तन", "Change with OTP", lang)}</button>
            </div>
            {otpState.msg && <p className="mt-1 font-mono text-xs font-bold">{otpState.msg}</p>}
            <ServerErrors errors={f.serverErrors} lang={lang} />
          </div>
        </Card>
        <Card title={tx("सक्रिय सत्रहरू", "Active sessions", lang)} action={<button onClick={signOutOthers} className="rounded-lg border px-3 py-1.5 text-xs font-bold">{tx("अरू सबै साइन आउट", "Sign out others", lang)}</button>}>
          <Table cols={[tx("यन्त्र", "Device", lang), "IP", tx("सुरु", "Started", lang), tx("सक्रिय", "Last active", lang), ""]} rows={sessions.map((s) => [`${s.device}${s.sid === mySid ? ` (${tx("हाल", "current", lang)})` : ""}`, s.ip, s.created, s.lastSeen || "—", ""])} />
          {sessions.length === 0 && <p className="text-xs text-slate-400">{tx("लगइनपछि यहाँ देखिन्छ (३० मिनेट निष्क्रिय / ७ दिन सीमा)", "Shows after login (30 min idle / 7 day limit)", lang)}</p>}
        </Card>
      </div>
    </div>
  );
}
