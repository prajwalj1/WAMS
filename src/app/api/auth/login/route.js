import { NextResponse } from "next/server";
import { login } from "@/lib/auth-mock";

// POST /api/auth/login { username, password, device? }
// → { mfaRequired, challengeId, channel, masked } for privileged roles,
//   { tokens } otherwise. 401 INVALID_CREDENTIALS / 423 ACCOUNT_LOCKED.
export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const out = await login({ username: body.username, password: body.password, device: body.device, ip: req.headers.get("x-forwarded-for") || "127.0.0.1" });
    if (!out.ok && out.code === "ACCOUNT_LOCKED") return NextResponse.json(out, { status: 423 });
    if (!out.ok && out.code === "DB_UNAVAILABLE") return NextResponse.json(out, { status: 503 });
    if (!out.ok) return NextResponse.json(out, { status: 401 });
    return NextResponse.json(out);
  } catch (e) {
    // Never an empty 500: the login form only understands JSON bodies.
    return NextResponse.json({ ok: false, code: "DB_UNAVAILABLE", message: e?.message || "login failed" }, { status: 503 });
  }
}
