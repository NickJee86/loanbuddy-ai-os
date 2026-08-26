import assert from "node:assert/strict";
import test from "node:test";
import { calculatePreliminaryCreditAssessment, CREDIT_SCORE_WEIGHTS } from "../app/credit-engine.mjs";

const activePolicy = {
  policyCode: "LB_PERSONAL_LOAN",
  policyVersion: "V1-TEST",
  status: "ACTIVE",
  maximumPreliminaryDsr: 60,
  minimumNetDisposableIncome: 1000,
  minimumVerifiedNetIncome: 2500,
  minimumEmploymentTenureMonths: 6,
  minimumAge: 21,
  maximumAgeAtMaturity: 60,
  minimumLoanAmount: 1000,
  maximumLoanAmount: 100000,
  minimumTenureMonths: 6,
  maximumTenureMonths: 84,
  variableIncomeRecognitionPercent: 50,
  minimumAutoLmsScore: 80,
  manualReviewScore: 65,
};

const strongApplicant = {
  consentStatus: "GRANTED",
  age: 35,
  employmentTenureMonths: 48,
  verifiedNetIncome: 5000,
  variableIncomeAverage: 400,
  declaredMonthlyCommitments: 500,
  verifiedNonBureauCommitments: 0,
  proposedInstalment: 600,
  employerRiskBand: "LOW",
  incomeStabilityGrade: "A",
  documentVerificationStatus: "VERIFIED",
  fraudFlag: "NO",
  requestedAmount: 25000,
  requestedTenureMonths: 60,
  salaryBankIn: "YES",
};

test("scorecard weights total 100", () => {
  assert.equal(Object.values(CREDIT_SCORE_WEIGHTS).reduce((total, value) => total + value, 0), 100);
});

test("calculates preliminary DSR and NDI from verified income and commitments", () => {
  const result = calculatePreliminaryCreditAssessment(strongApplicant, activePolicy);
  assert.equal(result.assessableIncome, 5200);
  assert.equal(result.recognisedVariableIncome, 200);
  assert.equal(result.preliminaryDsr, 21.15);
  assert.equal(result.netDisposableIncome, 4100);
  assert.equal(result.hardRuleStatus, "PASS");
  assert.equal(result.lmsSubmissionEligible, true);
  assert.equal(result.assessmentStatus, "ELIGIBLE_FOR_LMS");
});

test("fails hard rules when DSR exceeds policy", () => {
  const result = calculatePreliminaryCreditAssessment({ ...strongApplicant, declaredMonthlyCommitments: 2600, proposedInstalment: 800 }, activePolicy);
  assert.equal(result.hardRuleStatus, "FAIL");
  assert.ok(result.hardRuleReasons.includes("DSR_ABOVE_POLICY"));
  assert.equal(result.lmsSubmissionEligible, false);
});

test("never sends an incomplete assessment to LMS", () => {
  const result = calculatePreliminaryCreditAssessment({ ...strongApplicant, proposedInstalment: "" }, activePolicy);
  assert.equal(result.hardRuleStatus, "INCOMPLETE");
  assert.ok(result.missingInputs.includes("MISSING_PROPOSED_INSTALMENT"));
  assert.equal(result.lmsSubmissionEligible, false);
});

test("missing policy thresholds never fall back to invented score bands", () => {
  const result = calculatePreliminaryCreditAssessment(strongApplicant, {
    ...activePolicy,
    minimumAutoLmsScore: "",
    manualReviewScore: "",
  });
  assert.equal(result.hardRuleStatus, "INCOMPLETE");
  assert.ok(result.missingInputs.includes("MISSING_POLICY_MINIMUM_AUTO_LMS_SCORE"));
  assert.ok(result.missingInputs.includes("MISSING_POLICY_MANUAL_REVIEW_SCORE"));
  assert.equal(result.lmsSubmissionEligible, false);
  assert.equal(result.assessmentStatus, "INCOMPLETE");
});

