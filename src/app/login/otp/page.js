"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp, LangSwitch } from "@/lib/store";
import { t, tx } from "@/lib/i18n";
import { setSession } from "@/lib/session";

export default function Otp() {
  const { lang, applyProfile } = useApp();
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [otpUser, setOtpUser] = useState("");
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [wait, setWait] = useState(0);
  const r = useRouter();
  /* eslint-disable react-hooks/set-state-in-effect -- challenge id hydrates after mount; SSR renders logged-out state */
  useEffect(() => {
    try {
      setChallengeId(sessionStorage.getItem("wmams-challenge") || "");
      const raw = sessionStorage.getItem("wmams-pending-profile");
      if (raw) setOtpUser(JSON.parse(raw)?.username || "");
      // A code was just sent at login — honor the 60s resend gap instead of
      // letting the first click fail silently with no console output.
      const sentAt = Number(sessionStorage.getItem("wmams-otp-sent") || 0);
      if (sentAt) setWait(Math.max(0, 60 - Math.floor((Date.now() - sentAt) / 1000)));
    } catch {}
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  const verify = async () => {
    setErr("");
    setOkMsg("");
    // No challenge in this tab (opened here directly, or typed in another
    // tab — sessionStorage is per-tab): verifying would only answer
    // CHALLENGE_EXPIRED, so stop with the real cause instead.
    if (!challengeId) {
      setErr(tx("पहिले लगइन गर्नुहोस् — यो ट्याबमा चुनौती छैन", "Log in first — this tab has no challenge", lang));
      return;
    }
    const res = await fetch("/api/auth/otp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "verify", challengeId, code }) }).then((x) => x.json());
    if (!res.ok) {
      setErr({ OTP_INVALID: tx("गलत कोड", "Wrong code", lang), OTP_EXPIRED: tx("म्याद सकियो — पुनः पठाउनुहोस्", "Expired — resend", lang), OTP_ATTEMPTS: tx("३ प्रयास सकियो", "3 attempts used", lang), CHALLENGE_EXPIRED: tx("चुनौती सकियो — पुनः लगइन गर्नुहोस्", "Challenge gone — log in again", lang) }[res.code] || res.code);
      return;
    }
    setSession({ ...res.tokens, username: res.user?.username, profile: res.user });
    applyProfile(res.user);
    try { sessionStorage.removeItem("wmams-challenge"); sessionStorage.removeItem("wmams-pending-profile"); } catch {}
    r.push("/");
  };
  const resend = async () => {
    setErr("");
    setOkMsg("");
    let res;
    try {
      res = await fetch("/api/auth/otp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "resend", challengeId }) }).then((x) => x.json());
    } catch {
      setErr(tx("नेटवर्क असफल", "Network failed", lang));
      return;
    }
    if (!res.ok) {
      if (res.code === "RESEND_WAIT") {
        setErr(`${tx("पुनः पठाउन", "Resend in", lang)} ${res.retryAfterSec}s`);
        if (res.retryAfterSec) setWait(res.retryAfterSec);
      } else if (res.code === "CHALLENGE_EXPIRED") {
        setErr(tx("चुनौती सकियो — पुनः लगइन गर्नुहोस्", "Challenge gone — log in again", lang));
      } else {
        setErr(res.code || "RESEND_FAILED");
      }
      return;
    }
    // The previous code is now invalid — clear it so it can't be submitted
    // by mistake, and restart the 60s resend gap from this send.
    setCode("");
    setWait(60);
    setOkMsg(tx("नयाँ कोड पठाइयो — कन्सोलमा हेर्नुहोस् (F12 → Console)", "New code sent — check the console (F12 → Console)", lang));
    try { sessionStorage.setItem("wmams-otp-sent", String(Date.now())); } catch {}
    // DEV ONLY: SMS is mocked — print the re-sent OTP to the console.
    if (res.devCode) console.log(`%c[WMAMS OTP — dev only] challenge=${challengeId} code=${res.devCode}`, "font-weight:bold");
  };
  return (
    <div className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-4">
      <div className="flex justify-end"><LangSwitch /></div>
      <div className="mt-2 rounded-2xl border bg-white p-6 shadow-lg">
        <h1 className="text-xl font-black">{t("otpTitle", lang)}</h1>
        {otpUser && <p className="mt-1 text-sm font-bold text-nepal-blue">{otpUser}</p>}
        <p className="text-xs text-slate-500">{tx("OTP कन्सोलमा पठाइयो (F12 → Console) · ६ अंक · ५ मिनेट · ६० सेकेन्डपछि पुनः पठाउनुहोस्", "OTP sent to the console (F12 → Console) · 6-digit · 5 min · resend after 60s", lang)}</p>
        {!challengeId && <p className="mt-2 text-xs font-bold text-amber-600">{tx("पहिले लगइन गर्नुहोस्", "Log in first", lang)} — <a href="/login" className="text-nepal-blue underline">{tx("लगइनमा फर्कनुहोस्", "Back to login", lang)}</a></p>}
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="------" maxLength={6} inputMode="numeric" className="mt-4 w-full rounded-lg border px-3 py-3 text-center text-2xl font-black tracking-[0.5em]" />
        {err && <p className="mt-1 text-xs font-bold text-red-600">❌ {err}{String(err).includes("log in again") || String(err).includes("पुनः लगइन") ? <> — <a href="/login" className="text-nepal-blue underline">{tx("लगइन", "Login", lang)}</a></> : null}</p>}
        {okMsg && <p className="mt-1 text-xs font-bold text-emerald-600">✅ {okMsg}</p>}
        <button onClick={verify} disabled={code.length !== 6 || !challengeId} className="mt-4 w-full rounded-lg bg-nepal-crimson py-2.5 font-bold text-white disabled:opacity-40">{tx("प्रमाणित गर्नुहोस् र प्रवेश", "Verify & Enter", lang)}</button>
        <button onClick={resend} disabled={wait > 0 || !challengeId} className="mt-2 w-full rounded-lg border py-2 text-xs font-bold disabled:opacity-40">
          {wait > 0 ? `${tx("पुनः पठाउन", "Resend in", lang)} ${wait}s` : tx("पुनः पठाउनुहोस्", "Resend code", lang)}
        </button>
        <p className="mt-2 text-center text-xs text-slate-500">{tx("अन्तिम टिप्पणी निर्णय · भूमिका प्रदानमा पनि Step-up OTP", "Step-up OTP also for final Tippani decision · role grants", lang)}</p>
      </div>
    </div>
  );
}
