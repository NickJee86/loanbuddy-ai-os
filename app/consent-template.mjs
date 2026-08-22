export const CONSENT_TEMPLATE = Object.freeze({
  formId: "Consent_BPH_V.40_01112020",
  version: "V4.0-01112020",
  assetPath:
    "assets/consent/Consent-Form-CCRIS-V4.0-01112020-ENG.pdf",
  downloadFileName: "LoanBuddy-CTOS-CCRIS-Consent-V4.0-01112020.pdf",
});

export function consentTemplateMode(value) {
  return String(value || "").toLowerCase() === "download"
    ? "attachment"
    : "inline";
}

export function consentTemplateHeaders(value) {
  const mode = consentTemplateMode(value);
  return {
    "cache-control": "private, no-store, max-age=0, must-revalidate",
    "content-disposition": `${mode}; filename="${CONSENT_TEMPLATE.downloadFileName}"`,
    "content-type": "application/pdf",
    "x-consent-form-id": CONSENT_TEMPLATE.formId,
    "x-consent-template-version": CONSENT_TEMPLATE.version,
    "x-content-type-options": "nosniff",
  };
}

export function blankConsentTemplateCanSatisfyConsentGate() {
  return false;
}
