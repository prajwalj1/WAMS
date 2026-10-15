"use client";
import { useState } from "react";
import Link from "next/link";
import { useApp } from "@/lib/store";
import { t, tx } from "@/lib/i18n";
import { Card, Table } from "@/components/ui";
import { useList, ListToolbar, Pager, exportCsv } from "@/components/list";
import { Field, ServerErrors, useForm, vRequired, vMinLen } from "@/components/forms";
import { useCollection, Loading } from "@/lib/use-data";
import { PERMS_BY_ROLE, canSeeAccount } from "@/lib/scope";
import { errMsg } from "@/lib/errors";
import { mergeEffective } from "@/lib/roles";
import { mutate } from "@/lib/mutate";

// §5 hierarchy: each level creates accounts in its own scope and can never
// grant a role with permissions it doesn't itself hold (no escalation:
// grantable = role perms ⊆ my perms). The PMO SUPER_ADMIN creates minister
// (MINISTRY_ADMIN) accounts ONLY — nothing else, not even another SUPER_ADMIN.
// Minister (MINISTRY_ADMIN) and SUPER_ADMIN accounts can ONLY be created by a
// Super Admin — everyone else gets those two roles filtered out of the dropdown.
const CREATORS = ["SUPER_ADMIN", "MINISTRY_ADMIN", "UNIT_HEAD", "SECTION_HEAD"];
const RESTRICTED = ["SUPER_ADMIN", "MINISTRY_ADMIN"];
const MINISTER_ROLE = "MINISTRY_ADMIN";
const grantableRoles = (myRole, myPerms, effective = null) => {
  const matrix = effective || PERMS_BY_ROLE;
  // SUPER_ADMIN (PMO): minister accounts only.
  if (myRole === "SUPER_ADMIN") return [MINISTER_ROLE];
  // Minister staffs departments/mahashakhas (UNIT_HEAD, SECTION_HEAD) plus
  // SUPER_ADMIN-managed custom roles within their own permission set. No
  // approvers, finance, staff, auditors or viewers; those come from below.
  if (myRole === "MINISTRY_ADMIN") {
    const customs = Object.keys(matrix).filter(
      (r) => !Object.keys(PERMS_BY_ROLE).includes(r) && !RESTRICTED.includes(r) && Array.isArray(matrix[r]) && matrix[r].every((p) => myPerms.includes(p))
    );
    return ["UNIT_HEAD", "SECTION_HEAD", ...customs];
  }
  // Department/mahashakha heads staff their own unit ONLY — section heads
  // (Tasks · TOR · activities · progress live there) plus the unit's finance
  // officer (bills/payments).
  if (myRole === "UNIT_HEAD") return ["SECTION_HEAD", "FINANCE_OFFICER"];
  // Section heads add their section's staff and accounts — STAFF only.
  if (myRole === "SECTION_HEAD") return ["STAFF"];
  if (myPerms.includes("*")) return Object.keys(matrix);
  return Object.keys(matrix).filter((r) => !RESTRICTED.includes(r) && (matrix[r] || []).every((p) => myPerms.includes(p)));
};

