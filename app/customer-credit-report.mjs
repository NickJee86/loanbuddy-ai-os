export const CUSTOMER_CCRIS_DOCUMENT_TYPE = "CUSTOMER_CCRIS_REPORT";

export const CUSTOMER_CCRIS_AI_MESSAGES = Object.freeze({
  optionalOffer:
    "Sekiranya anda memang sudah mempunyai laporan CCRIS sendiri, anda boleh lampirkan sebagai dokumen tambahan. Anda tidak perlu membeli laporan tersebut untuk permohonan ini.",
  received:
    "Terima kasih. Laporan CCRIS anda telah diterima sebagai rujukan awal. Kami masih memerlukan dokumen permohonan biasa untuk meneruskan semakan.",
  consentRequest:
    "Laporan CCRIS yang diberikan akan digunakan sebagai rujukan awal. Untuk memastikan maklumat kredit yang terkini digunakan dalam semakan rasmi, sila tandatangani borang kebenaran CTOS/CCRIS yang dilampirkan dan hantarkan semula salinan yang jelas. Anda tidak perlu mendapatkan laporan baharu sendiri.",
});

function normalized(value) {
  return String(value || "").trim().toUpperCase();
}

export function assessCustomerProvidedCcris({
  documentStatus = "NOT_PROVIDED",
  consentStatus = "NOT_RECEIVED",
  officialBureauStatus = "NOT_CHECKED",
} = {}) {
  const reportReceived = ["RECEIVED", "UPLOADED", "REFERENCE_ONLY"].includes(
    normalized(documentStatus),
  );
  const consentVerified = normalized(consentStatus) === "VERIFIED";
  const officialCheckComplete = ["COMPLETED", "VERIFIED", "CURRENT"].includes(
    normalized(officialBureauStatus),
  );

  return {
    reportReceived,
    classification: reportReceived
      ? "CUSTOMER_PROVIDED_REFERENCE"
      : "NOT_PROVIDED",
    canRequestCustomerToPurchaseReport: false,
    canReplaceConsent: false,
    canReplaceOfficialBureauCheck: false,
    consentRequired: true,
    latestOfficialCheckRequired: true,
    canCompleteOfficialBureauGate: consentVerified && officialCheckComplete,
  };
}
