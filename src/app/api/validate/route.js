import { NextResponse } from "next/server";
import { weightsMust100, dateWithinParent, spendCheck, milestones100, percentRange, stepComment, scanFile, notFuture } from "@/lib/rules";
import { checkAmountNpr, br01WorkScope, br07MinistrySpend, br10NeedsRevision, br12NotSelf, br13Hybrid, br16Version, isNpMobile, isEmail, isBsDate, isCode, isTitle, checkPassword } from "@/lib/business-rules";
import { validateImportRows } from "@/lib/import-specs";

// Server-side re-validation: every form validates on the page AND here.
// POST { form, payload } → { ok, errors: [{code, field?}] }.
export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, errors: [{ code: "BAD_REQUEST" }] }, { status: 400 });
  }
  const { form, payload = {} } = body;
  const errors = [];
  const check = (fn) => {
    try { fn(); } catch (e) { errors.push({ code: e.code || "INVALID", details: e.details }); }
  };
  const need = (field, cond, code) => {
    if (!cond) errors.push({ code, field });
  };

  switch (form) {
    case "login":
      need("username", String(payload.username || "").trim(), "REQUIRED");
      need("password", String(payload.password || "").length >= 10, "PASSWORD_RULES");
      break;
    case "otp":
      need("code", /^\d{6}$/.test(String(payload.code || "")), "OTP_RULES");
      break;
    case "reset-password":
      if (String(payload.password || "").length < 10) errors.push({ code: "PASSWORD_RULES", field: "password" });
      else {
        const s = String(payload.password);
        if (!/[A-Z]/.test(s) || !/[a-z]/.test(s) || !/[0-9]/.test(s)) errors.push({ code: "PASSWORD_RULES", field: "password" });
        else if (checkPassword(s)) errors.push({ code: checkPassword(s), field: "password" });
      }
      need("confirm", payload.password === payload.confirm, "PASSWORD_MISMATCH");
      need("token", String(payload.token || "").trim(), "REQUIRED");
      break;
    case "work-new":
      need("titleNe", String(payload.titleNe || "").trim(), "REQUIRED");
      need("unitId", String(payload.unitId || "").trim(), "REQUIRED");
      need("fy", String(payload.fy || "").trim(), "REQUIRED");
      check(() => weightsMust100((payload.weights || []).map(Number)));
      if (payload.start && payload.end) check(() => dateWithinParent({ start: payload.start, end: payload.end }, { start: payload.parentStart || payload.start, end: payload.parentEnd || payload.end }));
      if (payload.amountPaisa != null && payload.availablePaisa != null) check(() => spendCheck({ revisedPaisa: payload.availablePaisa, committedPaisa: 0, spentPaisa: 0 }, payload.availablePaisa, payload.amountPaisa));
      break;
    case "tippani-new":
      need("subject", String(payload.subject || "").trim(), "REQUIRED");
      if (payload.action === "RETURN" || payload.action === "REJECT") check(() => stepComment(payload.action, payload.comment));
      break;
    case "progress-update":
      check(() => percentRange(Number(payload.percent)));
      break;
    case "milestones":
      check(() => milestones100((payload.pcts || []).map(Number)));
      break;
    case "expenditure":
      need("voucher", String(payload.voucher || "").trim(), "REQUIRED");
      need("net", Number(payload.net) > 0, "OUT_OF_RANGE");
      break;
    case "document":
      check(() => scanFile(payload.name || "", payload.mime || ""));
      break;
    case "activity":
      check(() => notFuture(payload.date || new Date().toISOString(), new Date().toISOString()));
      break;
    case "import-commit": {
      // Server re-validates every row (never trust the client preview),
      // including FK checks against live scope (DB in production).
      const { dbConnect } = await import("@/lib/db");
      const { getModel } = await import("@/lib/models");
      await dbConnect();
      const get = async (col) => getModel(col).find({}).lean();
      const bad = validateImportRows(payload.template, payload.rows || [], { units: await get("units"), users: await get("users"), works: await get("works") }).filter((r) => !r.valid);
      if (bad.length) errors.push({ code: "IMPORT_ROW_ERRORS", details: { rows: bad.length, first: bad[0] } });
      break;
    }
    case "user-new":
      need("username", /^[a-z0-9._-]{2,30}$/.test(String(payload.username || "")), "CODE_FORMAT");
      need("unit", isCode(String(payload.unit_code || "")), "UNKNOWN_UNIT");
      if (payload.mobile && !isNpMobile(payload.mobile)) errors.push({ code: "MOBILE_FORMAT", field: "mobile" });
      if (payload.email && !isEmail(payload.email)) errors.push({ code: "EMAIL_FORMAT", field: "email" });
      break;
    case "amount":
      check(() => checkAmountNpr(Number(payload.npr), payload.field));
      break;
    case "work-scope":
      check(() => br01WorkScope(payload));
      break;
    case "ministry-spend":
      check(() => br07MinistrySpend(payload));
      break;
    case "revision-check":
      check(() => br10NeedsRevision(payload.fields || [], payload.status));
      break;
    case "self-check":
      check(() => br12NotSelf(payload.submitter, payload.actor));
      break;
    case "hybrid":
      check(() => br13Hybrid(payload));
      break;
    case "version-check":
      check(() => br16Version({ version: payload.current }, payload.opened));
      break;
    case "title-check":
      need("title", isTitle(payload.title), "TITLE_LENGTH");
      if (payload.date && !isBsDate(payload.date)) errors.push({ code: "BS_DATE", field: "date" });
      break;
    default:
      return NextResponse.json({ ok: false, errors: [{ code: "UNKNOWN_FORM" }] }, { status: 400 });
  }
  return NextResponse.json({ ok: errors.length === 0, errors });
}
