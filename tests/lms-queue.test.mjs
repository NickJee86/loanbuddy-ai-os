import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateLmsQueueEligibility,
  validateLmsQueueLeadContext,
} from "../app/lms-queue.mjs";

const assessment = { "Assessment ID": "CA-001", "Lead ID": "LB-001", "Created At": "2026-08-10T01:00:00Z", "Assessed At": "2026-08-10T01:00:00Z", "Policy Code": "LB_PERSONAL_LOAN", "Policy Version": "V2", "Assessment Mode": "ACTIVE", "Assessment Status": "ELIGIBLE_FOR_LMS", "Hard Rule Status": "PASS", "LMS Submission Eligibility": "YES", "Manual Review Required": "NO" };
const policy = {
  "Policy Code": "LB_PERSONAL_LOAN",
  "Policy Version": "V2",
  Status: "ACTIVE",
  "Effective From": "2026-08-10",
  "Product Name": "Personal Loan",
  Currency: "MYR",
  "Minimum Age": "21",
  "Maximum Age At Maturity": "65",
  "Minimum Employment Tenure Months": "3",
  "Minimum Verified Net Income": "1700",
  "Maximum Preliminary DSR": "60",
  "Minimum Net Disposable Income": "1500",
  "Minimum Loan Amount": "1000",
  "Maximum Loan Amount": "100000",
  "Minimum Tenure Months": "6",
  "Maximum Tenure Months": "66",
  "Variable Income Recognition Percent": "100",
  "Minimum Auto LMS Score": "80",
  "Manual Review Score": "65",
  "Required Documents": "IC_FRONT,IC_BACK,PAYSLIP,BANK_STATEMENT",
  "Optional Documents": "EPF_STATEMENT",
  "Approved By": "management-approver",
  "Approved At": "2026-08-10T00:30:00Z",
};
const referenceTime = "2026-08-10T02:00:00Z";
const consent = {
  "Lead ID": "LB-001",
  "Document Type": "CTOS_CCRIS_CONSENT",
  Status: "VERIFIED",
  "Verification Status": "VERIFIED",
  "Consent Version": "V4.0-01112020",
  "Verified At": "2026-08-10T01:30:00Z",
  "Verified By": "regional-manager",
};
const evaluate = (input) =>
  evaluateLmsQueueEligibility({
    policyEngineEnabled: true,
    documentRows: [consent],
    ...input,
  });

test("only a policy-passed assessment under the matching active policy can queue", () => {
  const result = evaluate({ leadId: "LB-001", assessmentRows: [assessment], policyRows: [policy], referenceTime });
  assert.equal(result.eligible, true);
  assert.match(result.idempotencyKey, /^LB-LMS-LB-001-V2-CA-001$/);
});

test("shadow policies never queue", () => {
  const result = evaluate({ leadId: "LB-001", assessmentRows: [assessment], policyRows: [{ ...policy, Status: "SHADOW" }], referenceTime });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("MATCHING_ACTIVE_POLICY_NOT_FOUND"));
});

test("manual review and hard-rule failures stay locked", () => {
  const result = evaluate({ leadId: "LB-001", assessmentRows: [{ ...assessment, "Hard Rule Status": "FAIL", "Manual Review Required": "YES" }], policyRows: [policy], referenceTime });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("HARD_RULES_NOT_PASSED"));
  assert.ok(result.reasons.includes("MANUAL_REVIEW_NOT_CLEARED"));
});

test("the same assessment cannot create a duplicate queue item", () => {
  const existingQueueRows = [{ "Idempotency Key": "LB-LMS-LB-001-V2-CA-001", "Lead ID": "LB-001", "Assessment ID": "CA-001" }];
  const result = evaluate({ leadId: "LB-001", assessmentRows: [assessment], policyRows: [policy], existingQueueRows, referenceTime });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("DUPLICATE_LMS_QUEUE_REQUEST"));
});

test("queue creation fails closed when assessment identity or policy reference is missing", () => {
  const result = evaluate({
    leadId: "LB-001",
    assessmentRows: [
      {
        ...assessment,
        "Assessment ID": "",
        "Policy Version": "",
      },
    ],
    policyRows: [policy],
    referenceTime,
  });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("ASSESSMENT_ID_MISSING"));
  assert.ok(result.reasons.includes("POLICY_REFERENCE_MISSING"));
});

test("manual-review clearance must be explicit before queue creation", () => {
  const result = evaluate({
    leadId: "LB-001",
    assessmentRows: [{ ...assessment, "Manual Review Required": "" }],
    policyRows: [policy],
    referenceTime,
  });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("MANUAL_REVIEW_NOT_CLEARED"));
});

test("only ACTIVE-mode assessments can enter the queue", () => {
  const result = evaluate({
    leadId: "LB-001",
    assessmentRows: [{ ...assessment, "Assessment Mode": "SHADOW" }],
    policyRows: [policy],
    referenceTime,
  });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("ASSESSMENT_MODE_NOT_ACTIVE"));
});

test("production aliases cannot bypass the canonical ACTIVE assessment mode", () => {
  const result = evaluate({
    leadId: "LB-001",
    assessmentRows: [{ ...assessment, "Assessment Mode": "PRODUCTION" }],
    policyRows: [policy],
    referenceTime,
  });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("ASSESSMENT_MODE_NOT_ACTIVE"));
});

