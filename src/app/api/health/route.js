import { NextResponse } from "next/server";
import { envPresence } from "@/lib/env";

// Liveness/readiness for LB + monitoring (§36: GET /health, internal network).
// Includes live Mongo reachability (not just env presence) for diagnosis.
export async function GET() {
  let presence;
  try {
    presence = envPresence();
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
  let db = { reachable: false };
  try {
    const { dbConnect, connectedUri } = await import("@/lib/db");
    await dbConnect();
    const { getModel } = await import("@/lib/models");
    db = { reachable: true, uri: connectedUri(), works: await getModel("works").countDocuments() };
  } catch (e) {
    db = { reachable: false, error: e.message?.split("\n")[0] };
  }
  return NextResponse.json({
    ok: true,
    app: "wmams",
    version: "WMAMS-SPEC-001 v2.0",
    tz: presence.tz,
    uptimeSec: Math.round(process.uptime()),
    services: presence,
    db,
  });
}
