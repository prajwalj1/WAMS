// Client-only mutation helper: every add / update / delete / deactivate in
// the project goes through here so each one (a) carries the session id for
// server-side permission checks, (b) shows a truthful toast only after the
// server answers, and (c) reloads the list on success. Import ONLY from
// client components.
import { getSid } from "./session";

function sid() {
  try { return getSid() || ""; } catch { return ""; }
}

// mutate(path, { method, body, okMsg, errMsg, toast, reload })
// → server JSON. Toasts okMsg on success, server code on failure.
export async function mutate(path, { method = "PATCH", body = {}, okMsg = "", errMsg = "", toast = null, reload = null } = {}) {
  const say = (m, k) => { try { toast && toast(m, k); } catch {} };
  let res = null;
  try {
    const s = sid();
    res = await fetch(path, {
      method,
      headers: { "content-type": "application/json", ...(s ? { "x-sid": s } : {}) },
      body: JSON.stringify({ ...(s ? { sid: s } : {}), ...body }),
    }).then((r) => r.json().catch(() => ({})));
  } catch {
    say(errMsg || "NETWORK_FAILED", "err");
    return { ok: false, code: "NETWORK_FAILED" };
  }
  const code = res?.error?.code || res?.code;
  if (res?.ok === false || code) {
    // Single-session: this sid was superseded by a newer login elsewhere.
    // Drop the stale tab session once and send the user to re-login —
    // no polling, only reacts when the server actually rejects a write.
    if (code === "UNAUTHENTICATED") {
      try {
        const { clearSession } = await import("./session");
        clearSession();
      } catch {}
      say("Signed in elsewhere — please log in again", "err");
      try {
        if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) window.location.href = "/login";
      } catch {}
      return { ...res, ok: false, code };
    }
    say(errMsg || code || "FAILED", "err");
    return { ...res, ok: false, code: code || "FAILED" };
  }
  if (okMsg) say(okMsg, "ok");
  try { reload && reload(); } catch {}
  return { ...res, ok: true };
}
