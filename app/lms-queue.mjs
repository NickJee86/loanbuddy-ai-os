import { validatePolicyForActivation } from "./credit-policy.mjs";
import { evaluateCreditBureauConsent } from "./credit-bureau-consent.mjs";

function normalized(value) {
  return String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function assessmentTime(row) {
  return Date.parse(row?.["Assessed At"] || row?.["Created At"] || "");
}

function policyEffectiveTime(policy) {
  const value = String(policy?.["Effective From"] || "").trim();
  return Date.parse(`${value}T00:00:00+08:00`);
}

/** @param {string} leadId @param {Array<Record<string, string>>} assessmentRows */
export function latestAssessment(leadId, assessmentRows = []) {
  return assessmentRows
    .filter((row) => String(row?.["Lead ID"] || "").trim() === String(leadId || "").trim())
    .at(-1) || null;
}

/** @param {string} leadId @param {Record<string, string>} assessment */
export function lmsIdempotencyKey(leadId, assessment = {}) {
  const clean = (value) => String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9._-]+/g, "_");
  return `LB-LMS-${clean(leadId)}-${clean(assessment["Policy Version"])}-${clean(assessment["Assessment ID"])}`;
}

/** @param {Record<string, string>} lead */
export function validateLmsQueueLeadContext(lead = {}) {
  const processingRoute = normalized(lead["Processing Route"]);
  const caseVisibility = normalized(lead["Case Visibility"]);
  const documentStatus = normalized(lead["Document Status"]);
  const currentStage = normalized(
    lead["Current Stage"] || lead["Lead Status"],
  );
  const reasons = [];

  if (!["AI_DIRECT", "SA_ASSIST"].includes(processingRoute))
    reasons.push("PROCESSING_ROUTE_INVALID");
  else if (
    processingRoute === "AI_DIRECT" &&
    caseVisibility !== "REGIONAL_ADMIN_ONLY"
  )
    reasons.push("AI_DIRECT_VISIBILITY_INVALID");
  else if (
    processingRoute === "SA_ASSIST" &&
    caseVisibility !== "BRANCH_SA"
  )
    reasons.push("SA_ASSIST_VISIBILITY_INVALID");

  if (documentStatus !== "VERIFIED")
    reasons.push("DOCUMENT_STATUS_NOT_VERIFIED");
  if (!["CREDIT_ASSESSMENT", "READY_FOR_LMS"].includes(currentStage))
    reasons.push("LEAD_STAGE_NOT_QUEUE_READY");

  return {
    valid: reasons.length === 0,
    reasons,
    processingRoute: reasons.length === 0 ? processingRoute : "",
  };
}

/**
 * @param {{leadId?: string, assessmentRows?: Array<Record<string, string>>, policyRows?: Array<Record<string, string>>, existingQueueRows?: Array<Record<string, string>>, documentRows?: Array<Record<string, string>>, policyEngineEnabled?: boolean, referenceTime?: string | number | Date}} input
 */
export function evaluateLmsQueueEligibility({ leadId, assessmentRows = [], policyRows = [], existingQueueRows = [], documentRows = [], policyEngineEnabled = false, referenceTime = new Date() } = {}) {
  const reasons = [];
  if (!policyEngineEnabled) reasons.push("CREDIT_POLICY_ENGINE_DISABLED");
  const consent = evaluateCreditBureauConsent(leadId, documentRows);
  reasons.push(...consent.reasons);
  const assessment = latestAssessment(leadId, assessmentRows);
  if (!assessment) return { eligible: false, reasons: [...reasons, "ASSESSMENT_NOT_FOUND"], assessment: null, policy: null, consent, idempotencyKey: "" };

  const assessedAt = assessmentTime(assessment);
  const assessmentMode = normalized(assessment["Assessment Mode"]);
  const assessmentStatus = normalized(assessment["Assessment Status"]);
  const hardRuleStatus = normalized(assessment["Hard Rule Status"]);
  const lmsEligibility = normalized(assessment["LMS Submission Eligibility"]);
  const manualReview = normalized(assessment["Manual Review Required"]);
  if (!String(assessment["Assessment ID"] || "").trim()) reasons.push("ASSESSMENT_ID_MISSING");
  if (!Number.isFinite(assessedAt)) reasons.push("ASSESSMENT_TIMESTAMP_INVALID");
  if (assessmentMode !== "ACTIVE") reasons.push("ASSESSMENT_MODE_NOT_ACTIVE");
  if (assessmentStatus !== "ELIGIBLE_FOR_LMS") reasons.push("ASSESSMENT_NOT_ELIGIBLE");
  if (hardRuleStatus !== "PASS") reasons.push("HARD_RULES_NOT_PASSED");
  if (!["YES", "TRUE", "ELIGIBLE"].includes(lmsEligibility)) reasons.push("LMS_ELIGIBILITY_NOT_GRANTED");
  if (!["NO", "FALSE", "NOT_REQUIRED"].includes(manualReview)) reasons.push("MANUAL_REVIEW_NOT_CLEARED");

  const policyCode = String(assessment["Policy Code"] || "").trim();
  const policyVersion = String(assessment["Policy Version"] || "").trim();
  if (!policyCode || !policyVersion) reasons.push("POLICY_REFERENCE_MISSING");
  const policy = policyRows.find((row) =>
    String(row?.["Policy Code"] || "").trim() === policyCode &&
    String(row?.["Policy Version"] || "").trim() === policyVersion &&
    normalized(row?.Status) === "ACTIVE"
  ) || null;
  if (!policy) reasons.push("MATCHING_ACTIVE_POLICY_NOT_FOUND");
  if (policy) {
    const policyValidation = validatePolicyForActivation(policy);
    if (!policyValidation.valid) reasons.push("MATCHING_ACTIVE_POLICY_INVALID");

    const approvedBy = String(policy["Approved By"] || "").trim();
    const approvedAt = Date.parse(policy["Approved At"] || "");
    if (!approvedBy || !String(policy["Approved At"] || "").trim())
      reasons.push("POLICY_APPROVAL_MISSING");
    else if (!Number.isFinite(approvedAt))
      reasons.push("POLICY_APPROVAL_TIMESTAMP_INVALID");

    const effectiveAt = policyEffectiveTime(policy);
    const now = referenceTime instanceof Date
      ? referenceTime.getTime()
      : typeof referenceTime === "number"
        ? referenceTime
        : Date.parse(referenceTime);
    if (Number.isFinite(effectiveAt) && Number.isFinite(now) && effectiveAt > now)
      reasons.push("POLICY_NOT_EFFECTIVE");
    if (Number.isFinite(assessedAt) && Number.isFinite(approvedAt) && assessedAt < approvedAt)
      reasons.push("ASSESSMENT_PRECEDES_POLICY_APPROVAL");
  }

  const idempotencyKey = lmsIdempotencyKey(leadId, assessment);
  const duplicate = existingQueueRows.some((row) =>
    String(row?.["Idempotency Key"] || "").trim() === idempotencyKey ||
    (String(row?.["Lead ID"] || "").trim() === String(leadId || "").trim() &&
      String(row?.["Assessment ID"] || "").trim() === String(assessment["Assessment ID"] || "").trim())
  );
  if (duplicate) reasons.push("DUPLICATE_LMS_QUEUE_REQUEST");

  return { eligible: reasons.length === 0, reasons: [...new Set(reasons)], assessment, policy, consent, idempotencyKey };
}
