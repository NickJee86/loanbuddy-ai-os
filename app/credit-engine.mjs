function numberValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let normalized = String(value ?? "").trim();
  if (!normalized) return null;
  normalized = normalized
    .replace(/^(?:RM|MYR)\s*/i, "")
    .replace(/%$/, "")
    .replace(/[\s,]/g, "");
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalized(value) {
  return String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function bounded(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function percentage(value) {
  return Math.round(value * 10000) / 100;
}

function money(value) {
  return Math.round(value * 100) / 100;
}

function present(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function addFailure(failures, condition, code) {
  if (condition) failures.push(code);
}

export function calculatePreliminaryCreditAssessment(input = {}, policy = {}) {
  const verifiedNetIncome = numberValue(input.verifiedNetIncome);
  const declaredCommitments = numberValue(input.declaredMonthlyCommitments);
  const verifiedNonBureauCommitmentsValue = numberValue(
    input.verifiedNonBureauCommitments,
  );
  const verifiedNonBureauCommitments = verifiedNonBureauCommitmentsValue ?? 0;
  const proposedInstalment = numberValue(input.proposedInstalment);
  const variableIncomeAverageValue = numberValue(input.variableIncomeAverage);
  const variableIncomeAverage = variableIncomeAverageValue ?? 0;
  const variableIncomeRecognitionPercent = numberValue(
    policy.variableIncomeRecognitionPercent,
  );
  const variableRecognition = variableIncomeRecognitionPercent === null
    ? null
    : bounded(variableIncomeRecognitionPercent, 0, 100) / 100;
  const recognisedVariableIncome = variableRecognition === null
    ? null
    : money(variableIncomeAverage * variableRecognition);
  const assessableIncome = verifiedNetIncome === null || recognisedVariableIncome === null
    ? null
    : money(verifiedNetIncome + recognisedVariableIncome);
  const totalCommitments = declaredCommitments === null ? null : money(declaredCommitments + verifiedNonBureauCommitments);
  const preliminaryDsr = assessableIncome && totalCommitments !== null && proposedInstalment !== null
    ? percentage((totalCommitments + proposedInstalment) / assessableIncome)
    : null;
  const netDisposableIncome = assessableIncome !== null && totalCommitments !== null && proposedInstalment !== null
    ? money(assessableIncome - totalCommitments - proposedInstalment)
    : null;

  const maximumDsr = numberValue(policy.maximumPreliminaryDsr);
  const minimumNdi = numberValue(policy.minimumNetDisposableIncome);
  const minimumIncome = numberValue(policy.minimumVerifiedNetIncome);
  const minimumEmploymentTenure = numberValue(policy.minimumEmploymentTenureMonths);
  const minimumAge = numberValue(policy.minimumAge);
  const maximumAgeAtMaturity = numberValue(policy.maximumAgeAtMaturity);
  const minimumLoanAmount = numberValue(policy.minimumLoanAmount);
  const maximumLoanAmount = numberValue(policy.maximumLoanAmount);
  const minimumTenure = numberValue(policy.minimumTenureMonths);
  const maximumTenure = numberValue(policy.maximumTenureMonths);
  const minimumAutoScore = numberValue(policy.minimumAutoLmsScore);
  const manualReviewScore = numberValue(policy.manualReviewScore);

  const age = numberValue(input.age);
  const employmentTenure = numberValue(input.employmentTenureMonths);
  const requestedAmount = numberValue(input.requestedAmount);
  const requestedTenure = numberValue(input.requestedTenureMonths);
  const ageAtMaturity = age !== null && requestedTenure !== null ? age + requestedTenure / 12 : null;
  const consent = normalized(input.consentStatus);
  const documentStatus = normalized(input.documentVerificationStatus);
  const fraudFlag = normalized(input.fraudFlag);
  const employerRisk = normalized(input.employerRiskBand);
  const incomeStability = normalized(input.incomeStabilityGrade);
  const policyStatus = normalized(policy.status);

  const requiredInputs = {
    CONSENT_STATUS: present(input.consentStatus),
    VERIFIED_NET_INCOME: verifiedNetIncome !== null,
    DECLARED_MONTHLY_COMMITMENTS: declaredCommitments !== null,
    PROPOSED_INSTALMENT: proposedInstalment !== null,
    EMPLOYMENT_TENURE_MONTHS: employmentTenure !== null,
    EMPLOYER_RISK_BAND: present(input.employerRiskBand),
    INCOME_STABILITY_GRADE: present(input.incomeStabilityGrade),
    DOCUMENT_VERIFICATION_STATUS: present(input.documentVerificationStatus),
    FRAUD_FLAG: present(input.fraudFlag),
    REQUESTED_AMOUNT: requestedAmount !== null,
    REQUESTED_TENURE_MONTHS: requestedTenure !== null,
    POLICY_CODE: present(policy.policyCode),
    POLICY_VERSION: present(policy.policyVersion),
    POLICY_STATUS: present(policy.status),
    POLICY_MINIMUM_AGE: minimumAge !== null,
    POLICY_MAXIMUM_AGE_AT_MATURITY: maximumAgeAtMaturity !== null,
    POLICY_MINIMUM_EMPLOYMENT_TENURE_MONTHS:
      minimumEmploymentTenure !== null,
    POLICY_MINIMUM_VERIFIED_NET_INCOME: minimumIncome !== null,
    POLICY_MAXIMUM_PRELIMINARY_DSR: maximumDsr !== null,
    POLICY_MINIMUM_NET_DISPOSABLE_INCOME: minimumNdi !== null,
    POLICY_MINIMUM_LOAN_AMOUNT: minimumLoanAmount !== null,
    POLICY_MAXIMUM_LOAN_AMOUNT: maximumLoanAmount !== null,
    POLICY_MINIMUM_TENURE_MONTHS: minimumTenure !== null,
    POLICY_MAXIMUM_TENURE_MONTHS: maximumTenure !== null,
    POLICY_VARIABLE_INCOME_RECOGNITION_PERCENT:
      variableIncomeRecognitionPercent !== null,
    POLICY_MINIMUM_AUTO_LMS_SCORE: minimumAutoScore !== null,
    POLICY_MANUAL_REVIEW_SCORE: manualReviewScore !== null,
  };
  if (minimumAge !== null || maximumAgeAtMaturity !== null) requiredInputs.AGE = age !== null;
  const missingInputs = Object.entries(requiredInputs).filter(([, available]) => !available).map(([code]) => `MISSING_${code}`);
  const invalidApplicantInputs = [];
  addFailure(invalidApplicantInputs, verifiedNetIncome !== null && verifiedNetIncome <= 0, "INVALID_VERIFIED_NET_INCOME");
  addFailure(invalidApplicantInputs, declaredCommitments !== null && declaredCommitments < 0, "INVALID_DECLARED_MONTHLY_COMMITMENTS");
  addFailure(invalidApplicantInputs, present(input.verifiedNonBureauCommitments) && verifiedNonBureauCommitmentsValue === null, "INVALID_VERIFIED_NON_BUREAU_COMMITMENTS");
  addFailure(invalidApplicantInputs, verifiedNonBureauCommitmentsValue !== null && verifiedNonBureauCommitmentsValue < 0, "INVALID_VERIFIED_NON_BUREAU_COMMITMENTS");
  addFailure(invalidApplicantInputs, proposedInstalment !== null && proposedInstalment <= 0, "INVALID_PROPOSED_INSTALMENT");
  addFailure(invalidApplicantInputs, present(input.variableIncomeAverage) && variableIncomeAverageValue === null, "INVALID_VARIABLE_INCOME_AVERAGE");
  addFailure(invalidApplicantInputs, variableIncomeAverageValue !== null && variableIncomeAverageValue < 0, "INVALID_VARIABLE_INCOME_AVERAGE");
  addFailure(invalidApplicantInputs, age !== null && (!Number.isInteger(age) || age <= 0), "INVALID_APPLICANT_AGE");
  addFailure(invalidApplicantInputs, employmentTenure !== null && (!Number.isInteger(employmentTenure) || employmentTenure < 0), "INVALID_EMPLOYMENT_TENURE_MONTHS");
  addFailure(invalidApplicantInputs, requestedAmount !== null && requestedAmount <= 0, "INVALID_REQUESTED_AMOUNT");
  addFailure(invalidApplicantInputs, requestedTenure !== null && (!Number.isInteger(requestedTenure) || requestedTenure <= 0), "INVALID_REQUESTED_TENURE_MONTHS");
  missingInputs.push(...invalidApplicantInputs);
  const invalidPolicyInputs = [];
  addFailure(invalidPolicyInputs, minimumAge !== null && (!Number.isInteger(minimumAge) || minimumAge <= 0), "INVALID_POLICY_MINIMUM_AGE");
  addFailure(invalidPolicyInputs, maximumAgeAtMaturity !== null && (!Number.isInteger(maximumAgeAtMaturity) || maximumAgeAtMaturity <= 0), "INVALID_POLICY_MAXIMUM_AGE_AT_MATURITY");
  addFailure(invalidPolicyInputs, minimumAge !== null && maximumAgeAtMaturity !== null && minimumAge >= maximumAgeAtMaturity, "INVALID_POLICY_AGE_RANGE");
  addFailure(invalidPolicyInputs, minimumEmploymentTenure !== null && (!Number.isInteger(minimumEmploymentTenure) || minimumEmploymentTenure < 0), "INVALID_POLICY_EMPLOYMENT_TENURE");
  addFailure(invalidPolicyInputs, minimumIncome !== null && minimumIncome <= 0, "INVALID_POLICY_MINIMUM_INCOME");
  addFailure(invalidPolicyInputs, maximumDsr !== null && (maximumDsr <= 0 || maximumDsr > 100), "INVALID_POLICY_MAXIMUM_DSR");
  addFailure(invalidPolicyInputs, minimumNdi !== null && minimumNdi < 0, "INVALID_POLICY_MINIMUM_NDI");
  addFailure(invalidPolicyInputs, minimumLoanAmount !== null && minimumLoanAmount <= 0, "INVALID_POLICY_MINIMUM_LOAN_AMOUNT");
  addFailure(invalidPolicyInputs, maximumLoanAmount !== null && maximumLoanAmount <= 0, "INVALID_POLICY_MAXIMUM_LOAN_AMOUNT");
  addFailure(invalidPolicyInputs, minimumLoanAmount !== null && maximumLoanAmount !== null && minimumLoanAmount > maximumLoanAmount, "INVALID_POLICY_LOAN_AMOUNT_RANGE");
  addFailure(invalidPolicyInputs, minimumTenure !== null && (!Number.isInteger(minimumTenure) || minimumTenure <= 0), "INVALID_POLICY_MINIMUM_TENURE");
  addFailure(invalidPolicyInputs, maximumTenure !== null && (!Number.isInteger(maximumTenure) || maximumTenure <= 0), "INVALID_POLICY_MAXIMUM_TENURE");
  addFailure(invalidPolicyInputs, minimumTenure !== null && maximumTenure !== null && minimumTenure > maximumTenure, "INVALID_POLICY_TENURE_RANGE");
  addFailure(invalidPolicyInputs, variableIncomeRecognitionPercent !== null && (variableIncomeRecognitionPercent < 0 || variableIncomeRecognitionPercent > 100), "INVALID_POLICY_VARIABLE_INCOME_RECOGNITION");
  addFailure(invalidPolicyInputs, minimumAutoScore !== null && (minimumAutoScore <= 0 || minimumAutoScore > 100), "INVALID_POLICY_MINIMUM_AUTO_LMS_SCORE");
  addFailure(invalidPolicyInputs, manualReviewScore !== null && (manualReviewScore <= 0 || manualReviewScore > 100), "INVALID_POLICY_MANUAL_REVIEW_SCORE");
  addFailure(invalidPolicyInputs, minimumAutoScore !== null && manualReviewScore !== null && manualReviewScore > minimumAutoScore, "INVALID_POLICY_SCORE_BANDS");
  missingInputs.push(...invalidPolicyInputs);

  const failures = [];
  addFailure(failures, consent !== "GRANTED", "CONSENT_NOT_GRANTED");
  addFailure(failures, ["YES", "TRUE", "DETECTED", "SUSPECTED"].includes(fraudFlag), "FRAUD_FLAG");
  addFailure(failures, !["VERIFIED", "PASSED", "COMPLETED", "COMPLETE"].includes(documentStatus), "DOCUMENTS_NOT_VERIFIED");
  addFailure(failures, maximumDsr !== null && preliminaryDsr !== null && preliminaryDsr > maximumDsr, "DSR_ABOVE_POLICY");
  addFailure(failures, minimumNdi !== null && netDisposableIncome !== null && netDisposableIncome < minimumNdi, "NDI_BELOW_POLICY");
  addFailure(failures, minimumIncome !== null && assessableIncome !== null && assessableIncome < minimumIncome, "INCOME_BELOW_POLICY");
  addFailure(failures, minimumEmploymentTenure !== null && employmentTenure !== null && employmentTenure < minimumEmploymentTenure, "EMPLOYMENT_TENURE_BELOW_POLICY");
  addFailure(failures, minimumAge !== null && age !== null && age < minimumAge, "AGE_BELOW_POLICY");
  addFailure(failures, maximumAgeAtMaturity !== null && ageAtMaturity !== null && ageAtMaturity > maximumAgeAtMaturity, "AGE_AT_MATURITY_ABOVE_POLICY");
  addFailure(failures, minimumLoanAmount !== null && requestedAmount !== null && requestedAmount < minimumLoanAmount, "LOAN_AMOUNT_BELOW_POLICY");
  addFailure(failures, maximumLoanAmount !== null && requestedAmount !== null && requestedAmount > maximumLoanAmount, "LOAN_AMOUNT_ABOVE_POLICY");
  addFailure(failures, minimumTenure !== null && requestedTenure !== null && requestedTenure < minimumTenure, "TENURE_BELOW_POLICY");
  addFailure(failures, maximumTenure !== null && requestedTenure !== null && requestedTenure > maximumTenure, "TENURE_ABOVE_POLICY");

  let affordabilityScore = 0;
  if (preliminaryDsr !== null && maximumDsr !== null && maximumDsr > 0) {
    const ratio = preliminaryDsr / maximumDsr;
    affordabilityScore += ratio <= 0.5 ? 30 : ratio <= 0.7 ? 26 : ratio <= 0.85 ? 22 : ratio <= 1 ? 16 : 0;
  }
  if (netDisposableIncome !== null && minimumNdi !== null && minimumNdi > 0) {
    const ratio = netDisposableIncome / minimumNdi;
    affordabilityScore += ratio >= 2 ? 20 : ratio >= 1.5 ? 17 : ratio >= 1 ? 12 : 0;
  }

  let employmentScore = employmentTenure === null ? 0 : employmentTenure >= 36 ? 12 : employmentTenure >= 24 ? 10 : employmentTenure >= 12 ? 8 : employmentTenure >= 6 ? 5 : 2;
  employmentScore += employerRisk === "LOW" ? 8 : employerRisk === "MEDIUM" ? 4 : 0;

  let verificationScore = ["VERIFIED", "PASSED", "COMPLETED", "COMPLETE"].includes(documentStatus) ? 10 : 0;
  verificationScore += incomeStability === "A" ? 5 : incomeStability === "B" ? 3 : incomeStability === "C" ? 1 : 0;

  let productFitScore = 0;
  const amountInsidePolicy = requestedAmount !== null && (minimumLoanAmount === null || requestedAmount >= minimumLoanAmount) && (maximumLoanAmount === null || requestedAmount <= maximumLoanAmount);
  const tenureInsidePolicy = requestedTenure !== null && (minimumTenure === null || requestedTenure >= minimumTenure) && (maximumTenure === null || requestedTenure <= maximumTenure);
  if (amountInsidePolicy) productFitScore += 8;
  if (tenureInsidePolicy) productFitScore += 4;
  if (["YES", "TRUE", "VERIFIED"].includes(normalized(input.salaryBankIn))) productFitScore += 3;

  affordabilityScore = bounded(affordabilityScore, 0, 50);
  employmentScore = bounded(employmentScore, 0, 20);
  verificationScore = bounded(verificationScore, 0, 15);
  productFitScore = bounded(productFitScore, 0, 15);
  const preScreenScore = affordabilityScore + employmentScore + verificationScore + productFitScore;

  const hardRuleStatus = missingInputs.length ? "INCOMPLETE" : failures.length ? "FAIL" : "PASS";
  const unknownRisk = !["LOW", "MEDIUM", "HIGH"].includes(employerRisk);
  const scoreReview = hardRuleStatus === "PASS" &&
    manualReviewScore !== null &&
    minimumAutoScore !== null &&
    preScreenScore >= manualReviewScore &&
    preScreenScore < minimumAutoScore;
  const manualReviewRequired = hardRuleStatus === "PASS" && (scoreReview || employerRisk === "HIGH" || unknownRisk);
  const activePolicy = policyStatus === "ACTIVE";
  const lmsSubmissionEligible = activePolicy &&
    hardRuleStatus === "PASS" &&
    minimumAutoScore !== null &&
    preScreenScore >= minimumAutoScore &&
    !manualReviewRequired;
  const assessmentStatus = policyStatus === "SHADOW"
    ? "SHADOW_EVALUATED"
    : !activePolicy
      ? "POLICY_NOT_ACTIVE"
      : hardRuleStatus === "INCOMPLETE"
        ? "INCOMPLETE"
        : hardRuleStatus === "FAIL"
          ? "PRE_SCREEN_DECLINED"
          : manualReviewRequired
            ? "MANUAL_REVIEW"
            : lmsSubmissionEligible
              ? "ELIGIBLE_FOR_LMS"
              : "PRE_SCREEN_DECLINED";

  const riskGrade = hardRuleStatus === "FAIL" ? "HIGH" : preScreenScore >= 85 ? "LOW" : preScreenScore >= 70 ? "MEDIUM" : "HIGH";
  const reasonCodes = [...missingInputs, ...failures];
  if (!activePolicy) reasonCodes.push(policyStatus === "SHADOW" ? "POLICY_SHADOW_MODE" : "POLICY_NOT_ACTIVE");
  if (scoreReview) reasonCodes.push("SCORE_MANUAL_REVIEW_BAND");
  if (unknownRisk) reasonCodes.push("EMPLOYER_RISK_UNCLASSIFIED");
  if (hardRuleStatus === "PASS" && preScreenScore < manualReviewScore) reasonCodes.push("SCORE_BELOW_REVIEW_THRESHOLD");

  return {
    assessableIncome,
    recognisedVariableIncome,
    totalCommitments,
    preliminaryDsr,
    netDisposableIncome,
    affordabilityScore,
    employmentScore,
    verificationScore,
    productFitScore,
    preScreenScore,
    preliminaryRiskGrade: riskGrade,
    hardRuleStatus,
    hardRuleReasons: failures,
    missingInputs,
    reasonCodes: [...new Set(reasonCodes)],
    manualReviewRequired,
    lmsSubmissionEligible,
    assessmentStatus,
    policyCode: String(policy.policyCode || ""),
    policyVersion: String(policy.policyVersion || ""),
  };
}

export const CREDIT_SCORE_WEIGHTS = Object.freeze({
  affordability: 50,
  employment: 20,
  verification: 15,
  productFit: 15,
});
