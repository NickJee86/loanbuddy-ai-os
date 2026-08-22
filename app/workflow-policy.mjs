function normalized(value) {
  return String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function first(record, keys) {
  for (const key of keys) {
    const value = String(record?.[key] || "").trim();
    if (value) return value;
  }
  return "";
}

function qualificationComplete(lead, state) {
  const status = normalized(first(state, ["Qualification Status"]) || first(lead?.raw, ["Qualification Status"]));
  const step = normalized(first(state, ["Current Step"]) || lead?.stage);
  return ["QUALIFIED", "COMPLETE", "COMPLETED", "APPROVED", "PASSED"].includes(status) ||
    ["DOCUMENTS", "DOCUMENT_REQUEST", "DOCUMENT_COLLECTION", "DOCUMENT_VERIFICATION", "CREDIT_ASSESSMENT", "LEAD_SCORING", "SCORING_COMPLETED", "READY_FOR_LMS", "LMS_SUBMISSION_QUEUE"].includes(step);
}

function verificationComplete(lead, verification) {
  const status = normalized(first(verification, ["Overall Verification Status", "Verification Status"]) || lead?.documentStatus);
  return ["VERIFIED", "PASSED", "COMPLETE", "COMPLETED", "APPROVED"].includes(status);
}

function needsHumanAssistance(lead, verification) {
  const verificationStatus = normalized(first(verification, ["Overall Verification Status", "Verification Status", "Next Action"]));
  const manual = normalized(first(verification, ["Manual Review Required"]));
  const escalation = normalized(lead?.escalationReason);
  const route = normalized(lead?.processingRoute || lead?.raw?.["Processing Route"]);
  return ["YES", "TRUE", "REQUIRED", "MANUAL_REVIEW"].includes(manual) ||
    ["MANUAL_REVIEW", "REUPLOAD_REQUIRED", "FAILED", "REJECTED"].some((value) => verificationStatus.includes(value)) ||
    Boolean(route !== "SA_ASSIST" && escalation && escalation !== "—" && escalation !== "NONE");
}

function creditAssessmentDecision(assessment, queueEligibility) {
  const assessmentId = first(assessment, ["Assessment ID"]);
  const status = normalized(first(assessment, ["Assessment Status"]));
  const hardRule = normalized(first(assessment, ["Hard Rule Status"]));
  const eligible = normalized(first(assessment, ["LMS Submission Eligibility"]));
  const manualReview = normalized(first(assessment, ["Manual Review Required"]));
  const reasons = first(assessment, ["Reason Codes", "Hard Rule Reasons"]);

  if (!assessmentId && !status) {
    return { code: "PRE_LMS_CREDIT_ASSESSMENT", label: "Run Pre-LMS credit assessment", reason: "Qualification and document verification passed. The deterministic DSR, NDI and policy assessment must run next.", tone: "blue", readyForLms: false };
  }
  if (status === "SHADOW_EVALUATED") {
    return { code: "CREDIT_SHADOW_REVIEW", label: "Credit assessment in shadow mode", reason: "The new credit rules were calculated for comparison only. Automatic LMS submission remains locked until an approved policy is active.", tone: "amber", readyForLms: false };
  }
  if (hardRule === "INCOMPLETE" || status === "INCOMPLETE") {
    return { code: "AI_CREDIT_DATA_FOLLOW_UP", label: "AI collects missing credit data", reason: `The assessment is incomplete${reasons ? `: ${reasons}` : "."}`, tone: "amber", readyForLms: false };
  }
  if (hardRule === "FAIL" || status === "PRE_SCREEN_DECLINED") {
    return { code: "CREDIT_PRE_SCREEN_DECLINED", label: "Pre-screen policy not met", reason: `The case did not meet the approved Pre-LMS policy${reasons ? `: ${reasons}` : "."} This is not an LMS final credit decision.`, tone: "red", readyForLms: false };
  }
  if (["YES", "TRUE", "REQUIRED"].includes(manualReview) || status === "MANUAL_REVIEW") {
    return { code: "REGIONAL_CREDIT_REVIEW", label: "Regional credit review required", reason: `A credit-policy exception needs Regional Manager or Admin review${reasons ? `: ${reasons}` : "."}`, tone: "amber", readyForLms: false };
  }
  if (!["YES", "TRUE", "ELIGIBLE"].includes(eligible) || status !== "ELIGIBLE_FOR_LMS") {
    return { code: "CREDIT_POLICY_LOCKED", label: "LMS submission remains locked", reason: "The credit assessment has not produced an approved, auditable LMS eligibility result.", tone: "amber", readyForLms: false };
  }
  if (!queueEligibility?.eligible) {
    const reasonCodes = Array.isArray(queueEligibility?.reasons)
      ? queueEligibility.reasons
      : [];
    const consentReasons = reasonCodes.filter((reason) =>
      String(reason).startsWith("CTOS_CCRIS_CONSENT_"),
    );
    const nonConsentReasons = reasonCodes.filter(
      (reason) => !String(reason).startsWith("CTOS_CCRIS_CONSENT_"),
    );
    if (consentReasons.length && !nonConsentReasons.length) {
      if (consentReasons.includes("CTOS_CCRIS_CONSENT_NOT_RECEIVED"))
        return { code: "REQUEST_CREDIT_BUREAU_CONSENT", label: "Request signed CTOS / CCRIS consent", reason: "The approved Pre-LMS assessment passed. Obtain the customer-signed Consent_BPH_V.40_01112020 form before any bureau check or LMS queue entry.", tone: "amber", readyForLms: false };
      if (consentReasons.includes("CTOS_CCRIS_CONSENT_REVOKED"))
        return { code: "CREDIT_BUREAU_CONSENT_REVOKED", label: "Consent withdrawn - LMS locked", reason: "The customer withdrew the CTOS / CCRIS consent. No bureau check or LMS submission may continue.", tone: "red", readyForLms: false };
      if (consentReasons.includes("CTOS_CCRIS_CONSENT_REUPLOAD_REQUIRED"))
        return { code: "CREDIT_BUREAU_CONSENT_REUPLOAD", label: "Request a corrected consent letter", reason: "The signed consent was rejected or incomplete. A corrected V4.0-01112020 form must be uploaded and verified.", tone: "red", readyForLms: false };
      return { code: "VERIFY_CREDIT_BUREAU_CONSENT", label: "Verify signed CTOS / CCRIS consent", reason: "The consent letter has been received, but an Admin or Regional Manager must verify its version, customer details and signature before LMS entry.", tone: "amber", readyForLms: false };
    }
    const reasons = reasonCodes.length
      ? reasonCodes.join(", ").replace(/_/g, " ")
      : "the ACTIVE policy and assessment gate has not been verified";
    return { code: "CREDIT_POLICY_LOCKED", label: "LMS submission remains locked", reason: `The queue readiness gate is not satisfied: ${reasons}.`, tone: "amber", readyForLms: false };
  }
  return null;
}

export function assessAutomationDecision({ lead = {}, checklist = [], state = {}, verification = {}, assessment = {}, queueEligibility = null } = {}) {
  const route = normalized(lead.processingRoute || lead.raw?.["Processing Route"]) === "SA_ASSIST" ? "SA_ASSIST" : "AI_DIRECT";
  const required = checklist.filter((item) => item.required);
  const requiredReceived = required.filter((item) => item.record).length;
  const requiredComplete = required.length > 0 && requiredReceived === required.length;
  const lmsStatus = normalized(lead.lmsStatus || lead.raw?.["LMS Status"]);

  if (["SUBMITTED", "PROCESSING", "IN_PROGRESS", "APPROVED", "COMPLETED", "DISBURSED"].includes(lmsStatus)) {
    return { code: "LMS_ACTIVE", label: "LMS processing active", reason: "This case has already entered the LMS lifecycle.", tone: "teal", readyForLms: true };
  }

  if (needsHumanAssistance(lead, verification)) {
    return { code: "SA_ASSIST_REQUIRED", label: "Route to regional SA", reason: "AI detected an exception, re-upload requirement or manual-review condition.", tone: "red", readyForLms: false };
  }

  if (!requiredComplete) {
    const missing = required.filter((item) => !item.record).map((item) => item.label).join(", ");
    return route === "SA_ASSIST"
      ? { code: "SA_DOCUMENT_ASSIST", label: "SA completes missing documents", reason: `${requiredReceived}/${required.length} required received. Missing: ${missing || "required documents"}.`, tone: "amber", readyForLms: false }
      : { code: "AI_DOCUMENT_FOLLOW_UP", label: "AI continues document follow-up", reason: `${requiredReceived}/${required.length} required received. Missing: ${missing || "required documents"}.`, tone: "amber", readyForLms: false };
  }

  if (!qualificationComplete(lead, state)) {
    return { code: route === "SA_ASSIST" ? "SA_COMPLETE_QUALIFICATION" : "AI_COMPLETE_QUALIFICATION", label: route === "SA_ASSIST" ? "SA completes qualification" : "AI completes qualification", reason: "All required documents are present, but qualification is not yet confirmed complete.", tone: "blue", readyForLms: false };
  }

  if (!verificationComplete(lead, verification)) {
    return { code: "AI_DOCUMENT_VERIFICATION", label: "AI verifies the complete document set", reason: "Qualification and required documents are complete. Verification must pass before LMS submission.", tone: "blue", readyForLms: false };
  }

  const creditDecision = creditAssessmentDecision(assessment, queueEligibility);
  if (creditDecision) return creditDecision;

  return route === "AI_DIRECT"
    ? { code: "AUTO_LMS_READY", label: "Ready for automatic LMS submission", reason: "AI qualification, document verification and the approved Pre-LMS credit policy have passed. No branch or staff approval is required.", tone: "teal", readyForLms: true }
    : { code: "LMS_READY_AFTER_ASSIST", label: "Resolved case ready for LMS", reason: "The SA-assisted exception is complete, verified and credit-policy eligible. It can now enter the LMS queue.", tone: "teal", readyForLms: true };
}
