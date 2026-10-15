import { NextResponse } from "next/server";
import { unlock, lockState } from "@/lib/auth-mock";
import { requireSuperAdmin } from "@/lib/api-auth";

// POST /api/auth/unlock { username, sid? } — SUPER_ADMIN ONLY: admin unlock
// after 3 lockouts/24h. The caller's session must belong to an ACTIVE
// SUPER_ADMIN (Mongo-verified).
// GET /api/auth/unlock?user= — lock state (public; the login form needs it
// pre-auth to explain why a login is refused).
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const gate = await requireSuperAdmin(req, body);
  if (!gate.ok) return NextResponse.json({ ok: false, code: gate.code }, { status: gate.status });
  if (!body.username) return NextResponse.json({ ok: false, error: "MISSING_USER" }, { status: 400 });
  return NextResponse.json(await unlock(body.username));
}

export async function GET(req) {
  const user = new URL(req.url).searchParams.get("user") || "";
  return NextResponse.json(lockState(user));
}
