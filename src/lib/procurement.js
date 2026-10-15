"use client";
import { useCollection } from "./use-data";

// Procurement authority matrix (level → what they may do):
// Staff = prepare records, enter data, upload documents, monitor progress.
// Section head = review proposal/documents, recommend/forward.
// Mahashakha head (UNIT_HEAD in a MAHASHAKHA unit) = review, recommend,
// coordinate procurement activities. Department head (UNIT_HEAD in a
// DEPARTMENT unit) = competent approval/decision per delegated authority +
// contract administration. PMO = higher monitoring/approval only where
// authority requires. Minister = policy/authority decisions only — never
// routine approval of every stage.
export function useProcurementRole(role, user) {
  const unitsQ = useCollection("units");
  const rows = unitsQ.data || [];
  const key = String(user?.unitId || "").toLowerCase();
  const me = key ? rows.find((u) => [u.id, u.code, u._id].filter(Boolean).map((v) => String(v).toLowerCase()).includes(key)) : null;
  // Fall back to the login profile's unitType when the units list hasn't
  // loaded yet or the id doesn't match — otherwise a real department head
  // loses the LOI/contract cards for a lookup miss.
  const unitType = me?.type || user?.unitType || null;
  const isPreparer = role === "STAFF";
  const isReviewer = role === "SECTION_HEAD" || (role === "UNIT_HEAD" && unitType === "MAHASHAKHA");
  const isDeptApprover = role === "UNIT_HEAD" && unitType === "DEPARTMENT";
  return { unitType, unitsLoading: unitsQ.loading, isPreparer, isReviewer, isDeptApprover };
}
