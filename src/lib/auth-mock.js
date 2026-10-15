// §28 authentication state machine.
// Credentials live in Mongo (users collection, scrypt passwordHash) — login
// succeeds ONLY on a database match. OTP challenges, lockout counters and
// step-up tokens stay ephemeral (in-memory); sessions persist in Mongo.
import { createHash, randomBytes } from "crypto";
import { verifyPassword, hashPassword } from "./password.js";

export const PRIVILEGED = ["SUPER_ADMIN", "MINISTRY_ADMIN", "APPROVER", "UNIT_HEAD", "SECTION_HEAD", "STAFF", "FINANCE_OFFICER"];
const OTP_TTL = 5 * 60 * 1000;
const RESEND_GAP = 60 * 1000;
const RESEND_MAX_HR = 5;
const FAIL_WINDOW = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

const profileOfDoc = (u) => {
  if (!u) return null;
  const scopes = (u.scopeUnitIds || []).filter(Boolean);
  return { username: u.username, role: u.role, unit: u.unit, unitId: u.unitId, scopeUnitIds: scopes.length ? scopes : (u.unitId ? [u.unitId] : []), unitType: u.unitType || null };
};

// Attach the unit TYPE (DEPARTMENT / MAHASHAKHA / …) to the login profile so
// the sidebar and dashboard know it on the very first render after refresh —
// without waiting for the units collection to load (which is what made the
// mahashakha menu visibly flip after every reload). Looks up by id or code;
// unknown units stay null and callers fall back to the live units list.
export async function profileWithUnitType(u) {
  const base = profileOfDoc(u);
  if (!base || base.unitType || !u?.unitId) return base;
  try {
    await dbConnect();
    const U = getModel("units");
    // Case-insensitive: unitId "dom" must match code "DOM".
    const rx = new RegExp(`^${String(u.unitId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    const found = await U.findOne({ $or: [{ id: rx }, { code: rx }] }).lean();
    if (found?.type) return { ...base, unitType: found.type };
  } catch {}
  return base;
}

const fails = new Map(); // username → [timestamps] (ephemeral; Redis-bound in prod)
const locks = new Map(); // username → lock state (ephemeral; Mongo-bound in prod)
// Login OTP challenges persist in Mongo (otpchallenges collection, TTL index)
// so they survive restarts and code reloads — like sessions, unlike the
// ephemeral step-up/reset maps below.
async function OtpChallenges() {
  await dbConnect();
  return getModel("otpchallenges");
}
const stepTokens = new Map(); // single-use step-up tokens (ephemeral by design)
const securityEvents = []; // reuse detections, lockouts (AUD-bound in prod)

// Sessions + refresh families persist in Mongo (sessions collection) so login
// survives restarts and every app instance sees the same state.
import { dbConnect } from "./db.js";
import { getModel } from "./models.js";
async function Sessions() {
  await dbConnect();
  return getModel("sessions");
}
async function Users() {
  await dbConnect();
  return getModel("users");
}

// Idle 30 min, absolute 7 days (configurable in prod).
const IDLE_MS = 30 * 60 * 1000;
const ABSOLUTE_MS = 7 * 86400000;

const now = () => Date.now();
const hash = (s) => createHash("sha256").update(String(s)).digest("hex").slice(0, 12);
const id = (p) => `${p}_${randomBytes(6).toString("hex")}`;

// Database-backed user lookup — the single source of truth for login.
// Returns the lean user doc or null (unknown user / DB unreachable reads as
// null; callers treat null as INVALID_CREDENTIALS, never as a bypass).
export async function getUser(username) {
  try {
    if (!username) return null;
    const U = await Users();
    return U.findOne({ username: String(username) }).lean();
  } catch {
    return null;
  }
}

function isLocked(username) {
  const l = locks.get(username);
  if (!l) return null;
  if (l.until === Infinity) return { locked: true, adminUnlock: true };
  if (l.until > now()) return { locked: true, retryAfterSec: Math.ceil((l.until - now()) / 1000) };
  locks.delete(username);
  return null;
}

function recordFail(username) {
  const t = now();
  const arr = [...(fails.get(username) || []), t].filter((x) => t - x < FAIL_WINDOW);
  fails.set(username, arr);
  if (arr.length >= 5) {
    const l = locks.get(username) || { count: 0, at: [] };
    l.at = [...(l.at || []), t].filter((x) => t - x < 86400000);
    l.count = l.at.length;
    l.until = l.count >= 3 ? Infinity : t + LOCK_MS;
    locks.set(username, l);
    fails.set(username, []);
    return { locked: true, adminUnlock: l.until === Infinity };
  }
  return { locked: false, remaining: 5 - arr.length };
}

export async function login({ username, password, device = "browser", ip = "127.0.0.1" }) {
  const locked = isLocked(username);
  if (locked) return { ok: false, code: "ACCOUNT_LOCKED", ...locked };
  // Strict database match: unknown username, inactive status, missing hash
  // or wrong password all fail — there is no fallback credential.
  const u = await getUser(username);
  if (!u) {
    const r = recordFail(username);
    return { ok: false, code: "INVALID_CREDENTIALS", ...(r.locked ? { locked: true } : { remaining: r.remaining }) };
  }
  if (u.status !== "ACTIVE") return { ok: false, code: "ACCOUNT_LOCKED", adminUnlock: true };
  if (!u.passwordHash || !verifyPassword(password, u.passwordHash)) {
    const r = recordFail(username);
    return { ok: false, code: "INVALID_CREDENTIALS", ...(r.locked ? { locked: true } : { remaining: r.remaining }) };
  }
  fails.set(username, []);
  const profile = await profileWithUnitType(u);
  if (PRIVILEGE_NEEDS_MFA(u)) {
    const ch = await issueChallenge(username);
    if (!ch.id) return { ok: false, code: "DB_UNAVAILABLE" };
    return { ok: true, mfaRequired: true, challengeId: ch.id, channel: "SMS", masked: u.mobile, user: profile, devCode: ch.code };
  }
  return { ok: true, tokens: await mintSession(username, device, ip), user: profile };
}

const PRIVILEGE_NEEDS_MFA = (u) => PRIVILEGED.includes(u.role);

async function issueChallenge(username) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const cid = id("ch");
  const t = now();
  try {
    const C = await OtpChallenges();
    await C.create({ cid, username, codeHash: hash(code), exp: new Date(t + OTP_TTL), attempts: 0, sentAt: new Date(t), sends: [new Date(t)] });
  } catch {
    return { id: null, code: null, dbDown: true };
  }
  // No SMS provider in dev — print the OTP to the terminal instead.
  console.log(`\n[WMAMS OTP] user=${username} code=${code} (challenge ${cid}, valid 5 min)\n`);
  return { id: cid, code };
}

export async function verifyOtp({ challengeId, code }) {
  if (!challengeId) return { ok: false, code: "CHALLENGE_EXPIRED" };
  let doc = null;
  try {
    doc = await (await OtpChallenges()).findOne({ cid: String(challengeId) });
  } catch {
    return { ok: false, code: "CHALLENGE_EXPIRED" };
  }
  if (!doc) return { ok: false, code: "CHALLENGE_EXPIRED" };
  if (new Date(doc.exp).getTime() < now()) { await doc.deleteOne().catch(() => {}); return { ok: false, code: "OTP_EXPIRED" }; }
  doc.attempts = (Number(doc.attempts) || 0) + 1;
  if (doc.attempts > 3) { await doc.deleteOne().catch(() => {}); return { ok: false, code: "OTP_ATTEMPTS" }; }
  if (doc.codeHash !== hash(code)) {
    await doc.save().catch(() => {});
    return { ok: false, code: "OTP_INVALID", remaining: 3 - doc.attempts };
  }
  const username = doc.username;
  await doc.deleteOne().catch(() => {});
  const u = await getUser(username);
  if (!u || u.status !== "ACTIVE") return { ok: false, code: "ACCOUNT_LOCKED", adminUnlock: true };
  return { ok: true, tokens: await mintSession(username, "browser", "127.0.0.1"), masked: u.mobile, user: await profileWithUnitType(u) };
}

export async function resendOtp({ challengeId }) {
  if (!challengeId) return { ok: false, code: "CHALLENGE_EXPIRED" };
  let doc = null;
  try {
    doc = await (await OtpChallenges()).findOne({ cid: String(challengeId) });
  } catch {
    return { ok: false, code: "CHALLENGE_EXPIRED" };
  }
  if (!doc || new Date(doc.exp).getTime() < now()) {
    if (doc) await doc.deleteOne().catch(() => {});
    return { ok: false, code: "CHALLENGE_EXPIRED" };
  }
  const t = now();
  const sends = (doc.sends || []).map((d) => new Date(d).getTime()).filter((x) => t - x < 3600000);
  if (t - new Date(doc.sentAt).getTime() < RESEND_GAP) return { ok: false, code: "RESEND_WAIT", retryAfterSec: Math.ceil((RESEND_GAP - (t - new Date(doc.sentAt).getTime())) / 1000) };
  if (sends.length >= RESEND_MAX_HR) return { ok: false, code: "RESEND_LIMIT" };
  const code = String(Math.floor(100000 + Math.random() * 900000));
  doc.codeHash = hash(code);
  doc.exp = new Date(t + OTP_TTL);
  doc.attempts = 0;
  doc.sentAt = new Date(t);
  doc.sends = [...sends.map((x) => new Date(x)), new Date(t)];
  await doc.save().catch(() => {});
  console.log(`\n[WMAMS OTP] user=${doc.username} code=${code} (challenge ${doc.cid}, re-sent, valid 5 min)\n`);
  return { ok: true, devCode: code };
}

// One session per user: a new login revokes every older sid for that
// username first, so only one device/tab stays valid at a time. Reduces
// session-table growth + concurrent polling load (N tabs → 1 live sid).
async function mintSession(username, device, ip) {
  const S = await Sessions();
  const sid = id("s");
  const t = new Date().toISOString();
  const refresh = randomBytes(32).toString("hex"); // 256-bit, HttpOnly cookie in prod
  await S.deleteMany({ username }).catch(() => {});
  await S.create({ sid, username, device, ip, created: t, lastSeen: t, refresh });
  return { access: `dev.${Buffer.from(JSON.stringify({ sub: username, sid })).toString("base64url")}.dev`, sid, refresh };
}

function sessionAlive(s) {
  const t = now();
  return t - new Date(s.lastSeen).getTime() < IDLE_MS && t - new Date(s.created).getTime() < ABSOLUTE_MS;
}

// Refresh rotation: single use. Reuse of an already-rotated token revokes the
// whole session and logs a security event.
export async function refresh({ sid, refresh: token }) {
  const S = await Sessions();
  const s = await S.findOne({ sid });
  if (!s) return { ok: false, code: "INVALID_REFRESH" };
  if (s.prevRefresh && s.prevRefresh === token) {
    // Replay of an already-rotated token → revoke whole session + event.
    await S.deleteOne({ sid });
    securityEvents.push({ at: new Date().toISOString(), code: "REFRESH_REUSE", username: s.username, sid });
    return { ok: false, code: "REUSE_DETECTED" };
  }
  if (s.refresh !== token) return { ok: false, code: "INVALID_REFRESH" };
  if (!sessionAlive(s)) {
    await S.deleteOne({ sid });
    return { ok: false, code: "SESSION_EXPIRED" };
  }
  const refresh2 = randomBytes(32).toString("hex");
  s.prevRefresh = s.refresh;
  s.refresh = refresh2;
  s.lastSeen = new Date().toISOString();
  await s.save();
  return { ok: true, tokens: { access: `dev.${Buffer.from(JSON.stringify({ sub: s.username, sid })).toString("base64url")}.dev`, sid, refresh: refresh2 } };
}

export function securityLog() {
  return securityEvents;
}

export async function listSessions(username) {

  const S = await Sessions();
  // Cull expired (idle 30m / absolute 7d) on read.
  const all = await S.find({ username }).lean();
  const dead = all.filter((s) => !sessionAlive(s)).map((s) => s.sid);
  if (dead.length) await S.deleteMany({ sid: { $in: dead } });
  return all.filter((s) => !dead.includes(s.sid)).map(({ sid, username: u, device, ip, created, lastSeen }) => ({ sid, username: u, device, ip, created, lastSeen }));
}

export async function revokeSession(sid, username) {
  const S = await Sessions();
  const s = await S.findOne({ sid });
  if (!s || (username && s.username !== username)) return false;
  await S.deleteOne({ sid });
  return true;
}

// Password reset: unknown usernames are rejected outright (UNKNOWN_USER) —
// no code is issued unless the account exists and is ACTIVE. NOTE: this
// reveals account existence (user enumeration); kept because operators
// asked for explicit feedback over the no-oracle reply.
// Active accounts get a single-use reset token (15-min TTL, prior tokens for
// the same user invalidated on re-issue). No SMS/email provider in dev — the
// token is printed to the terminal like OTP codes (email delivery is the
// prod path).
const RESET_TTL = 15 * 60 * 1000;
const resetTokens = new Map(); // token → { username, exp } (ephemeral by design)
export async function requestReset(username) {
  const u = await getUser(username);
  if (!u) return { ok: false, code: "UNKNOWN_USER" };
  if (u.status !== "ACTIVE") return { ok: false, code: "ACCOUNT_LOCKED", adminUnlock: true };
  for (const [tok, s] of resetTokens) {
    if (s.username === u.username) resetTokens.delete(tok);
  }
  // 6-digit code like the login OTP — regenerate on collision.
  let token = "";
  for (let i = 0; i < 10; i++) {
    token = String(Math.floor(100000 + Math.random() * 900000));
    if (!resetTokens.has(token)) break;
  }
  resetTokens.set(token, { username: u.username, exp: now() + RESET_TTL });
  console.log(`\n[WMAMS PASSWORD RESET] user=${u.username} code=${token} (valid 15 min, single use)\n`);
  return { ok: true, message: "Reset code issued" };
}
// Single-use consumption: wrong user, unknown or expired token all read as
// INVALID_TOKEN/TOKEN_EXPIRED (verified or expired tokens are consumed).
export function consumePasswordReset(username, token) {
  if (!username || !token) return { ok: false, code: "INVALID_TOKEN" };
  const s = resetTokens.get(String(token));
  if (!s || s.username !== String(username)) return { ok: false, code: "INVALID_TOKEN" };
  if (s.exp < now()) { resetTokens.delete(String(token)); return { ok: false, code: "TOKEN_EXPIRED" }; }
  resetTokens.delete(String(token)); // single use
  return { ok: true };
}

// Step-up OTP for sensitive actions (final Tippani decision, role grants,
// budget revision approval, password changes). 6-digit codes like login OTP
// (5-min TTL, single use); the client sends the received code back in
// X-OTP-Token and the server verifies it (428 otherwise).
export function issueStepUp(username, purpose) {
  let code = "";
  for (let i = 0; i < 5; i++) {
    code = String(Math.floor(100000 + Math.random() * 900000));
    if (!stepTokens.has(code)) break;
  }
  stepTokens.set(code, { username, exp: now() + OTP_TTL, purpose });
  // No SMS provider in dev — print the OTP to the terminal instead.
  console.log(`\n[WMAMS OTP] step-up user=${username} purpose=${purpose} code=${code} (valid 5 min, single use)\n`);
  return { otpToken: code, devNote: "dev prototype: 6-digit code issued without SMS" };
}
export function checkStepUp(token, username) {
  return verifyStepUp(token, username).ok;
}
// Reason-coded step-up verification: tells exactly why a token failed —
// missing, mismatched (unknown code or another user's), or expired.
// Single-use: a verified or expired token is consumed.
export function verifyStepUp(token, username) {
  if (!token) return { ok: false, code: "OTP_REQUIRED" };
  const s = stepTokens.get(token);
  if (!s || (username && s.username !== username)) return { ok: false, code: "TOKEN_MISMATCH" };
  if (s.exp < now()) { stepTokens.delete(token); return { ok: false, code: "OTP_EXPIRED" }; }
  stepTokens.delete(token); // single use
  return { ok: true };
}

export async function unlock(username) {
  locks.delete(username);
  fails.set(username, []);
  // Re-activate the database account too (best effort — the users page also
  // PATCHes status via the data API).
  try {
    const U = await Users();
    await U.updateOne({ username }, { $set: { status: "ACTIVE" } });
  } catch {}
  return { ok: true };
}

// Admin password set/reset — hashes with scrypt before saving. Plaintext
// passwords are never stored. Prototype note: route-level admin check still
// TODO (same as the unlock route); production requires it.
export async function setPassword(username, newPassword) {
  if (String(newPassword || "").length < 10) return { ok: false, code: "PASSWORD_RULES" };
  try {
    const U = await Users();
    const u = await U.findOne({ username });
    if (!u) return { ok: false, code: "UNKNOWN_USER" };
    u.passwordHash = hashPassword(newPassword);
    await u.save();
  } catch (e) {
    return { ok: false, code: "DB_UNAVAILABLE", message: e.message };
  }
  locks.delete(username);
  fails.set(username, []);
  return { ok: true };
}

export function lockState(username) {
  return { locked: !!isLocked(username), fails: (fails.get(username) || []).length };
}

// Server-side identity for role-gated API routes: validates the session id
// (exists + idle/absolute lifetime) and resolves the caller's live role from
// the users collection. Returns null unless the session belongs to an ACTIVE
// user. Never trusts client-sent role claims.
export async function getSessionIdentity(sid) {
  if (!sid) return null;
  try {
    const S = await Sessions();
    const s = await S.findOne({ sid }).lean();
    if (!s || !sessionAlive(s)) return null;
    const u = await getUser(s.username);
    if (!u || u.status !== "ACTIVE") return null;
    return { username: u.username, role: u.role, unitId: u.unitId, scopeUnitIds: u.scopeUnitIds || (u.unitId ? [u.unitId] : []) };
  } catch {
    return null;
  }
}
