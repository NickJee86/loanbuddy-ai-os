function normalized(value) {
  return String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

export const REQUIRED_APPLICATION_DOCUMENTS = Object.freeze(["IC_FRONT", "IC_BACK", "PAYSLIP", "BANK_STATEMENT"]);

function recordTime(row) {
  for (const key of ["Verified At", "Verification Date", "Updated At", "Created At", "Created Date", "Received Date"]) {
    const parsed = Date.parse(String(row?.[key] || ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function latestRecord(rows) {
  return rows.map((row, index) => ({ row, index })).sort((a, b) => recordTime(a.row) - recordTime(b.row) || a.index - b.index).at(-1)?.row || null;
}

/** @param {string} leadId @param {Array<Record<string, string>>} receivedRows */
export function missingRequiredDocuments(leadId, receivedRows = []) {
  const accepted = new Set(["RECEIVED", "VERIFIED", "PASSED", "COMPLETE", "COMPLETED", "APPROVED"]);
  const present = new Set(receivedRows.filter((row) => String(row?.["Lead ID"] || "").trim() === String(leadId || "").trim())
    .filter((row) => accepted.has(normalized(row?.Status || "RECEIVED")))
    .map((row) => normalized(row?.["Document Type"] || row?.["Detected Document Type"] || row?.["Document Label"])));
  return REQUIRED_APPLICATION_DOCUMENTS.filter((type) => !present.has(type));
}

/** @param {{lead?: Record<string, string>, receivedRows?: Array<Record<string, string>>, verificationRows?: Array<Record<string, string>>}} input */
export function evaluateVerificationApproval({ lead = {}, receivedRows = [], verificationRows = [] } = {}) {
  const reasons = [];
  const leadId = String(lead["Lead ID"] || "").trim();
  const missing = missingRequiredDocuments(leadId, receivedRows);
  if (missing.length) reasons.push(...missing.map((type) => `MISSING_${type}`));

  const documentStatus = normalized(lead["Document Status"]);
  if (!["VERIFIED", "PASSED", "COMPLETE", "COMPLETED", "APPROVED"].includes(documentStatus)) reasons.push("DOCUMENT_STATUS_NOT_VERIFIED");

  const verification = latestRecord(verificationRows.filter((row) => String(row?.["Lead ID"] || "").trim() === leadId));
  if (!verification) reasons.push("VERIFICATION_NOT_FOUND");
  else {
    const overall = normalized(verification["Overall Verification Status"] || verification["Verification Status"]);
    if (!["VERIFIED", "PASSED"].includes(overall)) reasons.push("VERIFICATION_NOT_PASSED");
    const manual = normalized(verification["Manual Review Required"]);
    if (["YES", "TRUE", "REQUIRED", "MANUAL_REVIEW"].includes(manual)) reasons.push("MANUAL_REVIEW_UNRESOLVED");
    const missingOrUnreadable = normalized(verification["Missing or Unreadable Documents"]);
    if (missingOrUnreadable && missingOrUnreadable !== "NONE") reasons.push("VERIFICATION_HAS_MISSING_OR_UNREADABLE_DOCUMENTS");
  }

  return { eligible: reasons.length === 0, reasons: [...new Set(reasons)], missingDocuments: missing, verification };
}
