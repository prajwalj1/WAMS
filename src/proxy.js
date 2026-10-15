import { NextResponse } from "next/server";

// Login-first gate (runs on the server, before any page/API renders).
// Requires the wmams-auth session cookie set at login. No cookie → pages
// bounce to /login, data APIs get 401. /api/seed stays cookie-public so an
// empty database can gain its first admin — the route itself enforces
// SUPER_ADMIN-only whenever any user exists. The cookie alone is a prototype
// marker — full sid-vs-Mongo validation still belongs server-side (see
// src/app/api/auth/* + src/lib/auth-mock.js + src/lib/api-auth.js); the client Shell re-checks
// sessionStorage sid + cookie as defence in depth.
// /api/validate stays cookie-public: logged-out flows (login, forgot-password)
// need the same server-side re-validation as every other form.
const PUBLIC_API_PREFIXES = ["/api/auth", "/api/seed", "/api/health", "/api/openapi", "/api/calendar", "/api/validate"];

export default function proxy(req) {
  const { pathname } = req.nextUrl;
  const authed = req.cookies.get("wmams-auth")?.value === "1";

  if (PUBLIC_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/")) {
    if (!authed) return NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
    return NextResponse.next();
  }
  const isAuthPage = pathname.startsWith("/login") || pathname.startsWith("/reset-password");
  // NOTE: /login always renders (no authed→/ redirect here) — the login page
  // itself skips to the dashboard only when BOTH sessionStorage sid and cookie
  // exist. Redirecting authed /login → / server-side ping-pongs with the Shell
  // client gate when the cookie is stale (sid gone) → ERR_TOO_MANY_REDIRECTS.
  if (!authed && !isAuthPage) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|images|fonts).*)"],
};
