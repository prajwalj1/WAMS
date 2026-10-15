// §17 Excel import templates — column specs, row validation, commit/rollback.
// Dates are BS (YYYY-MM-DD). Amounts are NPR without commas (integer).
import { isBsDate, isCode, isNpMobile, isEmail, isFy } from "./business-rules";

// Column: { key, required, type }. Types drive cell validation.
const C = (key, required, type = "text") => ({ key, required, type });

export const IMPORT_SPECS = {
  units: { file: "units.xlsx", columns: [C("parent_code", 1, "code-loose"), C("type", 1), C("code", 1, "code"), C("name_ne", 1, "title"), C("name_en", 1, "title"), C("short_name", 1), C("budget_mode", 0), C("phone", 0, "mobile"), C("email", 0, "email"), C("address", 0)] },
  users: { file: "users.xlsx", columns: [C("username", 1, "username"), C("name_ne", 1, "title"), C("name_en", 1, "title"), C("employee_code", 0), C("position", 1), C("level", 0), C("unit_code", 1, "code"), C("mobile", 1, "mobile"), C("email", 0, "email"), C("role_code", 1), C("scope_unit_code", 0, "code-loose")] },
  budget_lines: { file: "budget_lines.xlsx", columns: [C("fiscal_year", 1, "fy"), C("unit_code", 1, "code"), C("budget_subhead_no", 1, "code"), C("subhead_name", 1, "title"), C("expense_head", 0), C("source", 0), C("nature", 0), C("allocated", 1, "amount"), C("t1_target", 0, "amount"), C("t2_target", 0, "amount"), C("t3_target", 0, "amount")] },
  works: { file: "works.xlsx", columns: [C("fiscal_year", 1, "fy"), C("unit_code", 1, "code"), C("title_ne", 1, "title"), C("title_en", 0, "title"), C("work_type", 1), C("start_date", 1, "bsdate"), C("deadline", 1, "bsdate"), C("priority", 0), C("payment_mode", 1), C("progress_method", 1), C("owner_username", 1, "username"), C("budget_subhead_no", 0, "code-loose"), C("budget_amount", 0, "amount"), C("expected_output", 0, "desc")] },
  tasks: { file: "tasks.xlsx", columns: [C("work_code", 1), C("parent_task_ref", 0), C("task_ref", 1), C("title", 1, "title"), C("owner_username", 1, "username"), C("start_date", 1, "bsdate"), C("deadline", 1, "bsdate"), C("weight", 1, "weight"), C("planned_qty", 0, "amount"), C("uom", 0)] },
  expenditures: { file: "expenditures.xlsx", columns: [C("fiscal_year", 1, "fy"), C("work_code", 1), C("budget_subhead_no", 1, "code"), C("voucher_no", 1), C("bill_no", 0), C("bill_date", 1, "bsdate"), C("paid_date", 0, "bsdate"), C("payee", 1, "title"), C("gross", 1, "amount"), C("tds", 0, "amount"), C("retention", 0, "amount"), C("net", 1, "amount"), C("contract_no", 0), C("milestone_no", 0)] },
};

export function templateHeader(key) {
  return IMPORT_SPECS[key].columns.map((c) => c.key + (c.required ? "*" : "")).join(",");
}

// Minimal CSV parser (handles quotes). Returns array of objects using header row.
export function parseCsv(text) {
  const rows = [];
  let cur = [""];
  let quoted = false;
  const t = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"') {
        if (t[i + 1] === '"') { cur[cur.length - 1] += '"'; i++; }
        else quoted = false;
      } else cur[cur.length - 1] += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") cur.push("");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      rows.push(cur);
      cur = [""];
    } else cur[cur.length - 1] += ch;
  }
  if (cur.length > 1 || cur[0] !== "") rows.push(cur);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().replace(/\*$/, ""));
  return rows.slice(1).filter((r) => r.some((c) => String(c).trim() !== "")).map((r) => {
    const o = {};
    head.forEach((h, i) => { o[h] = (r[i] ?? "").trim(); });
    return o;
  });
}

