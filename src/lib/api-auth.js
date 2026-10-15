// Server-only SUPER_ADMIN gate for privileged API routes.
// The session id arrives via the X-Sid header (attached by the API client)
// or `body.sid`. Identity and role resolve strictly from Mongo (sessions +
// users collections) via getSessionIdentity — client-sent role claims are
// never trusted. Import ONLY in API routes / server code.
import { getSessionIdentity } from "./auth-mock";

export function sidOf(req, body) {
  try {
    const h = req.headers.get("x-sid");
    if (h) return h;
  } catch {}
  return body?.sid || null;
}

// Returns { ok: true, identity } for an ACTIVE SUPER_ADMIN session,
// otherwise { ok: false, code, status } for the route to answer with.
export async function requireSuperAdmin(req, body) {
  const me = await getSessionIdentity(sidOf(req, body));
  if (!me) return { ok: false, code: "UNAUTHENTICATED", status: 401 };
  if (me.role !== "SUPER_ADMIN") return { ok: false, code: "PERMISSION_DENIED", status: 403 };
  return { ok: true, identity: me };
}

// Verified caller identity (or null) for routes that need the caller's
// role without requiring SUPER_ADMIN.
export async function callerIdentity(req, body) {
  return getSessionIdentity(sidOf(req, body));
}
