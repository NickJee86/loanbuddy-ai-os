function normalized(value) {
  return String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function numeric(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const compact = String(value).trim().replace(/,/g, "");
  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(compact)) return null;
  const parsed = Number(compact);
  return Number.isFinite(parsed) ? parsed : null;
}

function errorCode(field) {
  return field.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function validIsoDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function singleLine(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function documentSet(value) {
  return String(value || "").split(/[,;|\n]+/).map(normalized).filter(Boolean);
}

export const POLICY_HEADERS = Object.freeze([
  "Policy Code", "Policy Version", "Status", "Effective From", "Product Name", "Currency",
  "Minimum Age", "Maximum Age At Maturity", "Minimum Employment Tenure Months", "Minimum Verified Net Income",
  "Maximum Preliminary DSR", "Minimum Net Disposable Income", "Minimum Loan Amount", "Maximum Loan Amount",
  "Minimum Tenure Months", "Maximum Tenure Months", "Variable Income Recognition Percent",
  "Minimum Auto LMS Score", "Manual Review Score", "Required Documents", "Optional Documents",
  "Policy Notes", "Approved By", "Approved At",
]);

export const REQUIRED_ACTIVE_POLICY_FIELDS = Object.freeze([
  "Policy Code", "Policy Version", "Effective From", "Product Name", "Currency", "Minimum Age",
  "Maximum Age At Maturity", "Minimum Employment Tenure Months", "Minimum Verified Net Income",
  "Maximum Preliminary DSR", "Minimum Net Disposable Income", "Minimum Loan Amount", "Maximum Loan Amount",
  "Minimum Tenure Months", "Maximum Tenure Months", "Variable Income Recognition Percent",
  "Minimum Auto LMS Score", "Manual Review Score", "Required Documents",
]);

export function buildDraftPolicy(input = {}) {
  const policy = Object.fromEntries(
    POLICY_HEADERS.map((header) => [
      header,
      String(input?.[header] || "").trim(),
    ]),
  );
  policy.Status = "DRAFT";
  policy["Approved By"] = "";
  policy["Approved At"] = "";
  return policy;
}

export function validatePolicyForActivation(policy = {}) {
  const errors = [];
  for (const field of REQUIRED_ACTIVE_POLICY_FIELDS) {
    if (String(policy[field] ?? "").trim() === "") errors.push(`MISSING_${field.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`);
  }

  const numberFields = REQUIRED_ACTIVE_POLICY_FIELDS.filter((field) => ![
    "Policy Code", "Policy Version", "Effective From", "Product Name", "Currency", "Required Documents",
  ].includes(field));
  for (const field of numberFields) {
    const value = numeric(policy[field]);
    if (String(policy[field] ?? "").trim() !== "" && value === null) errors.push(`INVALID_${errorCode(field)}`);
  }

  if (String(policy["Effective From"] || "").trim() && !validIsoDate(policy["Effective From"])) errors.push("INVALID_EFFECTIVE_FROM");
  if (String(policy["Policy Code"] || "").trim() && !/^[A-Z0-9][A-Z0-9._-]{1,63}$/i.test(String(policy["Policy Code"]).trim())) errors.push("INVALID_POLICY_CODE");
  if (String(policy["Policy Version"] || "").trim() && !/^[A-Z0-9][A-Z0-9._-]{0,31}$/i.test(String(policy["Policy Version"]).trim())) errors.push("INVALID_POLICY_VERSION");
  if (String(policy.Currency || "").trim() && !/^[A-Z]{3}$/.test(String(policy.Currency).trim().toUpperCase())) errors.push("INVALID_CURRENCY");

  const minimumAge = numeric(policy["Minimum Age"]);
  const maximumAge = numeric(policy["Maximum Age At Maturity"]);
  const minimumAmount = numeric(policy["Minimum Loan Amount"]);
  const maximumAmount = numeric(policy["Maximum Loan Amount"]);
  const minimumTenure = numeric(policy["Minimum Tenure Months"]);
  const maximumTenure = numeric(policy["Maximum Tenure Months"]);
  const maximumDsr = numeric(policy["Maximum Preliminary DSR"]);
  const employmentTenure = numeric(policy["Minimum Employment Tenure Months"]);
  const minimumIncome = numeric(policy["Minimum Verified Net Income"]);
  const minimumNdi = numeric(policy["Minimum Net Disposable Income"]);
  const variableIncome = numeric(policy["Variable Income Recognition Percent"]);
  const autoScore = numeric(policy["Minimum Auto LMS Score"]);
  const reviewScore = numeric(policy["Manual Review Score"]);

  if (minimumAge !== null && (!Number.isInteger(minimumAge) || minimumAge <= 0)) errors.push("MINIMUM_AGE_OUT_OF_RANGE");
  if (maximumAge !== null && (!Number.isInteger(maximumAge) || maximumAge <= 0)) errors.push("MAXIMUM_AGE_AT_MATURITY_OUT_OF_RANGE");
  if (minimumAge !== null && maximumAge !== null && minimumAge >= maximumAge) errors.push("AGE_RANGE_INVALID");
  if (employmentTenure !== null && (!Number.isInteger(employmentTenure) || employmentTenure < 0)) errors.push("EMPLOYMENT_TENURE_OUT_OF_RANGE");
  if (minimumIncome !== null && minimumIncome <= 0) errors.push("MINIMUM_VERIFIED_NET_INCOME_OUT_OF_RANGE");
  if (minimumNdi !== null && minimumNdi < 0) errors.push("MINIMUM_NDI_OUT_OF_RANGE");
  if (minimumAmount !== null && minimumAmount <= 0) errors.push("MINIMUM_LOAN_AMOUNT_OUT_OF_RANGE");
  if (maximumAmount !== null && maximumAmount <= 0) errors.push("MAXIMUM_LOAN_AMOUNT_OUT_OF_RANGE");
  if (minimumAmount !== null && maximumAmount !== null && minimumAmount > maximumAmount) errors.push("LOAN_AMOUNT_RANGE_INVALID");
  if (minimumTenure !== null && (!Number.isInteger(minimumTenure) || minimumTenure <= 0)) errors.push("MINIMUM_TENURE_OUT_OF_RANGE");
  if (maximumTenure !== null && (!Number.isInteger(maximumTenure) || maximumTenure <= 0)) errors.push("MAXIMUM_TENURE_OUT_OF_RANGE");
  if (minimumTenure !== null && maximumTenure !== null && minimumTenure > maximumTenure) errors.push("TENURE_RANGE_INVALID");
  if (maximumDsr !== null && (maximumDsr <= 0 || maximumDsr > 100)) errors.push("DSR_OUT_OF_RANGE");
  if (variableIncome !== null && (variableIncome < 0 || variableIncome > 100)) errors.push("VARIABLE_INCOME_OUT_OF_RANGE");
  if (autoScore !== null && (autoScore <= 0 || autoScore > 100)) errors.push("AUTO_SCORE_OUT_OF_RANGE");
  if (reviewScore !== null && (reviewScore <= 0 || reviewScore > 100)) errors.push("REVIEW_SCORE_OUT_OF_RANGE");
  if (autoScore !== null && reviewScore !== null && reviewScore > autoScore) errors.push("SCORE_BANDS_INVALID");

  const requiredDocuments = documentSet(policy["Required Documents"]);
  const requiredSet = new Set(requiredDocuments);
  const requiredExpected = ["IC_FRONT", "IC_BACK", "PAYSLIP", "BANK_STATEMENT"];
  if (requiredDocuments.length && (requiredDocuments.length !== requiredSet.size || requiredSet.size !== requiredExpected.length || requiredExpected.some((item) => !requiredSet.has(item)))) errors.push("REQUIRED_DOCUMENTS_INVALID");
  const optionalDocuments = documentSet(policy["Optional Documents"]);
  if (optionalDocuments.some((item) => item !== "EPF_STATEMENT") || new Set(optionalDocuments).size !== optionalDocuments.length) errors.push("OPTIONAL_DOCUMENTS_INVALID");
  if (normalized(policy.Status) === "SHADOW") errors.push("SHADOW_VERSION_IMMUTABLE");
  if (normalized(policy.Status) === "RETIRED") errors.push("RETIRED_VERSION_IMMUTABLE");

  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export function validateManagementApproval(
  approval = {},
  referenceTime = new Date(),
) {
  const errors = [];
  const approvedBy = singleLine(approval.approvedBy);
  const approvalDate = singleLine(approval.approvalDate);
  const approvalReference = singleLine(approval.approvalReference);
  const placeholderValues = new Set(["TBD", "PENDING", "TEST", "N/A", "NA"]);

  if (!approvedBy) errors.push("MANAGEMENT_APPROVER_REQUIRED");
  else if (
    approvedBy.length < 2 ||
    approvedBy.length > 120 ||
    placeholderValues.has(normalized(approvedBy))
  )
    errors.push("MANAGEMENT_APPROVER_INVALID");

  if (!approvalDate) errors.push("MANAGEMENT_APPROVAL_DATE_REQUIRED");
  else if (!validIsoDate(approvalDate))
    errors.push("MANAGEMENT_APPROVAL_DATE_INVALID");
  else {
    const approvedAt = Date.parse(`${approvalDate}T00:00:00+08:00`);
    const now =
      referenceTime instanceof Date
        ? referenceTime.getTime()
        : typeof referenceTime === "number"
          ? referenceTime
          : Date.parse(referenceTime);
    if (!Number.isFinite(now)) errors.push("REFERENCE_TIME_INVALID");
    else if (approvedAt > now)
      errors.push("MANAGEMENT_APPROVAL_DATE_IN_FUTURE");
  }

  if (!approvalReference) errors.push("MANAGEMENT_APPROVAL_REFERENCE_REQUIRED");
  else if (
    approvalReference.length < 3 ||
    approvalReference.length > 200 ||
    placeholderValues.has(normalized(approvalReference))
  )
    errors.push("MANAGEMENT_APPROVAL_REFERENCE_INVALID");

  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    approvedBy,
    approvalDate,
    approvalReference,
  };
}

export function applyManagementApproval(policy = {}, approval = {}) {
  const validated = validateManagementApproval(approval);
  if (!validated.valid)
    throw new Error(`Management approval is invalid: ${validated.errors.join(", ")}`);
  const referenceLine = `Management approval reference: ${validated.approvalReference}`;
  const existingNotes = String(policy["Policy Notes"] || "").trim();
  return {
    ...policy,
    Status: "ACTIVE",
    "Policy Notes": existingNotes
      ? `${existingNotes}\n${referenceLine}`
      : referenceLine,
    "Approved By": validated.approvedBy,
    "Approved At": `${validated.approvalDate}T00:00:00+08:00`,
  };
}

export function policyKey(policy = {}) {
  return `${String(policy["Policy Code"] || "").trim().toUpperCase()}::${String(policy["Policy Version"] || "").trim().toUpperCase()}`;
}

export function policyStatus(policy = {}) {
  return normalized(policy.Status);
}

export function policyStateIdempotencyKey(policies = [], policyCode = "") {
  const code = String(policyCode).trim().toUpperCase();
  const state = policies
    .filter((policy) =>
      String(policy["Policy Code"] || "").trim().toUpperCase() === code
    )
    .map((policy) => `${policyKey(policy)}=${policyStatus(policy)}`)
    .sort()
    .join("|");
  let hash = 0xcbf29ce484222325n;
  for (const character of state) {
    hash ^= BigInt(character.codePointAt(0));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `${code}::${state ? state.split("|").length : 0}::${hash.toString(16).padStart(16, "0")}`;
}
