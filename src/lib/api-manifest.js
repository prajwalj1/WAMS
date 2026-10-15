// API surface manifest (§24: REST · OpenAPI). One source of truth —
// GET /api/openapi serves it, /architecture renders it.
// status: "live" (implemented in this repo) | "planned" (NestJS API target).
export const API_INFO = { title: "WMAMS API", version: "0.1.0", base: "/api" };

export const ENDPOINTS = [
  { method: "GET", path: "/api/health", status: "live", module: "ops", summary: "Liveness/readiness + env presence (no secrets)" },
  { method: "POST", path: "/api/validate", status: "live", module: "shared", summary: "Server-side form re-validation (mirrors client)" },
  { method: "GET", path: "/api/openapi", status: "live", module: "ops", summary: "This manifest as OpenAPI 3.1" },
  { method: "POST", path: "/api/worker", status: "live", module: "worker", summary: "Run a background job inline (prototype of the queue worker)" },
  { method: "POST", path: "/api/auth/login", status: "live", module: "auth", summary: "Login → MFA challenge for privileged roles (§28 prototype)" },
  { method: "POST", path: "/api/auth/otp", status: "live", module: "auth", summary: "Verify (6-digit/5-min/3-tries) or resend (60s, 5/hr)" },
  { method: "POST", path: "/api/auth/reset", status: "live", module: "auth", summary: "Issue single-use reset token (UNKNOWN_USER unless the account exists)" },
  { method: "POST", path: "/api/auth/password/reset", status: "live", module: "auth", summary: "Redeem reset token + set new password (logged-out self-service)" },
  { method: "POST", path: "/api/auth/refresh", status: "live", module: "auth", summary: "Rotate pair; reuse revokes session (reuse detection)" },
  { method: "GET", path: "/api/auth/sessions", status: "live", module: "auth", summary: "Active sessions for a user" },
  { method: "DELETE", path: "/api/auth/sessions", status: "live", module: "auth", summary: "Revoke a session (sign out others)" },
  { method: "POST", path: "/api/auth/unlock", status: "live", module: "auth", summary: "Admin unlock after lockout (SUPER_ADMIN only)" },
  { method: "POST", path: "/api/auth/stepup", status: "live", module: "auth", summary: "Step-up OTP token for sensitive actions (428 otherwise)" },
  { method: "GET", path: "/api/works", status: "live", module: "work", summary: "§36 list: page/pageSize/sort/q/filter[], scope, paisa, envelope" },
  { method: "POST", path: "/api/tasks/:id/progress", status: "live", module: "progress", summary: "§30 seven-step update → 201 + recompute" },
  { method: "GET", path: "/api/engine", status: "live", module: "worker", summary: "§32 queue depth + snapshot count" },
  { method: "POST", path: "/api/documents/upload-url", status: "live", module: "documents", summary: "§34 checks + PENDING version + 5-min PUT url" },
  { method: "GET", path: "/api/calendar/bs", status: "live", module: "admin", summary: "§34 BS table for the client (loads once, caches)" },
  { method: "POST", path: "/api/auth/login", status: "planned", module: "auth", summary: "Username+password → OTP challenge (argon2, rate-limited)" },
  { method: "POST", path: "/api/auth/otp/verify", status: "planned", module: "auth", summary: "6-digit OTP → JWT access (15m) + rotating refresh (7d)" },
  { method: "GET", path: "/api/works", status: "planned", module: "work", summary: "Scoped list (role+unit filter before query)" },
  { method: "POST", path: "/api/works", status: "planned", module: "work", summary: "Create (BR-01, weights, budget guards)" },
  { method: "POST", path: "/api/works/:id/transition", status: "planned", module: "work", summary: "§11 transitions only; writes history + audit" },
  { method: "POST", path: "/api/tippani/:id/transition", status: "planned", module: "tippani", summary: "Route steps, OTP on final decision" },
  { method: "POST", path: "/api/expenditures", status: "planned", module: "budget", summary: "Enter as DRAFT/SUBMITTED (BR-06, BR-15)" },
  { method: "POST", path: "/api/expenditures/:id/verify", status: "planned", module: "budget", summary: "Finance verify (BR-12: not own)" },
  { method: "GET", path: "/api/progress/:workId", status: "planned", module: "progress", summary: "Expected/physical/financial + health (shared formulas)" },
  { method: "POST", path: "/api/documents/sign", status: "planned", module: "documents", summary: "Short-lived MinIO upload link (quarantine bucket)" },
  { method: "GET", path: "/api/audit", status: "planned", module: "audit", summary: "Insert-only trail, scoped search + export" },
  { method: "GET", path: "/api/reports/:code", status: "planned", module: "reports", summary: "PDF (Puppeteer) / Excel (ExcelJS), Noto/Mukta fonts" },
];

export function toOpenApi() {
  const paths = {};
  for (const e of ENDPOINTS) {
    const key = e.path.replace("/api", "") || "/";
    paths[key] = paths[key] || {};
    paths[key][e.method.toLowerCase()] = {
      summary: e.summary,
      tags: [e.module],
      ...(e.status === "planned" ? { "x-status": "planned — NestJS target" } : {}),
      responses: { 200: { description: "OK" } },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: API_INFO.title, version: API_INFO.version },
    servers: [{ url: API_INFO.base }],
    paths,
  };
}
