import { NextResponse } from "next/server";
import { refresh } from "@/lib/auth-mock";

// POST /api/auth/refresh { sid, refresh } — rotates the pair.
// Reusing an already-rotated token revokes the session (reuse detection).
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const out = await refresh(body);
  if (!out.ok) {
    const status = out.code === "REUSE_DETECTED" ? 403 : 401;
    return NextResponse.json(out, { status });
  }
  return NextResponse.json(out);
}
