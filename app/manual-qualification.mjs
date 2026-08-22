export const MANUAL_LEAD_HEADERS = Object.freeze([
  "IC Number",
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
  "Credit Bureau Consent Status",
  "Credit Bureau Consent Version",
  "Credit Bureau Consent Received At",
  "Credit Bureau Consent Verified At",
  "Credit Bureau Consent Verified By",
  "Credit Bureau Consent Revoked At",
]);

export const CONVERSATION_STATE_HEADERS = Object.freeze([
  "Phone Number",
  "Lead ID",
  "Lead Name",
  "Current Step",
  "Loan Amount",
  "Monthly Income",
  "Salary Bank In",
  "Employment Type",
  "Employment Duration",
  "EPF Available",
  "Existing Commitment",
  "Preferred Language",
  "Qualification Status",
  "Last Customer Reply",
  "Last AI Question",
  "Last Updated",
  "Document Status",
  "Next Action",
  "IC Received",
  "Payslip Received",
  "Bank Statement Received",
  "EPF Received",
  "Detected Region",
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
  "Proposed Instalment",
  "Income Stability Grade",
  "Employer Risk Band",
  "Fraud Flag",
  "Credit Data Status",
  "Pre-LMS Assessment Status",
  "IC Number",
]);

export const MANUAL_CREDIT_REQUIRED_FIELDS = Object.freeze([
  "Consent Status",
  "Age",
  "Loan Amount",
  "Monthly Income",
  "Salary Bank In",
  "Employment Type",
  "Employment Tenure Months",
  "Employer Name",
  "Industry",
  "Verified Net Income",
  "Income Verification Source",
  "Existing Commitment",
  "Requested Tenure Months",
]);

function clean(value) {
  return String(value ?? "").trim();
}

function first(record, keys) {
  for (const key of keys) {
    const value = clean(record?.[key]);
    if (value) return value;
  }
  return "";
}

export function appendMissingHeaders(headers = [], required = []) {
  const seen = new Set(headers.map((header) => clean(header)).filter(Boolean));
  return [
    ...headers,
    ...required.filter((header) => !seen.has(clean(header))),
  ];
}

export function buildConversationStateRecord({
  body = {},
  existing = {},
  leadId = "",
  now = "",
  documentStatus = "",
} = {}) {
  const action = body.action === "submit" ? "submit" : "draft";
  const mapped = {
    "Phone Number": first(body, ["Phone Number"]),
    "Lead ID": clean(leadId),
    "Lead Name": first(body, ["Lead Name"]),
    "Loan Amount": first(body, ["Loan Amount Requested", "Loan Amount"]),
    "Monthly Income": first(body, ["Monthly Income"]),
    "Salary Bank In": first(body, ["Salary Bank In"]),
    "Employment Type": first(body, ["Employment Status", "Employment Type"]),
    "Employment Duration": first(body, ["Employment Duration"]),
    "EPF Available": first(body, ["EPF Available"]),
    "Existing Commitment": first(body, ["Monthly Commitments", "Existing Commitment"]),
    "Preferred Language": first(body, ["Preferred Language"]),
    "Detected Region": first(body, ["Detected Region", "Branch ID"]),
    "Consent Status": first(body, ["Consent Status"]),
    Age: first(body, ["Age"]),
    "Employer Name": first(body, ["Employer Name"]),
    Industry: first(body, ["Industry"]),
    "Employment Tenure Months": first(body, ["Employment Tenure Months"]),
    "Verified Net Income": first(body, ["Verified Net Income"]),
    "Income Verification Source": first(body, ["Income Verification Source"]),
    "Variable Income Average": first(body, ["Variable Income Average"]),
    "Commitment Breakdown": first(body, ["Commitment Breakdown"]),
    "Requested Tenure Months": first(body, ["Requested Tenure Months"]),
    "IC Number": first(body, ["IC Number"]),
  };
  const submitted = Object.fromEntries(
    Object.entries(mapped).filter(([, value]) => clean(value)),
  );
  const record = {
    ...existing,
    ...submitted,
    "Lead ID": clean(leadId),
    "Last Updated": clean(now),
    "Current Step":
      action === "submit" ? "DOCUMENT_VERIFICATION" : "MANUAL_APPLICATION",
    "Qualification Status":
      action === "submit" ? "COMPLETE" : "IN_PROGRESS",
    "Next Action":
      action === "submit"
        ? "AI_DOCUMENT_VERIFICATION"
        : "COMPLETE_MANUAL_APPLICATION",
    "Document Status":
      clean(documentStatus) || clean(existing["Document Status"]) || "IN_PROGRESS",
  };
  const gaps = creditDataGaps(record);
  record["Credit Data Status"] = gaps.length ? "INCOMPLETE" : "COMPLETE";
  if (action === "submit")
    record["Pre-LMS Assessment Status"] = gaps.length
      ? "BLOCKED_INCOMPLETE_DATA"
      : "PENDING";
  return record;
}

export function creditDataGaps(record = {}) {
  const gaps = MANUAL_CREDIT_REQUIRED_FIELDS.filter(
    (field) => !clean(record[field]),
  );
  if (clean(record["Consent Status"]).toUpperCase() !== "YES") {
    const index = gaps.indexOf("Consent Status");
    if (index < 0) gaps.push("Consent Status");
  }
  return gaps;
}
