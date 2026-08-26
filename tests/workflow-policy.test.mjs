import assert from "node:assert/strict";
import test from "node:test";
import { assessAutomationDecision } from "../app/workflow-policy.mjs";

const completeChecklist = [
  { type: "IC_FRONT", label: "IC Front", required: true, record: {} },
  { type: "IC_BACK", label: "IC Back", required: true, record: {} },
  { type: "PAYSLIP", label: "Latest Payslip", required: true, record: {} },
  { type: "BANK_STATEMENT", label: "Bank Statement", required: true, record: {} },
  { type: "EPF_STATEMENT", label: "EPF Statement", required: false, record: null },
];

test("AI direct cases stay with AI while required documents are missing", () => {
  const checklist = completeChecklist.map((item, index) => index === 3 ? { ...item, record: null } : item);
  const result = assessAutomationDecision({ lead: { processingRoute: "AI_DIRECT" }, checklist });
  assert.equal(result.code, "AI_DOCUMENT_FOLLOW_UP");
  assert.equal(result.readyForLms, false);
});

test("complete qualified AI cases go to verification before LMS", () => {
  const result = assessAutomationDecision({
    lead: { processingRoute: "AI_DIRECT", documentStatus: "IN_PROGRESS", stage: "DOCUMENT_VERIFICATION" },
    checklist: completeChecklist,
    state: { "Qualification Status": "QUALIFIED" },
  });
  assert.equal(result.code, "AI_DOCUMENT_VERIFICATION");
});

test("verified AI direct cases become automatically LMS ready without staff approval", () => {
  const result = assessAutomationDecision({
    lead: { processingRoute: "AI_DIRECT", documentStatus: "VERIFIED", stage: "LEAD_SCORING" },
    checklist: completeChecklist,
    state: { "Qualification Status": "QUALIFIED" },
    verification: { "Overall Verification Status": "VERIFIED", "Manual Review Required": "NO" },
    assessment: { "Assessment ID": "CA-001", "Assessment Status": "ELIGIBLE_FOR_LMS", "Hard Rule Status": "PASS", "LMS Submission Eligibility": "YES", "Manual Review Required": "NO" },
    queueEligibility: { eligible: true, reasons: [] },
  });
  assert.equal(result.code, "AUTO_LMS_READY");
  assert.equal(result.readyForLms, true);
});

test("eligible cases request and verify consent before becoming LMS ready", () => {
  const base = {
    lead: {
      processingRoute: "AI_DIRECT",
      documentStatus: "VERIFIED",
      stage: "CREDIT_ASSESSMENT",
    },
    checklist: completeChecklist,
    state: { "Qualification Status": "QUALIFIED" },
    verification: {
      "Overall Verification Status": "VERIFIED",
      "Manual Review Required": "NO",
    },
    assessment: {
      "Assessment ID": "CA-CONSENT",
      "Assessment Status": "ELIGIBLE_FOR_LMS",
      "Hard Rule Status": "PASS",
      "LMS Submission Eligibility": "YES",
      "Manual Review Required": "NO",
    },
  };
  const missing = assessAutomationDecision({
    ...base,
    queueEligibility: {
      eligible: false,
      reasons: ["CTOS_CCRIS_CONSENT_NOT_RECEIVED"],
    },
  });
  assert.equal(missing.code, "REQUEST_CREDIT_BUREAU_CONSENT");
  const pending = assessAutomationDecision({
    ...base,
    queueEligibility: {
      eligible: false,
      reasons: ["CTOS_CCRIS_CONSENT_NOT_VERIFIED"],
    },
  });
  assert.equal(pending.code, "VERIFY_CREDIT_BUREAU_CONSENT");
});

test("an eligible-looking assessment remains locked when the ACTIVE policy gate fails", () => {
  const result = assessAutomationDecision({
    lead: { processingRoute: "AI_DIRECT", documentStatus: "VERIFIED", stage: "CREDIT_ASSESSMENT" },
    checklist: completeChecklist,
    state: { "Qualification Status": "QUALIFIED" },
    verification: { "Overall Verification Status": "VERIFIED", "Manual Review Required": "NO" },
    assessment: { "Assessment ID": "CA-LOCKED", "Assessment Status": "ELIGIBLE_FOR_LMS", "Hard Rule Status": "PASS", "LMS Submission Eligibility": "YES", "Manual Review Required": "NO" },
    queueEligibility: { eligible: false, reasons: ["ASSESSMENT_MODE_NOT_ACTIVE"] },
  });
  assert.equal(result.code, "CREDIT_POLICY_LOCKED");
  assert.equal(result.readyForLms, false);
});

