import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { getModel } from "@/lib/models";

// GET /api/calendar/bs — BS calendar table for the client (loads once,
// caches). Served strictly from the Mongo `lookups` collection
// ({ key: "bsCalendar" }) — no file fallback. Empty table when unconfigured.
let cached = null;
export async function GET() {
  if (!cached) {
    try {
      await dbConnect();
      const doc = await getModel("lookups").findOne({ key: "bsCalendar" }).lean();
      cached = doc?.value || { months: [], years: {} };
    } catch {
      cached = { months: [], years: {} };
    }
  }
  return NextResponse.json({ ok: true, calendar: cached });
}
