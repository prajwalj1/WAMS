import { NextResponse } from "next/server";
import { listSessions, revokeSession } from "@/lib/auth-mock";

// GET /api/auth/sessions?user= — active sessions (idle 30m / absolute 7d in prod).
// DELETE /api/auth/sessions { sid, user } — revoke (sign out others).
export async function GET(req) {
  const user = new URL(req.url).searchParams.get("user") || "";
  return NextResponse.json({ sessions: await listSessions(user) });
}

export async function DELETE(req) {
  const body = await req.json().catch(() => ({}));
  const ok = await revokeSession(body.sid, body.user);
  return NextResponse.json({ ok });
}
