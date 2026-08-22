export const CREDIT_BUREAU_CONSENT_TYPE = "CTOS_CCRIS_CONSENT";
export const CREDIT_BUREAU_CONSENT_VERSION = "V4.0-01112020";

function clean(value) {
  return String(value ?? "").trim();
}

function normalized(value) {
  return clean(value).toUpperCase().replace(/[\s-]+/g, "_");
}

function recordTime(row = {}) {
  for (const key of [
    "Verified At",
    "Received Date",
    "Created Date",
    "Updated At",
    "Timestamp",
  ]) {
    const parsed = Date.parse(clean(row[key]));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function latestCreditBureauConsent(leadId, rows = []) {
  return rows
    .filter((row) => clean(row?.["Lead ID"]) === clean(leadId))
    .filter(
      (row) =>
        normalized(
          row?.["Document Type"] ||
            row?.["Detected Document Type"] ||
            row?.["Document Label"],
        ) === CREDIT_BUREAU_CONSENT_TYPE,
    )
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        recordTime(a.row) - recordTime(b.row) || a.index - b.index,
    )
    .at(-1)?.row || null;
}

export function evaluateCreditBureauConsent(leadId, rows = []) {
  const consent = latestCreditBureauConsent(leadId, rows);
  if (!consent)
    return {
      eligible: false,
      state: "NOT_RECEIVED",
      reasons: ["CTOS_CCRIS_CONSENT_NOT_RECEIVED"],
      consent: null,
    };

  const status = normalized(consent.Status);
  const verificationStatus = normalized(consent["Verification Status"]);
  const version = clean(consent["Consent Version"]);
  const reasons = [];

  if (
    status === "REVOKED" ||
    verificationStatus === "REVOKED" ||
    clean(consent["Revoked At"])
  )
    reasons.push("CTOS_CCRIS_CONSENT_REVOKED");
  else if (
    ["REJECTED", "REUPLOAD_REQUIRED", "RE_UPLOAD_REQUIRED"].includes(
      status,
    ) || verificationStatus === "REJECTED"
  )
    reasons.push("CTOS_CCRIS_CONSENT_REUPLOAD_REQUIRED");
  else if (verificationStatus !== "VERIFIED")
    reasons.push("CTOS_CCRIS_CONSENT_NOT_VERIFIED");

  if (version !== CREDIT_BUREAU_CONSENT_VERSION)
    reasons.push("CTOS_CCRIS_CONSENT_VERSION_INVALID");
  if (
    verificationStatus === "VERIFIED" &&
    (!clean(consent["Verified At"]) || !clean(consent["Verified By"]))
  )
    reasons.push("CTOS_CCRIS_CONSENT_AUDIT_INCOMPLETE");

  return {
    eligible: reasons.length === 0,
    state:
      reasons.length === 0
        ? "VERIFIED"
        : reasons.includes("CTOS_CCRIS_CONSENT_REVOKED")
          ? "REVOKED"
          : reasons.includes("CTOS_CCRIS_CONSENT_REUPLOAD_REQUIRED")
            ? "REUPLOAD_REQUIRED"
            : "RECEIVED_PENDING_VERIFICATION",
    reasons: [...new Set(reasons)],
    consent,
  };
}
