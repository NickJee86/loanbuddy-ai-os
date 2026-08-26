import assert from "node:assert/strict";
import test from "node:test";
import {
  applyManagementApproval,
  buildDraftPolicy,
  policyStateIdempotencyKey,
  validateManagementApproval,
  validatePolicyForActivation,
} from "../app/credit-policy.mjs";

const complete = {
  "Policy Code": "LB_PERSONAL_LOAN", "Policy Version": "V2", Status: "DRAFT", "Effective From": "2026-09-01",
  "Product Name": "Personal Loan", Currency: "MYR", "Minimum Age": "21", "Maximum Age At Maturity": "60",
  "Minimum Employment Tenure Months": "6", "Minimum Verified Net Income": "1800", "Maximum Preliminary DSR": "60",
  "Minimum Net Disposable Income": "1000", "Minimum Loan Amount": "1000", "Maximum Loan Amount": "100000",
  "Minimum Tenure Months": "6", "Maximum Tenure Months": "84", "Variable Income Recognition Percent": "50",
  "Minimum Auto LMS Score": "80", "Manual Review Score": "65", "Required Documents": "IC_FRONT,IC_BACK,PAYSLIP,BANK_STATEMENT",
};

test("a complete approved policy can be activated", () => {
  assert.deepEqual(validatePolicyForActivation(complete), { valid: true, errors: [] });
});

test("incomplete policies stay locked", () => {
  const result = validatePolicyForActivation({ ...complete, "Minimum Verified Net Income": "" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("MISSING_MINIMUM_VERIFIED_NET_INCOME"));
});

test("shadow policy versions are immutable and cannot be activated", () => {
  const result = validatePolicyForActivation({ ...complete, Status: "SHADOW" });
  assert.ok(result.errors.includes("SHADOW_VERSION_IMMUTABLE"));
});

test("retired policy versions are terminal and cannot be reactivated", () => {
  const result = validatePolicyForActivation({ ...complete, Status: "RETIRED" });
  assert.ok(result.errors.includes("RETIRED_VERSION_IMMUTABLE"));
});

test("invalid score, amount and tenure bands are rejected", () => {
  const result = validatePolicyForActivation({ ...complete, "Minimum Auto LMS Score": "60", "Manual Review Score": "70", "Minimum Loan Amount": "9000", "Maximum Loan Amount": "5000", "Minimum Tenure Months": "60", "Maximum Tenure Months": "24" });
  assert.ok(result.errors.includes("SCORE_BANDS_INVALID"));
  assert.ok(result.errors.includes("LOAN_AMOUNT_RANGE_INVALID"));
  assert.ok(result.errors.includes("TENURE_RANGE_INVALID"));
});

test("invalid dates, negative values and arbitrary document labels are rejected", () => {
  const result = validatePolicyForActivation({
    ...complete,
    "Effective From": "not-a-date",
    "Minimum Age": "0",
    "Maximum Age At Maturity": "1",
    "Minimum Employment Tenure Months": "-12",
    "Minimum Verified Net Income": "-100",
    "Minimum Net Disposable Income": "-100",
    "Minimum Loan Amount": "-100",
    "Maximum Loan Amount": "-50",
    "Minimum Tenure Months": "-12",
    "Maximum Tenure Months": "-1",
    "Required Documents": "TYPO",
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("INVALID_EFFECTIVE_FROM"));
  assert.ok(result.errors.includes("MINIMUM_AGE_OUT_OF_RANGE"));
  assert.ok(result.errors.includes("EMPLOYMENT_TENURE_OUT_OF_RANGE"));
  assert.ok(result.errors.includes("MINIMUM_VERIFIED_NET_INCOME_OUT_OF_RANGE"));
  assert.ok(result.errors.includes("REQUIRED_DOCUMENTS_INVALID"));
});

test("numeric fields reject text that merely contains a number", () => {
  const result = validatePolicyForActivation({ ...complete, "Minimum Verified Net Income": "RM eighteen hundred 1800" });
  assert.ok(result.errors.includes("INVALID_MINIMUM_VERIFIED_NET_INCOME"));
});

test("policy mutation reservations are stable for one state and change after a status transition", () => {
  const rows = [
    { "Policy Code": "OTHER", "Policy Version": "V1", Status: "ACTIVE" },
    { "Policy Code": "LB_PERSONAL_LOAN", "Policy Version": "V2", Status: "DRAFT" },
    { "Policy Code": "LB_PERSONAL_LOAN", "Policy Version": "V1", Status: "SHADOW" },
  ];
  const initial = policyStateIdempotencyKey(rows, "lb_personal_loan");
  assert.equal(initial, policyStateIdempotencyKey([...rows].reverse(), "LB_PERSONAL_LOAN"));
  assert.notEqual(
    initial,
    policyStateIdempotencyKey(
      rows.map((row) => row["Policy Version"] === "V2" ? { ...row, Status: "ACTIVE" } : row),
      "LB_PERSONAL_LOAN",
    ),
  );
});

test("new versions always start as unapproved drafts", () => {
  const draft = buildDraftPolicy({
    ...complete,
    Status: "ACTIVE",
    "Approved By": "FORGED",
    "Approved At": "2026-08-10T00:00:00.000Z",
  });
  assert.equal(draft.Status, "DRAFT");
  assert.equal(draft["Approved By"], "");
  assert.equal(draft["Approved At"], "");
});

test("activation requires a real management approval record", () => {
  const missing = validateManagementApproval({}, "2026-08-11T12:00:00+08:00");
  assert.equal(missing.valid, false);
  assert.ok(missing.errors.includes("MANAGEMENT_APPROVER_REQUIRED"));
  assert.ok(missing.errors.includes("MANAGEMENT_APPROVAL_DATE_REQUIRED"));
  assert.ok(missing.errors.includes("MANAGEMENT_APPROVAL_REFERENCE_REQUIRED"));

  const placeholder = validateManagementApproval(
    {
      approvedBy: "PENDING",
      approvalDate: "2026-08-12",
      approvalReference: "TEST",
    },
    "2026-08-11T12:00:00+08:00",
  );
  assert.ok(placeholder.errors.includes("MANAGEMENT_APPROVER_INVALID"));
  assert.ok(placeholder.errors.includes("MANAGEMENT_APPROVAL_DATE_IN_FUTURE"));
  assert.ok(placeholder.errors.includes("MANAGEMENT_APPROVAL_REFERENCE_INVALID"));
});

test("management approval records the approver and reference without changing thresholds", () => {
  const activated = applyManagementApproval(complete, {
    approvedBy: "Credit Committee",
    approvalDate: "2026-08-11",
    approvalReference: "CC-2026-08-11-01",
  });
  assert.equal(activated.Status, "ACTIVE");
  assert.equal(activated["Approved By"], "Credit Committee");
  assert.equal(activated["Approved At"], "2026-08-11T00:00:00+08:00");
  assert.match(activated["Policy Notes"], /CC-2026-08-11-01/);
  assert.equal(
    activated["Minimum Verified Net Income"],
    complete["Minimum Verified Net Income"],
  );
});
