// §35 Integration interfaces. Only interfaces are built now; each external
// system gets a TypeScript-style contract here plus a manual/Excel
// implementation the imports module uses. A real adapter slots in later
// without touching budget, procurement or tippani modules.

/**
 * @typedef {Object} BudgetLineInput
 * @typedef {Object} ExpenditureInput
 * @typedef {Object} TenderStatusInput
 * @typedef {{ref:string}} SendReceipt
 */

// BudgetSource (LMBIS): fetchAllocations(fy, unitCode) → BudgetLineInput[].
// Manual/Excel fallback: /imports budget_lines template.
export const manualBudgetSource = {
  async fetchAllocations() {
    return { ok: false, code: "ADAPTER_NOT_CONNECTED", fallback: "/imports (budget_lines)" };
  },
};

// ExpenditureSource (CGAS/FMIS): fetchVouchers(fy, since) → ExpenditureInput[].
export const manualExpenditureSource = {
  async fetchVouchers() {
    return { ok: false, code: "ADAPTER_NOT_CONNECTED", fallback: "/imports (expenditures)" };
  },
};

// TenderSource (e-GP): fetchTender(egpRef) → TenderStatusInput.
export const manualTenderSource = {
  async fetchTender(egpRef) {
    return { ok: false, code: "ADAPTER_NOT_CONNECTED", egpRef, fallback: "manual entry" };
  },
};

// SignatureProvider (National PKI): sign(pdf, signer) → signed pdf.
export const manualSignatureProvider = {
  async sign() {
    return { ok: false, code: "ADAPTER_NOT_CONNECTED", fallback: "wet signature + scan" };
  },
};

// SmsProvider — BUILT: HTTP adapter (SMS_PROVIDER/SMS_API_URL/SMS_API_KEY/SMS_SENDER).
export async function sendSms(to, text) {
  const provider = process.env.SMS_PROVIDER || "log";
  const ref = `sms_${Date.now().toString(36)}`;
  if (provider === "log") {
    console.log(`[sms:${ref}] to=${to} text=${text}`);
    return { ok: true, ref };
  }
  try {
    const res = await fetch(process.env.SMS_API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.SMS_API_KEY}` },
      body: JSON.stringify({ to, text, sender: process.env.SMS_SENDER || "WMAMS" }),
    });
    return { ok: res.ok, ref };
  } catch {
    return { ok: false, code: "SMS_FAILED" };
  }
}

// externalRefs (system, externalId, entityType, entityId): records imported
// now match automatically when an adapter connects.
const refs = [];
export function putExternalRef(system, externalId, entityType, entityId) {
  const r = { system, externalId, entityType, entityId, at: new Date().toISOString() };
  refs.push(r);
  return r;
}
export function matchExternalRef(system, externalId) {
  return refs.find((r) => r.system === system && r.externalId === externalId) || null;
}
