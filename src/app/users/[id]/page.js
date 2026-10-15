"use client";
import { use, useState } from "react";
import Link from "next/link";
import { useApp } from "@/lib/store";
import { tx } from "@/lib/i18n";
import { Card, Table } from "@/components/ui";
import { Field } from "@/components/forms";
import { useCollection, Loading } from "@/lib/use-data";
import { mutate } from "@/lib/mutate";
import { canSeeAccount } from "@/lib/scope";

export default function UserDetail({ params }) {
  const { lang, toast, role: myRole, user } = useApp();
  const { id } = use(params);
  const { data: USERS, loading, error, reload } = useCollection("users");
  const unitsQ = useCollection("units");
  // Same visibility rule as the list: ministers never resolve Super Admin
  // or fellow-minister accounts here either; heads only their own unit.
  const seed = USERS.filter((x) => canSeeAccount(myRole, x.role))
    .filter((x) => !["UNIT_HEAD", "SECTION_HEAD"].includes(myRole) || x.unitId === user?.unitId)
    .find((x) => x.username === id);
  const [roles, setRoles] = useState(null);
  const [status, setStatus] = useState(null);
  const cur = status ?? seed?.status;
  const roleRows = roles ?? (seed ? [{ role: seed.role, unit: seed.unit, until: "—" }] : []);
  const [msg, setMsg] = useState("");
  const act = (m) => { setMsg(m); setTimeout(() => setMsg(""), 2000); };
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [unitId, setUnitId] = useState(null);
  const [pwOtp, setPwOtp] = useState({ sent: false, code: "", msg: "" });
  const tokenMsg = (code) => ({
    OTP_REQUIRED: tx("OTP आवश्यक — पहिले OTP पठाउनुहोस्", "OTP required — send an OTP first", lang),
    TOKEN_MISMATCH: tx("OTP कोड मिलेन — कन्सोल हेर्नुहोस्", "OTP is wrong code — check console", lang),
    OTP_EXPIRED: tx("OTP म्याद सकियो — फेरि पठाउनुहोस्", "OTP expired — send again", lang),
    STEP_UP_REQUIRED: tx("टोकन मान्य छैन", "Token is not valid", lang),
  }[code] || code);
  const sendPwOtp = async () => {
    setPwOtp({ sent: false, code: "", msg: "" });
    const r = await fetch("/api/auth/stepup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: seed.username, purpose: "password-reset" }) }).then((x) => x.json()).catch(() => ({}));
    if (!r.otpToken) { setPwOtp({ sent: false, code: "", msg: "OTP_FAILED" }); return; }
    try { console.log(`%c[WMAMS OTP — dev only] user=${seed.username} token=${r.otpToken}`, "font-weight:bold"); } catch {}
    setPwOtp({ sent: true, code: "", msg: tx("OTP पठाइयो — कन्सोल हेर्नुहोस् (F12) · ५ मिनेट मान्य", "OTP sent — check the console (F12) · valid 5 min", lang) });
  };
  const setPasswordApi = async () => {
    setPwMsg("");
    if (String(newPw).length < 10) { setPwMsg(tx("न्यूनतम १० अक्षर चाहिन्छ", "Minimum 10 characters required", lang)); return; }
    if (!pwOtp.code.trim()) { setPwMsg("OTP_REQUIRED"); return; }
    const r = await mutate("/api/auth/password", { method: "POST",
      body: { username: seed.username, newPassword: newPw, otpToken: pwOtp.code.trim() } });
    if (r.ok) { setNewPw(""); setPwMsg(tx("पासवर्ड सेट भयो", "Password set", lang)); setPwOtp({ sent: false, code: "", msg: "" }); toast(tx("पासवर्ड सेट भयो", "Password set", lang)); }
    else { const m = tokenMsg(r.code); setPwMsg(`${tx("असफल", "Failed", lang)}: ${m}`); toast(m, "err"); }
  };
  const unlockApi = async () => {
    const r = await mutate("/api/auth/unlock", { method: "POST",
      body: { username: seed.username },
      okMsg: tx("अनलक भयो", "Unlocked", lang),
      toast });
    if (r.ok) {
      setStatus("ACTIVE");
      await mutate("/api/data/users", { method: "PATCH",
        body: { match: { username: seed.username }, update: { status: "ACTIVE" }, __v: seed.__v ?? 1 },
        toast, reload });
      act(tx("अनलक भयो (३ लकआउट रिसेट)", "Unlocked (lockouts cleared)", lang));
    }
  };
  const toggleLock = async () => {
    const next = cur === "ACTIVE" ? "LOCKED" : "ACTIVE";
    setStatus(next);
    await mutate("/api/data/users", { method: "PATCH",
      body: { match: { username: seed.username }, update: { status: next }, __v: seed.__v ?? 1 },
      okMsg: next === "ACTIVE" ? tx("खाता सक्रिय", "Account enabled", lang) : tx("खाता लक", "Account locked", lang),
      toast, reload });
    act("ok");
  };
  // Unit editing: PMO anywhere; ministry admins only within their own
  // ministry (DEPARTMENT / MAHASHAKHA units under it, or their own ministry
  // unit) — the account's unit stays based on the ministry admin's ministry.
  const allUnits = [...new Map((unitsQ.data || []).map((u) => [u.id ?? u._id, u])).values()];
  const normKey = (v) => String(v ?? "").trim().toLowerCase();
  const unitByKey = new Map();
  allUnits.forEach((u) => {
    [u.id, u.code, u._id].filter(Boolean).forEach((k) => {
      if (!unitByKey.has(normKey(k))) unitByKey.set(normKey(k), u);
    });
  });
  const myUnitDoc = unitByKey.get(normKey(user?.unitId))
    || allUnits.find((u) => normKey(user?.unit || "") && (normKey(u.nameEn) === normKey(user.unit) || normKey(u.code) === normKey(user.unit)))
    || null;
  const isUnderMyMinistry = (u) => {
    if (myRole !== "MINISTRY_ADMIN") return true;
    if (!myUnitDoc) return ["DEPARTMENT", "MAHASHAKHA"].includes(u.type);
    const mine = new Set([myUnitDoc.id, myUnitDoc.code, myUnitDoc._id].filter(Boolean).map(normKey));
    if (mine.has(normKey(u.id)) || mine.has(normKey(u.code))) return true;
    let cur = normKey(u.parent);
    let guard = 0;
    while (cur && guard++ < 10) {
      if (mine.has(cur)) return true;
      cur = normKey(unitByKey.get(cur)?.parent);
    }
    return false;
  };
  // Ministry choices: DEPARTMENT / MAHASHAKHA postings, preferred under
  // their ministry — with fallback to every unit of that type when parent
  // links are missing (plus their own ministry unit so an account can be
  // moved back). The unit stays based on the ministry admin's ministry.
  const ministryTypeUnits = allUnits.filter((u) => ["DEPARTMENT", "MAHASHAKHA"].includes(u.type));
  const ministryScopedUnits = ministryTypeUnits.filter(isUnderMyMinistry);
  const editableUnits = myRole === "SUPER_ADMIN"
    ? allUnits
    : myRole === "MINISTRY_ADMIN"
      ? [...(ministryScopedUnits.length ? ministryScopedUnits : ministryTypeUnits),
        ...(myUnitDoc && !(ministryScopedUnits.length ? ministryScopedUnits : ministryTypeUnits).some((u) => normKey(u.id) === normKey(myUnitDoc.id) || normKey(u.code) === normKey(myUnitDoc.code)) ? [myUnitDoc] : [])]
      : [];
  const curUnitId = unitId ?? seed?.unitId ?? "";
  const canEditUnit = myRole === "SUPER_ADMIN" || myRole === "MINISTRY_ADMIN";
  const saveUnit = async () => {
    const target = unitByKey.get(normKey(curUnitId));
    if (!target?.id && !target?.code) { setPwMsg("NO_UNIT"); return; }
    if (myRole === "MINISTRY_ADMIN" && !editableUnits.some((u) => normKey(u.id ?? u._id) === normKey(curUnitId) || normKey(u.code) === normKey(curUnitId))) {
      setPwMsg("OUT_OF_SCOPE"); return;
    }
    const uid = target.id || String(target.code || "").toLowerCase();
    await mutate("/api/data/users", { method: "PATCH",
      body: { match: { username: seed.username }, update: { unit: target.nameEn || target.code, unitId: uid, scopeUnitIds: [uid] }, __v: seed.__v ?? 1 },
      okMsg: `${target.nameEn || target.code} · ${tx("एकाइ अद्यावधिक", "Unit updated", lang)}`,
      toast, reload });
  };
  if (loading || unitsQ.loading) return <div className="space-y-3"><Card title="…"><Loading lang={lang} /></Card></div>;
  if (error || unitsQ.error || !seed) return <div className="space-y-3"><Card title="…"><Loading error={error || unitsQ.error || "NOT_FOUND"} lang={lang} /></Card></div>;
  return (
    <div className="space-y-3">
      <Link href="/users" className="text-xs font-bold text-nepal-blue">← {tx("प्रयोगकर्ता", "Users", lang)}</Link>
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <h1 className="text-lg font-black">{seed.nameEn} <span className="font-mono text-xs text-slate-400">{seed.username}</span></h1>
        <p className="text-xs text-slate-500">{seed.unit} · {seed.role} · {cur} · {seed.mobile}</p>
        <div className="no-print mt-2 flex flex-wrap gap-2 text-xs font-bold">
          <button onClick={toggleLock} className="rounded-lg border px-3 py-1.5">{cur === "ACTIVE" ? tx("लक", "Lock", lang) : tx("अनलक", "Unlock", lang)}</button>
          <button onClick={unlockApi} className="rounded-lg border px-3 py-1.5">{tx("प्रशासक अनलक (API)", "Admin unlock (API)", lang)}</button>
          <button onClick={() => act(tx("MFA रिसेट भयो", "MFA reset", lang))} className="rounded-lg border px-3 py-1.5">MFA {tx("रिसेट", "reset", lang)}</button>
          <button onClick={() => act(tx("स्थानान्तरण जाँच: खुला कार्य छैन", "Transfer check: no open items", lang))} className="rounded-lg border px-3 py-1.5">{tx("स्थानान्तरण", "Transfer", lang)}</button>
        </div>
        {msg && <p className="mt-1 text-xs font-bold text-emerald-600">✅ {msg}</p>}
      </div>
      {canEditUnit && (
      <Card title={tx("एकाइ परिवर्तन", "Change unit", lang)}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Field label={tx("एकाइ", "Unit", lang)} lang={lang} required>
              <select value={curUnitId || ""} onChange={(e) => setUnitId(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2">
                <option value="">—</option>
                {editableUnits.map((u, i) => <option key={`${u.id ?? u._id}-${i}`} value={u.id ?? u._id}>{u.nameEn} ({u.code}) · {u.type}</option>)}
              </select>
            </Field>
          </div>
          <button onClick={saveUnit} className="no-print shrink-0 rounded-lg bg-nepal-blue px-4 py-2 text-xs font-bold text-white">{tx("एकाइ सेभ", "Save unit", lang)}</button>
        </div>
        {myRole === "MINISTRY_ADMIN" && <p className="mt-1 text-[11px] text-slate-500">{tx("आफ्नै मन्त्रालयका विभाग/महाशाखा मात्र", "Only departments/mahashakhas under your own ministry", lang)}</p>}
        <p className="mt-1 text-xs text-slate-500">{tx("हाल", "Current", lang)}: {seed.unit}</p>
      </Card>
      )}
      <Card title={tx("पासवर्ड सेट / रिसेट (OTP आवश्यक)", "Set / reset password (OTP required)", lang)}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Field label={tx("नयाँ पासवर्ड (न्यूनतम १०)", "New password (min 10)", lang)} lang={lang} required>
              <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="••••••••••" className="mt-1 w-full rounded-lg border px-3 py-2" />
            </Field>
          </div>
          <button onClick={sendPwOtp} className="no-print shrink-0 rounded-lg border px-4 py-2 text-xs font-bold">{tx("OTP पठाउनुहोस्", "Send OTP", lang)}</button>
          {pwOtp.sent && <input value={pwOtp.code} onChange={(e) => setPwOtp((s) => ({ ...s, code: e.target.value.replace(/\D/g, "").slice(0, 6) }))} placeholder="------" maxLength={6} inputMode="numeric" className="no-print w-36 shrink-0 rounded-lg border px-3 py-2 text-center font-mono text-xs tracking-[0.3em]" />}
          <button onClick={setPasswordApi} disabled={!pwOtp.sent || pwOtp.code.replace(/\D/g, "").length !== 6} className="no-print shrink-0 rounded-lg bg-nepal-blue px-4 py-2 text-xs font-bold text-white disabled:opacity-40">{tx("पासवर्ड सेभ", "Save password", lang)}</button>
        </div>
        {pwOtp.msg && <p className="mt-1 font-mono text-xs font-bold">{pwOtp.msg}</p>}
        {pwMsg && <p className="mt-1 text-xs font-bold text-slate-600">{pwMsg}</p>}
      </Card>
      <Card title={tx("भूमिका नियुक्ति (थप्नुहोस्, समाप्त)", "Role assignments (add, end)", lang)}
        action={<button onClick={() => setRoles([...roleRows, { role: "STAFF", unit: seed.unit, until: "—" }])} className="rounded-lg bg-nepal-blue px-3 py-1.5 text-xs font-bold text-white">+ {tx("भूमिका", "Role", lang)}</button>}>
        <Table cols={[tx("भूमिका", "Role", lang), tx("एकाइ", "Unit", lang), tx("सम्म", "Until", lang), ""]} rows={roleRows.map((r, i) => [r.role, r.unit, r.until, <button key={i} onClick={() => setRoles(roleRows.filter((_, j) => j !== i))} className="text-xs font-bold text-red-600">{tx("समाप्त", "End", lang)}</button>])} />
      </Card>
    </div>
  );
}
