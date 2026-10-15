import { NextResponse } from "next/server";
import { toOpenApi } from "@/lib/api-manifest";

// Serves the API contract (§24: REST · OpenAPI). Planned paths are marked
// x-status so codegen/clients can distinguish live from NestJS-target routes.
export async function GET() {
  return NextResponse.json(toOpenApi());
}
