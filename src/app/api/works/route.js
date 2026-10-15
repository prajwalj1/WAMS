import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { getModel } from "@/lib/models";
import { enrichWorks } from "@/lib/metrics";
import { paginate, envelopeError } from "@/lib/api-helpers";

// §36 flagship list: GET /api/works?page=&pageSize=&sort=-deadline&q=&filter[status]=
// Scope filter applies (out-of-scope → excluded, never 404 on lists).
// Money as integer paisa (contractPaisa/budgetPaisa); dates AD.
export async function GET(req) {
  const url = new URL(req.url);
  const q = {
    page: url.searchParams.get("page"),
    pageSize: url.searchParams.get("pageSize"),
    sort: url.searchParams.get("sort"),
    q: url.searchParams.get("q"),
    filter: {},
  };
  for (const [k, v] of url.searchParams) {
    const m = /^filter\[(.+)\]$/.exec(k);
    if (m) q.filter[m[1]] = v;
  }
  const scope = url.searchParams.get("scope");
  try {
    await dbConnect();
  } catch (e) {
    return NextResponse.json({ error: { code: "DB_UNAVAILABLE", message: e.message } }, { status: 503 });
  }
  const match = { archivedAt: null };
  if (scope) match.orgAncestors = scope;
  const rows = enrichWorks(await getModel("works").find(match).lean(), new Date("2026-12-17"));
  const page = paginate(rows, q);
  if (q.pageSize && Number(q.pageSize) > 100) {
    const e = envelopeError("PAGE_SIZE_MAX", "Max pageSize 100", [{ field: "pageSize", code: "MAX" }], 400);
    return NextResponse.json(e.body, { status: e.status });
  }
  return NextResponse.json(page);
}
