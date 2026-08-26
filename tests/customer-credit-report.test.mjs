import assert from "node:assert/strict";
import test from "node:test";
import {
  assessCustomerProvidedCcris,
  CUSTOMER_CCRIS_AI_MESSAGES,
  CUSTOMER_CCRIS_DOCUMENT_TYPE,
} from "../app/customer-credit-report.mjs";
import { shouldProgressDocumentCollection } from "../app/document-upload-policy.mjs";

test("a customer-provided CCRIS report is reference-only", () => {
  const decision = assessCustomerProvidedCcris({
    documentStatus: "RECEIVED",
    consentStatus: "NOT_RECEIVED",
    officialBureauStatus: "NOT_CHECKED",
  });
  assert.equal(CUSTOMER_CCRIS_DOCUMENT_TYPE, "CUSTOMER_CCRIS_REPORT");
  assert.equal(decision.classification, "CUSTOMER_PROVIDED_REFERENCE");
  assert.equal(decision.canReplaceConsent, false);
  assert.equal(decision.canReplaceOfficialBureauCheck, false);
  assert.equal(decision.canCompleteOfficialBureauGate, false);
});

test("the official bureau gate needs verified consent and a latest official result", () => {
  assert.equal(
    assessCustomerProvidedCcris({
      documentStatus: "RECEIVED",
      consentStatus: "VERIFIED",
      officialBureauStatus: "NOT_CHECKED",
    }).canCompleteOfficialBureauGate,
    false,
  );
  assert.equal(
    assessCustomerProvidedCcris({
      documentStatus: "RECEIVED",
      consentStatus: "VERIFIED",
      officialBureauStatus: "COMPLETED",
    }).canCompleteOfficialBureauGate,
    true,
  );
});

test("AI never asks the customer to buy a CCRIS report or mentions fraud concerns", () => {
  const messages = Object.values(CUSTOMER_CCRIS_AI_MESSAGES).join(" ");
  assert.match(messages, /tidak perlu membeli/i);
  assert.doesNotMatch(messages, /fraud|forg|palsu|penipuan|pemalsuan/i);
  assert.equal(
    assessCustomerProvidedCcris().canRequestCustomerToPurchaseReport,
    false,
  );
});

test("optional reference uploads never regress the main document workflow", () => {
  assert.equal(shouldProgressDocumentCollection("IC_FRONT"), true);
  assert.equal(shouldProgressDocumentCollection("EPF_STATEMENT"), false);
  assert.equal(shouldProgressDocumentCollection("CUSTOMER_CCRIS_REPORT"), false);
  assert.equal(shouldProgressDocumentCollection("CTOS_CCRIS_CONSENT"), false);
});
