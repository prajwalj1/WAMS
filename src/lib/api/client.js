// Typed API client (§26 apps/web/lib/api) — generated from the OpenAPI
// manifest shape in ../api-manifest.js. All calls attach the in-memory
// Bearer token; privileged routes additionally receive the session id
// (X-Sid) so the server can Mongo-verify a SUPER_ADMIN caller. 428
// STEP_UP_REQUIRED surfaces step-up explicitly.
import { authHeader, getSid } from "../session";

async function call(path, { method = "GET", body, otpToken } = {}) {
  let sid = "";
  try { sid = getSid() || ""; } catch {}
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", ...authHeader(), ...(sid ? { "X-Sid": sid } : {}), ...(otpToken ? { "X-OTP-Token": otpToken } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 428) return { ok: false, code: "STEP_UP_REQUIRED", ...data };
  return data;
}

/** @typedef {{ok:boolean, mfaRequired?:boolean, challengeId?:string, channel?:string, masked?:string, tokens?:{access:string, sid:string}}} LoginOut */
export const auth = {
  /** POST /api/auth/login */
  login: (username, password, device = "browser") => call("/api/auth/login", { method: "POST", body: { username, password, device } }),
  /** POST /api/auth/otp { action: verify|resend } */
  otp: (payload) => call("/api/auth/otp", { method: "POST", body: payload }),
  /** POST /api/auth/reset */
  reset: (username) => call("/api/auth/reset", { method: "POST", body: { username } }),
  /** POST /api/auth/refresh { sid, refresh } — rotates; reuse revokes session */
  refresh: (sid, refresh) => call("/api/auth/refresh", { method: "POST", body: { sid, refresh } }),
  /** GET /api/auth/sessions */
  sessions: (user) => call(`/api/auth/sessions?user=${encodeURIComponent(user)}`),
  /** DELETE /api/auth/sessions */
  revokeSession: (sid, user) => call("/api/auth/sessions", { method: "DELETE", body: { sid, user } }),
  /** POST /api/auth/unlock */
  unlock: (username) => call("/api/auth/unlock", { method: "POST", body: { username } }),
  /** POST /api/auth/stepup */
  stepUp: (username, purpose) => call("/api/auth/stepup", { method: "POST", body: { username, purpose } }),
};

export const validate = {
  /** POST /api/validate { form, payload } */
  check: (form, payload) => call("/api/validate", { method: "POST", body: { form, payload } }),
};

export const worker = {
  /** GET /api/worker — job catalogue */
  jobs: () => call("/api/worker"),
  /** POST /api/worker { job, snapshot? } */
  run: (job, snapshot) => call("/api/worker", { method: "POST", body: { job, snapshot } }),
};

export const ops = {
  /** GET /api/health */
  health: () => call("/api/health"),
  /** GET /api/openapi */
  openapi: () => call("/api/openapi"),
};
