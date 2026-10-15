import { NextResponse } from "next/server";
import { consumePasswordReset, setPassword } from "@/lib/auth-mock";
import { checkPassword } from "@/lib/business-rules";

// POST /api/auth/password/reset { username, token, newPassword } —
// self-service forgot-password redemption (no session: the caller is logged
// out). The single-use reset token (issued by POST /api/auth/reset, 15-min
// TTL) gates the change; unknown/expired tokens read as INVALID_TOKEN /
// TOKEN_EXPIRED so usernames can't be enumerated through this endpoint.
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  if (!body.username || !body.token || !body.newPassword) {
    return NextResponse.json({ ok: false, code: "MISSING_FIELDS" }, { status: 400 });
  }
  const t = consumePasswordReset(body.username, body.token);
  if (!t.ok) {
    const status = t.code === "TOKEN_EXPIRED" ? 410 : 401;
    return NextResponse.json({ ok: false, code: t.code }, { status });
  }
  const pwError = checkPassword(body.newPassword);
  if (pwError) {
    return NextResponse.json({ ok: false, code: pwError }, { status: 422 });
  }
  const out = await setPassword(body.username, body.newPassword);
  if (!out.ok) {
    const status = out.code === "UNKNOWN_USER" ? 404 : 503;
    return NextResponse.json(out, { status });
  }
  return NextResponse.json(out);
}
