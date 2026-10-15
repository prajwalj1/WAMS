// Shared enums — defined once (§31 packages/shared/enums). All other modules
// import from here; never redeclare status strings.
export const WORK_STATUS = ["DRAFT", "SUBMITTED", "APPROVED", "ONGOING", "ON_HOLD", "COMPLETION_SUBMITTED", "VERIFIED", "CLOSED", "RETURNED", "REJECTED", "CANCELLED"];
export const HEALTH = ["ON_TRACK", "AT_RISK", "BEHIND", "OVERDUE", "NOT_STARTED"];
export const PAYMENT_MODE = ["STAGED", "AFTER_COMPLETION", "NONE"];
export const PROGRESS_METHOD = ["WEIGHTED_TASKS", "QUANTITY", "MILESTONE", "QUALITATIVE", "HYBRID"];
export const UNIT_TYPE = ["PMO", "MINISTRY", "DEPARTMENT", "MAHASHAKHA", "SECTION", "OFFICE"];
export const BUDGET_MODE = ["OWN", "MINISTRY"];
