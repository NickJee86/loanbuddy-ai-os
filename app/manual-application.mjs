export function buildManualApplicationRecord({ body, user, existing = {}, leadId, now }) {
  const allowedFields = [
    "Lead Name",
    "Phone Number",
    "IC Number",
    "Monthly Income",
    "Loan Amount Requested",
    "Employment Status",
    "Employment Duration",
    "Salary Bank In",
    "EPF Available",
    "Monthly Commitments",
    "Manual Source Detail",
    "Consent Status",
    "Age",
    "Employer Name",
    "Industry",
    "Employment Tenure Months",
    "Verified Net Income",
    "Income Verification Source",
    "Variable Income Average",
    "Commitment Breakdown",
    "Requested Tenure Months",
    "Preferred Language",
  ];
  const submitted = Object.fromEntries(
    allowedFields
      .filter((field) => typeof body[field] === "string")
      .map((field) => [field, body[field]]),
  );
  const isExisting = Boolean(existing["Lead ID"]);
  const enforcedBranch = isExisting
    ? existing["Branch ID"] || ""
    : user.role === "staff"
      ? user.branchIds[0]
      : body["Branch ID"] || "";
  const assignedSalesId = isExisting
    ? existing["Assigned Sales ID"] || ""
    : user.role === "staff"
      ? user.salesId || user.username
      : "";
  const existingRoute = String(existing["Processing Route"] || "")
    .trim()
    .toUpperCase();
  const processingRoute = isExisting && existingRoute === "AI_DIRECT"
    ? "AI_DIRECT"
    : "SA_ASSIST";

  return {
    ...existing,
    ...submitted,
    "Lead ID": leadId,
    "Created Date": existing["Created Date"] || body["Created Date"] || now,
    "Source": existing["Source"] || "CRM_MANUAL",
    "Branch ID": enforcedBranch,
    "Assigned Sales ID": assignedSalesId,
    "Processing Route": processingRoute,
    "Case Visibility": processingRoute === "AI_DIRECT" ? "REGIONAL_ADMIN_ONLY" : "BRANCH_SA",
    "Escalation Reason": existing["Escalation Reason"] || (processingRoute === "SA_ASSIST" ? "CRM_MANUAL_APPLICATION" : ""),
    "Lead Status": body.action === "submit" ? "SUBMITTED_FOR_VERIFICATION" : "DRAFT",
    "Current Stage": body.action === "submit" ? "DOCUMENT_VERIFICATION" : "MANUAL_APPLICATION",
    "Last AI Update": now,
  };
}