test("verified cases cannot bypass the deterministic Pre-LMS credit assessment", () => {
  const result = assessAutomationDecision({
    lead: { processingRoute: "AI_DIRECT", documentStatus: "VERIFIED", stage: "CREDIT_ASSESSMENT" },
    checklist: completeChecklist,
    state: { "Qualification Status": "QUALIFIED" },
    verification: { "Overall Verification Status": "VERIFIED", "Manual Review Required": "NO" },
  });
  assert.equal(result.code, "PRE_LMS_CREDIT_ASSESSMENT");
  assert.equal(result.readyForLms, false);
});

test("CREDIT_ASSESSMENT stage cannot fall backwards to qualification collection", () => {
  const result = assessAutomationDecision({
    lead: { processingRoute: "AI_DIRECT", documentStatus: "VERIFIED", stage: "CREDIT_ASSESSMENT" },
    checklist: completeChecklist,
    verification: { "Overall Verification Status": "VERIFIED", "Manual Review Required": "NO" },
  });
  assert.equal(result.code, "PRE_LMS_CREDIT_ASSESSMENT");
  assert.equal(result.readyForLms, false);
});

test("shadow assessments never submit to LMS", () => {
  const result = assessAutomationDecision({
    lead: { processingRoute: "AI_DIRECT", documentStatus: "VERIFIED", stage: "CREDIT_ASSESSMENT" },
    checklist: completeChecklist,
    state: { "Qualification Status": "QUALIFIED" },
    verification: { "Overall Verification Status": "VERIFIED", "Manual Review Required": "NO" },
    assessment: { "Assessment ID": "CA-002", "Assessment Status": "SHADOW_EVALUATED", "Hard Rule Status": "PASS", "LMS Submission Eligibility": "NO" },
  });
  assert.equal(result.code, "CREDIT_SHADOW_REVIEW");
  assert.equal(result.readyForLms, false);
});

test("credit policy manual review stays with regional management instead of branch SA", () => {
  const result = assessAutomationDecision({
    lead: { processingRoute: "AI_DIRECT", documentStatus: "VERIFIED", stage: "CREDIT_ASSESSMENT" },
    checklist: completeChecklist,
    state: { "Qualification Status": "QUALIFIED" },
    verification: { "Overall Verification Status": "VERIFIED", "Manual Review Required": "NO" },
    assessment: { "Assessment ID": "CA-003", "Assessment Status": "MANUAL_REVIEW", "Hard Rule Status": "PASS", "Manual Review Required": "YES" },
  });
  assert.equal(result.code, "REGIONAL_CREDIT_REVIEW");
  assert.equal(result.readyForLms, false);
});

test("manual review or re-upload conditions route the case to SA assistance", () => {
  const result = assessAutomationDecision({
    lead: { processingRoute: "AI_DIRECT", escalationReason: "—" },
    checklist: completeChecklist,
    verification: { "Overall Verification Status": "MANUAL_REVIEW", "Manual Review Required": "YES" },
  });
  assert.equal(result.code, "SA_ASSIST_REQUIRED");
  assert.equal(result.readyForLms, false);
});

test("SA assisted cases remain with SA until missing documents are complete", () => {
  const checklist = completeChecklist.map((item, index) => index < 2 ? item : item.required ? { ...item, record: null } : item);
  const result = assessAutomationDecision({ lead: { processingRoute: "SA_ASSIST" }, checklist });
  assert.equal(result.code, "SA_DOCUMENT_ASSIST");
});

test("an already-routed SA case continues its workflow instead of being re-escalated", () => {
  const result = assessAutomationDecision({
    lead: { processingRoute: "SA_ASSIST", escalationReason: "MANUAL_APPLICATION" },
    checklist: completeChecklist,
  });
  assert.equal(result.code, "SA_COMPLETE_QUALIFICATION");
});

test("existing LMS submissions remain in the LMS lifecycle", () => {
  const result = assessAutomationDecision({ lead: { processingRoute: "AI_DIRECT", lmsStatus: "PROCESSING" }, checklist: [] });
  assert.equal(result.code, "LMS_ACTIVE");
  assert.equal(result.readyForLms, true);
});
