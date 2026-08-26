import assert from "node:assert/strict";
import test from "node:test";
import { evaluateVerificationApproval, missingRequiredDocuments } from "../app/application-guard.mjs";

const documents = ["IC_FRONT", "IC_BACK", "PAYSLIP", "BANK_STATEMENT"].map((type) => ({ "Lead ID": "LB-1", "Document Type": type, Status: "RECEIVED" }));
const verified = [{ "Lead ID": "LB-1", "Overall Verification Status": "VERIFIED", "Manual Review Required": "NO", "Missing or Unreadable Documents": "NONE" }];

test("incomplete applications cannot be approved", () => {
  const result = evaluateVerificationApproval({ lead: { "Lead ID": "LB-1", "Document Status": "IN_PROGRESS" }, receivedRows: [], verificationRows: [] });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("MISSING_IC_FRONT"));
  assert.ok(result.reasons.includes("DOCUMENT_STATUS_NOT_VERIFIED"));
  assert.ok(result.reasons.includes("VERIFICATION_NOT_FOUND"));
});

test("complete and AI-verified applications can be approved", () => {
  const result = evaluateVerificationApproval({ lead: { "Lead ID": "LB-1", "Document Status": "VERIFIED" }, receivedRows: documents, verificationRows: verified });
  assert.deepEqual(result.reasons, []);
  assert.equal(result.eligible, true);
});

test("manual review and unreadable documents remain locked", () => {
  const result = evaluateVerificationApproval({
    lead: { "Lead ID": "LB-1", "Document Status": "VERIFIED" },
    receivedRows: documents,
    verificationRows: [{ ...verified[0], "Overall Verification Status": "MANUAL_REVIEW", "Manual Review Required": "YES", "Missing or Unreadable Documents": "BANK_STATEMENT" }],
  });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("VERIFICATION_NOT_PASSED"));
  assert.ok(result.reasons.includes("MANUAL_REVIEW_UNRESOLVED"));
  assert.ok(result.reasons.includes("VERIFICATION_HAS_MISSING_OR_UNREADABLE_DOCUMENTS"));
});

test("server-side submit completeness uses received document records", () => {
  assert.deepEqual(missingRequiredDocuments("LB-1", documents.slice(0, 3)), ["BANK_STATEMENT"]);
});