test("missing variable income recognition stops the calculation instead of assuming zero", () => {
  const result = calculatePreliminaryCreditAssessment(strongApplicant, {
    ...activePolicy,
    variableIncomeRecognitionPercent: "",
  });
  assert.equal(result.recognisedVariableIncome, null);
  assert.equal(result.assessableIncome, null);
  assert.equal(result.hardRuleStatus, "INCOMPLETE");
  assert.equal(result.lmsSubmissionEligible, false);
});

test("out-of-range active policy values fail closed", () => {
  const result = calculatePreliminaryCreditAssessment(strongApplicant, {
    ...activePolicy,
    maximumPreliminaryDsr: 150,
    manualReviewScore: 90,
    minimumAutoLmsScore: 80,
  });
  assert.equal(result.hardRuleStatus, "INCOMPLETE");
  assert.ok(result.missingInputs.includes("INVALID_POLICY_MAXIMUM_DSR"));
  assert.ok(result.missingInputs.includes("INVALID_POLICY_SCORE_BANDS"));
  assert.equal(result.lmsSubmissionEligible, false);
});

test("shadow policy produces calculations but cannot submit", () => {
  const result = calculatePreliminaryCreditAssessment(strongApplicant, { ...activePolicy, status: "SHADOW" });
  assert.equal(result.hardRuleStatus, "PASS");
  assert.equal(result.assessmentStatus, "SHADOW_EVALUATED");
  assert.equal(result.lmsSubmissionEligible, false);
  assert.ok(result.reasonCodes.includes("POLICY_SHADOW_MODE"));
});

test("bureau data is not needed for the preliminary assessment", () => {
  const result = calculatePreliminaryCreditAssessment(strongApplicant, activePolicy);
  assert.equal(result.reasonCodes.some((code) => /CTOS|CCRIS|BUREAU/.test(code)), false);
  assert.equal(result.lmsSubmissionEligible, true);
});

test("fraud flags stop automatic LMS submission", () => {
  const result = calculatePreliminaryCreditAssessment({ ...strongApplicant, fraudFlag: "YES" }, activePolicy);
  assert.ok(result.hardRuleReasons.includes("FRAUD_FLAG"));
  assert.equal(result.lmsSubmissionEligible, false);
});

test("financial text containing hidden non-numeric content fails closed", () => {
  const result = calculatePreliminaryCreditAssessment(
    { ...strongApplicant, declaredMonthlyCommitments: "unknown500" },
    activePolicy,
  );
  assert.equal(result.hardRuleStatus, "INCOMPLETE");
  assert.ok(result.missingInputs.includes("MISSING_DECLARED_MONTHLY_COMMITMENTS"));
  assert.equal(result.lmsSubmissionEligible, false);
});

test("negative commitments and non-positive instalments cannot improve affordability", () => {
  const negativeCommitment = calculatePreliminaryCreditAssessment(
    { ...strongApplicant, declaredMonthlyCommitments: -1000 },
    activePolicy,
  );
  assert.equal(negativeCommitment.hardRuleStatus, "INCOMPLETE");
  assert.ok(negativeCommitment.missingInputs.includes("INVALID_DECLARED_MONTHLY_COMMITMENTS"));

  const zeroInstalment = calculatePreliminaryCreditAssessment(
    { ...strongApplicant, proposedInstalment: 0 },
    activePolicy,
  );
  assert.equal(zeroInstalment.hardRuleStatus, "INCOMPLETE");
  assert.ok(zeroInstalment.missingInputs.includes("INVALID_PROPOSED_INSTALMENT"));
  assert.equal(zeroInstalment.lmsSubmissionEligible, false);
});

test("formatted Malaysian currency and percentage values remain supported", () => {
  const result = calculatePreliminaryCreditAssessment(
    {
      ...strongApplicant,
      verifiedNetIncome: "RM 5,000.00",
      declaredMonthlyCommitments: "500.00",
    },
    { ...activePolicy, maximumPreliminaryDsr: "60%" },
  );
  assert.equal(result.hardRuleStatus, "PASS");
  assert.equal(result.assessableIncome, 5200);
});