test("LMS queue lead routing and visibility must be explicit and consistent", () => {
  assert.deepEqual(
    validateLmsQueueLeadContext({
      "Processing Route": "AI_DIRECT",
      "Case Visibility": "REGIONAL_ADMIN_ONLY",
      "Document Status": "VERIFIED",
      "Current Stage": "CREDIT_ASSESSMENT",
    }),
    { valid: true, reasons: [], processingRoute: "AI_DIRECT" },
  );
  assert.deepEqual(
    validateLmsQueueLeadContext({
      "Processing Route": "SA_ASSIST",
      "Case Visibility": "BRANCH_SA",
      "Document Status": "VERIFIED",
      "Current Stage": "READY_FOR_LMS",
    }),
    { valid: true, reasons: [], processingRoute: "SA_ASSIST" },
  );

  const missingRoute = validateLmsQueueLeadContext({
    "Case Visibility": "REGIONAL_ADMIN_ONLY",
  });
  assert.equal(missingRoute.valid, false);
  assert.ok(missingRoute.reasons.includes("PROCESSING_ROUTE_INVALID"));

  const exposedAiDirect = validateLmsQueueLeadContext({
    "Processing Route": "AI_DIRECT",
    "Case Visibility": "BRANCH_SA",
    "Document Status": "VERIFIED",
    "Current Stage": "CREDIT_ASSESSMENT",
  });
  assert.equal(exposedAiDirect.valid, false);
  assert.ok(exposedAiDirect.reasons.includes("AI_DIRECT_VISIBILITY_INVALID"));

  const hiddenSaAssist = validateLmsQueueLeadContext({
    "Processing Route": "SA_ASSIST",
    "Case Visibility": "REGIONAL_ADMIN_ONLY",
    "Document Status": "VERIFIED",
    "Current Stage": "CREDIT_ASSESSMENT",
  });
  assert.equal(hiddenSaAssist.valid, false);
  assert.ok(hiddenSaAssist.reasons.includes("SA_ASSIST_VISIBILITY_INVALID"));
});

test("LMS queue requires verified documents and a queue-ready lead stage", () => {
  const incompleteDocuments = validateLmsQueueLeadContext({
    "Processing Route": "AI_DIRECT",
    "Case Visibility": "REGIONAL_ADMIN_ONLY",
    "Document Status": "IN_PROGRESS",
    "Current Stage": "CREDIT_ASSESSMENT",
  });
  assert.equal(incompleteDocuments.valid, false);
  assert.ok(
    incompleteDocuments.reasons.includes("DOCUMENT_STATUS_NOT_VERIFIED"),
  );

  const prematureStage = validateLmsQueueLeadContext({
    "Processing Route": "AI_DIRECT",
    "Case Visibility": "REGIONAL_ADMIN_ONLY",
    "Document Status": "VERIFIED",
    "Current Stage": "DOCUMENT_VERIFICATION",
  });
  assert.equal(prematureStage.valid, false);
  assert.ok(prematureStage.reasons.includes("LEAD_STAGE_NOT_QUEUE_READY"));
});

test("invalid or not-yet-effective active policies fail closed", () => {
  const invalid = evaluate({
    leadId: "LB-001",
    assessmentRows: [assessment],
    policyRows: [{ ...policy, "Minimum Verified Net Income": "" }],
    referenceTime,
  });
  assert.equal(invalid.eligible, false);
  assert.ok(invalid.reasons.includes("MATCHING_ACTIVE_POLICY_INVALID"));

  const future = evaluate({
    leadId: "LB-001",
    assessmentRows: [assessment],
    policyRows: [{ ...policy, "Effective From": "2026-08-11" }],
    referenceTime,
  });
  assert.equal(future.eligible, false);
  assert.ok(future.reasons.includes("POLICY_NOT_EFFECTIVE"));
});

test("assessments created before policy approval cannot queue", () => {
  const result = evaluate({
    leadId: "LB-001",
    assessmentRows: [{ ...assessment, "Assessed At": "2026-08-10T00:00:00Z" }],
    policyRows: [policy],
    referenceTime,
  });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("ASSESSMENT_PRECEDES_POLICY_APPROVAL"));
});

test("the last appended assessment is authoritative and must have a valid timestamp", () => {
  const result = evaluate({
    leadId: "LB-001",
    assessmentRows: [assessment, { ...assessment, "Assessment ID": "CA-002", "Assessed At": "invalid", "Created At": "invalid" }],
    policyRows: [policy],
    referenceTime,
  });
  assert.equal(result.assessment["Assessment ID"], "CA-002");
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("ASSESSMENT_TIMESTAMP_INVALID"));
});

test("the Admin master switch blocks an otherwise eligible assessment", () => {
  const result = evaluateLmsQueueEligibility({
    leadId: "LB-001",
    assessmentRows: [assessment],
    policyRows: [policy],
    documentRows: [consent],
    policyEngineEnabled: false,
    referenceTime,
  });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("CREDIT_POLICY_ENGINE_DISABLED"));
});

test("a policy-passed case cannot queue without verified CTOS / CCRIS consent", () => {
  const result = evaluate({
    leadId: "LB-001",
    assessmentRows: [assessment],
    policyRows: [policy],
    documentRows: [],
    referenceTime,
  });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("CTOS_CCRIS_CONSENT_NOT_RECEIVED"));
});
