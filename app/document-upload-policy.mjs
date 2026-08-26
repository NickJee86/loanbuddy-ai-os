const CORE_APPLICATION_DOCUMENTS = new Set([
  "IC_FRONT",
  "IC_BACK",
  "PAYSLIP",
  "BANK_STATEMENT",
]);

export function shouldProgressDocumentCollection(documentType) {
  return CORE_APPLICATION_DOCUMENTS.has(
    String(documentType || "").trim().toUpperCase(),
  );
}