export default function Users() {
  const { lang, role, perms, user, toast } = useApp();
  const { data: USERS, loading, error, reload } = useCollection("users");
  const unitsQ = useCollection("units");
  const rolesQ = useCollection("roles");
  const canCreate = CREATORS.includes(role);
  const myPerms = perms || [];
  const effective = mergeEffective(rolesQ.data || []);
  const roles = grantableRoles(role, myPerms, effective);
  // Unit scope: SUPER_ADMIN anywhere; MINISTRY_ADMIN across units;
  // UNIT_HEAD (Department/Mahashakha) and SECTION_HEAD only inside their own
  // unit — heads staff their own sections, section heads their own staff.
  // De-duplicated by id — the collection may hold repeat-seeded rows.
  const allUnits = [...new Map((unitsQ.data || []).map((u) => [u.id ?? u._id, u])).values()];
  // Case-insensitive unit key match (ids may be `moics` while the profile
  // carries `MOICS`; legacy rows may carry only `code`).
  const normKey = (v) => String(v ?? "").trim().toLowerCase();
  const findUnit = (key) => {
    const k = normKey(key);
    if (!k) return null;
    return allUnits.find((u) => [u.id, u.code, u._id].filter(Boolean).some((x) => normKey(x) === k)) || null;
  };
  // Ministers staff department/mahashakha leadership ONLY — the Role picker
  // offers Department head / Mahashakha head (both saved as UNIT_HEAD);
  // Section is hidden at ministry level.
  const ministerDeptMode = role === "MINISTRY_ADMIN";
  // The ministry admin's own ministry unit doc (id/code/_id, then unit name,
  // then the single MINISTRY unit). Used for visibility AND for basing new
  // accounts — always the admin's own ministry, never blank, never a picker.
  const ministerUnitDoc = ministerDeptMode
    ? (findUnit(user?.unitId)
      || allUnits.find((u) => normKey(user?.unit || "") && (normKey(u.nameEn) === normKey(user.unit) || normKey(u.code) === normKey(user.unit)))
      || (allUnits.filter((u) => normKey(u.type) === "ministry").length === 1
        ? allUnits.find((u) => normKey(u.type) === "ministry")
        : null)
      || null)
    : null;
  const myMinistryKeys = new Set(
    [user?.unitId, ministerUnitDoc?.id, ministerUnitDoc?.code, ministerUnitDoc?._id].filter(Boolean).map(normKey)
  );
  // Ministers see department/mahashakha postings plus their own ministry
  // unit's accounts — never Super Admin or fellow ministers
  // (enforced server-side too; this keeps the UI honest). Unit type resolves
  // from the live units list; while it loads, fall back to leadership roles.
  // Unit heads see only their own unit's accounts.
  const unitsLoaded = !unitsQ.loading || allUnits.length > 0;
  const unitTypeOf = (uid) => allUnits.find((x) => [x.id, x.code, x._id].filter(Boolean).map(String).includes(String(uid || "")))?.type;
  const users = USERS.filter((u) => canSeeAccount(role, u.role))
    .filter((u) => !["UNIT_HEAD", "SECTION_HEAD"].includes(role) || u.unitId === user?.unitId)
    .filter((u) => {
      if (role !== "MINISTRY_ADMIN") return true;
      // Own ministry unit's accounts always stay visible (id, code or _id —
      // ids may be `moics` while the profile carries `MOICS`).
      if (u.unitId && myMinistryKeys.has(normKey(u.unitId))) return true;
      const t = unitTypeOf(u.unitId);
      if (t) return ["DEPARTMENT", "MAHASHAKHA"].includes(t);
      return !unitsLoaded ? ["UNIT_HEAD", "SECTION_HEAD"].includes(u.role) : false;
    });
  const unitChoices = ["UNIT_HEAD", "SECTION_HEAD"].includes(role)
    ? allUnits.filter((u) => u.id === user?.unitId)
    : allUnits;
  // Super Admin creates minister accounts — pick which unit the account
  // belongs to. Every active unit is offered and nothing is auto-assigned:
  // an unpicked unit blocks the save instead of silently falling back.
  const ministerOnly = roles.length === 1 && roles[0] === "MINISTRY_ADMIN";
  // Ministers staff department/mahashakha leadership ONLY — the Role picker
  // offers Department head / Mahashakha head (both saved as UNIT_HEAD);
  // Section is hidden at ministry level. The account's unit is ALWAYS the
  // ministry admin's own ministry unit (ministerUnitDoc above, or profile
  // fallback) — never a picker, never blank.
  // (ministerDeptMode, ministerUnitDoc and myMinistryKeys are defined above
  // with the visibility filter.)
  // The account's unit: ALWAYS the ministry admin's own ministry unit (doc,
  // or profile fallback when the units list doesn't know it). The server
  // accepts the minister's own unit.
  const ministerBaseUnit = ministerUnitDoc
    || (normKey(user?.unitId) ? { id: String(user.unitId).trim(), code: String(user.unitId).trim().toUpperCase(), nameEn: user.unit || String(user.unitId).trim(), type: "MINISTRY" } : null);
  const [showAdd, setShowAdd] = useState(false);
  const [msg, setMsg] = useState("");
  const f = useForm({ username: "", nameEn: "", role: "", unitId: "", mobile: "", password: "" },
    { username: vRequired, nameEn: vRequired, role: vRequired, password: vMinLen(10) });
  // Department/mahashakha and section heads staff their own level ONLY:
  // UNIT_HEAD creates SECTION_HEAD or FINANCE_OFFICER (role picker),
  // SECTION_HEAD creates STAFF (fixed) — exactly the grantableRoles above.
  // The account's unit is ALWAYS the creator's own department/mahashakha
  // (section/finance accounts carry the parent department or
  // mahashakha unit) — resolved like the ministry flow, never a picker.
  const headDeptMode = role === "UNIT_HEAD" || role === "SECTION_HEAD";
  const headRoleChoices = role === "UNIT_HEAD" ? ["SECTION_HEAD", "FINANCE_OFFICER"] : [];
  const headBaseUnit = headDeptMode
    ? (findUnit(user?.unitId)
      || allUnits.find((u) => normKey(user?.unit || "") && (normKey(u.nameEn) === normKey(user.unit) || normKey(u.code) === normKey(user.unit)))
      || (normKey(user?.unitId) ? { id: String(user.unitId).trim(), code: String(user.unitId).trim().toUpperCase(), nameEn: user.unit || String(user.unitId).trim() } : null))
    : null;
  const ctl = useList({
    rows: users,
    searchKeys: ["username", "name", "nameEn", "unit"],
    filters: [
      { key: "role", label: tx("भूमिका", "Role", lang), options: [...new Set(users.map((u) => u.role))].map((r) => ({ value: r, label: r })) },
      { key: "status", label: tx("स्थिति", "Status", lang), options: ["ACTIVE", "LOCKED"].map((s) => ({ value: s, label: s })) },
    ],
    // Serial by unit: accounts group under their unit, ordered by username
    // inside each unit. Unit sort is the default (first option).
    sortOptions: [
      { value: "unit", label: tx("एकाइ", "Unit", lang), get: (r) => `${r.unit || ""} ${r.username || ""}` },
      { value: "username", label: tx("प्रयोगकर्ता", "Username", lang), get: (r) => r.username },
    ],
  });
  // Hard delete is PMO-only and permanent: the server refuses your own
  // account and the last ACTIVE Super Admin (their sessions go too).
  const canDelete = role === "SUPER_ADMIN";
  const removeUser = async (u) => {
    try {
      if (!window.confirm(`${tx("पक्का मेट्ने?", "Delete for sure?", lang)} ${u.username}`)) return;
    } catch { return; }
    await mutate("/api/data/users", { method: "DELETE",
      body: { match: { username: u.username } },
      okMsg: `${u.username} · ${tx("खाता मेटियो", "Account deleted", lang)}`,
      toast, reload });
  };
  const add = async () => {
    setMsg("");
    if (USERS.some((u) => u.username.toLowerCase() === f.values.username.toLowerCase())) { setMsg("USERNAME_TAKEN"); return; }
    if (ministerDeptMode) {
      // Ministry Role picker holds the posting only — Department or
      // Mahashakha. Section is never offered here.
      if (!["DEPARTMENT", "MAHASHAKHA"].includes(String(f.values.role || "").toUpperCase())) { setMsg("ROLE_ESCALATION"); return; }
    } else if (headDeptMode) {
      // UNIT_HEAD picks SECTION_HEAD or FINANCE_OFFICER; SECTION_HEAD is
      // fixed to STAFF — nothing else, nothing to escalate.
      if (role === "UNIT_HEAD" && !headRoleChoices.includes(f.values.role)) { setMsg("ROLE_ESCALATION"); return; }
    } else if (!roles.includes(f.values.role)) { setMsg("ROLE_ESCALATION"); return; }
    const errs = f.validateClient();
    // Fixed-role flows (ministry postings, SECTION_HEAD → STAFF) carry no
    // role input — drop the required-role complaint for them. UNIT_HEAD now
    // picks SECTION_HEAD / FINANCE_OFFICER, so its role input is validated.
    if (ministerDeptMode || role === "SECTION_HEAD") delete errs.role;
    if (Object.keys(errs).length) return;
    const unit = ministerOnly
      ? (allUnits.find((u) => (u.id ?? u._id) === f.values.unitId))
      : ministerDeptMode
        ? ministerBaseUnit // always the admin's own ministry unit
        : headDeptMode
          ? headBaseUnit // always the creator's own department/mahashakha
          : (unitChoices.find((u) => u.id === (f.values.unitId || user?.unitId)) || unitChoices[0]);
    if (!unit) {
      // The creator's own profile carries no unit — the server checks YOUR unit
      // live from the database, so only PMO can fix this. After PMO sets it,
      // log out and log in again so the new unit takes effect.
      if ((ministerDeptMode || headDeptMode) && !normKey(user?.unitId) && !findUnit(user?.unitId)) {
        setMsg(tx("तपाईंको आफ्नै खातामा एकाइ छैन — पहिले PMO (Super Admin) लाई तपाईंको मन्त्रालय/एकाइ सेट गर्न लगाउनुहोस्, अनि लगआउट–लगइन गर्नुहोस्।", "Your own account has no unit — ask PMO (Super Admin) to set your ministry/unit first, then log out and log in again.", lang));
        return;
      }
      setMsg(`NO_UNIT — ${errMsg("NO_UNIT", lang)}`); return;
    }
    // Fixed roles: ministry postings save as UNIT_HEAD; SECTION_HEAD saves
    // STAFF; UNIT_HEAD saves the picked role (SECTION_HEAD / FINANCE_OFFICER,
    // validated above — authority matrix keys off role + unit type).
    const saveRole = ministerDeptMode ? "UNIT_HEAD" : role === "UNIT_HEAD" ? f.values.role : role === "SECTION_HEAD" ? "STAFF" : f.values.role;
    // Legacy unit rows may lack `id` — fall back to the code so the account
    // always gets a usable unit/scope instead of an empty one.
    const uid = unit.id || String(unit.code || "").toLowerCase();
    if (!uid) { setMsg(`NO_UNIT — ${errMsg("NO_UNIT", lang)}`); return; }
    const res = await mutate("/api/data/users", { method: "POST",
      body: { doc: {
        username: f.values.username, password: f.values.password,
        name: f.values.nameEn, nameEn: f.values.nameEn,
        unit: unit.nameEn || unit.code, unitId: uid,
        scopeUnitIds: [uid],
        role: saveRole,
        status: "ACTIVE", mfa: false, mobile: f.values.mobile || "",
      } },
      okMsg: `${f.values.username} · ${unit.nameEn || unit.code || ""} · ${tx("खाता बन्यो", "Account created", lang)}`,
      toast });
    if (!res.ok) {
      // UNAUTHENTICATED here means the server-side session is gone (expired
      // after 30 min idle, or wiped) even though the page is still open —
      // logging out and back in mints a fresh session.
      const code = res.code;
      if (code === "UNAUTHENTICATED") {
        setMsg("SESSION_EXPIRED — please log out and log in again");
        return;
      }
      // A denial here almost always means YOUR OWN account's unit doesn't
      // resolve server-side (or this tab logged in before PMO set it) —
      // say so directly instead of a bare code.
      if (code === "PERMISSION_DENIED" && (ministerDeptMode || headDeptMode)) {
        setMsg(`${code} — ${tx("तपाईंको खाताको एकाइ मिलेन: PMO ले तपाईंको एकाइ सेट गरेको छ भने लगआउट–लगइन गर्नुहोस्, नत्र PMO लाई एकाइ सेट गर्न लगाउनुहोस्।", "Your account's unit did not match: if PMO already set your unit, log out and log in again — otherwise ask PMO to set your unit.", lang)}`);
        return;
      }
      setMsg(code || "CREATE_FAILED");
      return;
    }
    setMsg(`✅ ${f.values.username} · ${unit.nameEn || unit.code || ""}`);
    f.set("username")(""); f.set("nameEn")(""); f.set("mobile")(""); f.set("password")("");
    reload();
    setShowAdd(false);
  };
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-black">{t("usersTitle", lang)}</h1>
      <Card title={tx("प्रत्येक तहले आफ्नै स्कोपमा खाता बनाउँछ", "Each level creates accounts in its own scope", lang)}
        action={canCreate ? <button onClick={() => setShowAdd((s) => !s)} className="rounded-lg bg-nepal-blue px-3 py-1.5 text-xs font-bold text-white">+ {tx("खाता", "Account", lang)}</button> : null}>
        {showAdd && canCreate && (
          <div className="mb-2 grid gap-2 rounded-lg bg-slate-50 p-2 sm:grid-cols-3">
            <Field label={tx("प्रयोगकर्ता नाम", "Username", lang)} error={f.errors.username} lang={lang} required><input value={f.values.username} onChange={f.set("username")} className="mt-1 w-full rounded-lg border px-2 py-1.5" /></Field>
            <Field label={tx("नाम", "Name", lang)} error={f.errors.nameEn} lang={lang} required><input value={f.values.nameEn} onChange={f.set("nameEn")} className="mt-1 w-full rounded-lg border px-2 py-1.5" /></Field>
            {ministerDeptMode ? (
            <>
            <Field label={tx("भूमिका", "Role", lang)} error={f.errors.role} lang={lang} required>
              <select value={f.values.role} onChange={f.set("role")} className="mt-1 w-full rounded-lg border px-2 py-1.5">
                <option value="">—</option>
                <option value="DEPARTMENT">{tx("विभाग प्रमुख", "Department head", lang)}</option>
                <option value="MAHASHAKHA">{tx("महाशाखा प्रमुख", "Mahashakha head", lang)}</option>
              </select>
            </Field>
            <div className="block text-xs font-bold">
              <span className="mb-1 block text-slate-600">{tx("एकाइ (स्वतः — तपाईंको मन्त्रालय)", "Unit (auto — your ministry)", lang)}</span>
              <p className="mt-1 rounded-lg border bg-white px-2 py-1.5 font-semibold text-slate-700">
                {ministerBaseUnit
                  ? `${ministerBaseUnit.nameEn || ministerBaseUnit.code} (${ministerBaseUnit.code || ministerBaseUnit.id})`
                  : (unitsQ.loading
                    ? tx("लोड हुँदै…", "Loading…", lang)
                    : tx("तपाईंको आफ्नै खातामा एकाइ छैन — PMO (Super Admin) लाई सम्पर्क गर्नुहोस्।", "Your own account has no unit — contact PMO (Super Admin).", lang))}
              </p>
            </div>
            </>
            ) : headDeptMode ? (
            <>
            {role === "UNIT_HEAD" ? (
            <Field label={tx("भूमिका", "Role", lang)} error={f.errors.role} lang={lang} required>
              <select value={f.values.role} onChange={f.set("role")} className="mt-1 w-full rounded-lg border px-2 py-1.5">
                <option value="">—</option>
                <option value="SECTION_HEAD">SECTION_HEAD ({tx("शाखा प्रमुख", "Section head", lang)})</option>
                <option value="FINANCE_OFFICER">FINANCE_OFFICER ({tx("लेखा अधिकृत", "Finance officer", lang)})</option>
              </select>
            </Field>
            ) : (
            <div className="block text-xs font-bold">
              <span className="mb-1 block text-slate-600">{tx("भूमिका", "Role", lang)}</span>
              <p className="mt-1 rounded-lg border bg-white px-2 py-1.5 font-semibold text-slate-700">
                {`STAFF (${tx("कर्मचारी", "Staff", lang)})`}
              </p>
            </div>
            )}
            <div className="block text-xs font-bold">
              <span className="mb-1 block text-slate-600">{tx("एकाइ (स्वतः — तपाईंको विभाग/महाशाखा)", "Unit (auto — your department/mahashakha)", lang)}</span>
              <p className="mt-1 rounded-lg border bg-white px-2 py-1.5 font-semibold text-slate-700">
                {headBaseUnit
                  ? `${headBaseUnit.nameEn || headBaseUnit.code} (${headBaseUnit.code || headBaseUnit.id})`
                  : (unitsQ.loading
                    ? tx("लोड हुँदै…", "Loading…", lang)
                    : tx("तपाईंको आफ्नै खातामा एकाइ छैन — PMO (Super Admin) लाई सम्पर्क गर्नुहोस्।", "Your own account has no unit — contact PMO (Super Admin).", lang))}
              </p>
            </div>
            </>
            ) : (
            <Field label={tx("भूमिका", "Role", lang)} error={f.errors.role} lang={lang} required>
              <select value={f.values.role} onChange={f.set("role")} className="mt-1 w-full rounded-lg border px-2 py-1.5">
                <option value="">—</option>
                {roles.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            )}
            {(ministerDeptMode || headDeptMode) ? null : (
            <Field label={tx("एकाइ", "Unit", lang)} error={f.errors.unitId} lang={lang} required>
              <select value={f.values.unitId} onChange={f.set("unitId")} className="mt-1 w-full rounded-lg border px-2 py-1.5">
                <option value="">—</option>
                {(ministerOnly ? allUnits : unitChoices).map((u, i) => <option key={`${u.id ?? u._id}-${i}`} value={u.id ?? u._id}>{u.nameEn} ({u.code})</option>)}
              </select>
              {ministerOnly && allUnits.length === 0 && <p className="mt-1 text-[11px] text-amber-700">{tx("सक्रिय एकाइ छैन — पहिले संगठनमा थप्नुहोस्/सक्रिय गर्नुहोस्।", "No active units — add or re-activate one under Organisation first.", lang)}</p>}
            </Field>
            )}
            <Field label={tx("मोबाइल", "Mobile", lang)} lang={lang}><input value={f.values.mobile} onChange={f.set("mobile")} placeholder="98XXXXXXXX" className="mt-1 w-full rounded-lg border px-2 py-1.5" /></Field>
            <Field label={tx("पासवर्ड (न्यूनतम १०)", "Password (min 10)", lang)} error={f.errors.password} lang={lang} required><input type="password" value={f.values.password} onChange={f.set("password")} className="mt-1 w-full rounded-lg border px-2 py-1.5" /></Field>
            <div className="flex items-end gap-2"><button onClick={add} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">{t("add", lang)}</button><ServerErrors errors={f.serverErrors} lang={lang} /></div>
          </div>
        )}
        {msg && <p className="mb-1 font-mono text-xs font-bold">{msg}</p>}
        {loading ? <Loading lang={lang} /> : error ? <Loading error={error} lang={lang} /> : <>
        <ListToolbar ctl={ctl} lang={lang}
          filters={[{ key: "role", label: tx("भूमिका", "Role", lang), options: [...new Set(users.map((u) => u.role))].map((r) => ({ value: r, label: r })) }]}
          sortOptions={[{ value: "unit", label: tx("एकाइ", "Unit", lang) }, { value: "username", label: tx("प्रयोगकर्ता", "Username", lang) }]}
          onExport={() => exportCsv("users", ["Username", "Name", "Unit", "Role", "Status"], ctl.pageRows.map((u) => [u.username, u.nameEn, u.unit, u.role, u.status]))} />
        <div className="mt-2">
        <Table cols={[tx("प्रयोगकर्ता", "Username", lang), tx("नाम", "Name", lang), tx("एकाइ", "Unit", lang), tx("भूमिका", "Role", lang), tx("स्थिति", "Status", lang), ""]}
          rows={ctl.pageRows.map((u) => [<Link key={u.username} href={`/users/${u.username}`} className="font-bold text-nepal-blue">{u.username}</Link>, lang === "ne" ? u.name : u.nameEn, u.unit, u.role, u.status,
            canDelete && u.username !== user?.username
              ? <button key={u.username + "x"} onClick={() => removeUser(u)} title={tx("स्थायी रूपमा मेट्नुहोस्", "Delete permanently", lang)} className="cursor-pointer text-xs font-bold text-red-700">🗑 {tx("मेट्नुहोस्", "Delete", lang)}</button> : null])} />
        </div>
        <Pager ctl={ctl} lang={lang} />
        </>}
      </Card>
    </div>
  );
}