function cellError(col, value) {
  const v = String(value ?? "").trim();
  if (!v) return col.required ? "REQUIRED" : null;
  switch (col.type) {
    case "code": return isCode(v) ? null : "CODE_FORMAT";
    case "code-loose": return /^[A-Za-z0-9-]{1,30}$/.test(v) ? null : "CODE_FORMAT";
    case "username": return /^[a-z0-9._-]{2,30}$/.test(v) ? null : "CODE_FORMAT";
    case "title": return v.length >= 3 && v.length <= 300 ? null : "TITLE_LENGTH";
    case "desc": return v.length <= 10000 ? null : "DESC_length";
    case "mobile": return isNpMobile(v) ? null : "MOBILE_FORMAT";
    case "email": return isEmail(v) ? null : "EMAIL_FORMAT";
    case "fy": return isFy(v) ? null : "FY_FORMAT";
    case "bsdate": return isBsDate(v) ? null : "BS_DATE";
    case "amount":
      if (/,/.test(v)) return "NO_COMMAS";
      if (!/^\d+$/.test(v)) return "AMOUNT_INT";
      if (Number(v) <= 0) return "AMOUNT_POSITIVE";
      if (Number(v) > 10000000000) return "AMOUNT_MAX";
      return null;
    case "weight": return /^\d+(\.\d+)?$/.test(v) && Number(v) >= 0 && Number(v) <= 100 ? null : "WEIGHT_RANGE";
    default: return null;
  }
}

// Cross-field + FK checks per template. ctx: { units, users, works, subheads }.
function rowExtra(key, row, ctx = {}) {
  const errs = [];
  const codes = (list, k) => new Set((list || []).map((x) => String(x[k] || x.code || "").toUpperCase()));
  if (key === "users") {
    if (row.unit_code && !codes(ctx.units, "code").has(row.unit_code.toUpperCase())) errs.push({ col: "unit_code", code: "UNKNOWN_UNIT" });
  }
  if (key === "works" || key === "tasks") {
    if (row.start_date && row.deadline && row.deadline <= row.start_date) errs.push({ col: "deadline", code: "DEADLINE_AFTER_START" });
    if (row.owner_username && ctx.users && !ctx.users.some((u) => u.username === row.owner_username && u.status === "ACTIVE"))
      errs.push({ col: "owner_username", code: "OWNER_INACTIVE" });
  }
  if (key === "tasks") {
    if (row.work_code && ctx.works && !ctx.works.some((w) => w.id === row.work_code)) errs.push({ col: "work_code", code: "UNKNOWN_WORK" });
  }
  if (key === "expenditures") {
    if (row.work_code && ctx.works && !ctx.works.some((w) => w.id === row.work_code)) errs.push({ col: "work_code", code: "UNKNOWN_WORK" });
    if (row.gross && row.net) {
      const expect = Number(row.gross) - Number(row.tds || 0) - Number(row.retention || 0);
      if (Number(row.net) !== expect) errs.push({ col: "net", code: "NET_MISMATCH" });
    }
  }
  if (key === "budget_lines") {
    for (const k of ["t1_target", "t2_target", "t3_target"]) {
      if (row[k] && row.allocated && Number(row[k]) > Number(row.allocated)) errs.push({ col: k, code: "TARGET_OVER_ALLOC" });
    }
  }
  return errs;
}

export function validateImportRows(key, rows, ctx = {}) {
  const spec = IMPORT_SPECS[key];
  return rows.map((row, i) => {
    const errors = [];
    for (const col of spec.columns) {
      const code = cellError(col, row[col.key]);
      if (code) errors.push({ col: col.key, code });
    }
    errors.push(...rowExtra(key, row, ctx));
    return { row: i + 2, data: row, errors, valid: errors.length === 0 };
  });
}

// Rollback guard: a batch can roll back within 7 days only if nothing depends
// on it. dependents: [{ by, ref }] describing records created from this batch
// that are now referenced elsewhere.
export function canRollback(batch, today = new Date().toISOString().slice(0, 10)) {
  const age = Math.round((new Date(today) - new Date(batch.committedAt)) / 86400000);
  if (age > 7) return { ok: false, code: "ROLLBACK_WINDOW" };
  if ((batch.dependents || []).length) return { ok: false, code: "HAS_DEPENDENTS", dependents: batch.dependents };
  return { ok: true };
}
