import assert from "node:assert/strict";
import test from "node:test";
import {
  CREDIT_BUREAU_CONSENT_VERSION,
  evaluateCreditBureauConsent,
  latestCreditBureauConsent,
} from "../app/credit-bureau-consent.mjs";

const verifiedConsent = {
  "Lead ID": "LB-CONSENT-1",
  "Document Type": "CTOS_CCRIS_CONSENT",
  Status: "VERIFIED",
  "Verification Status": "VERIFIED",
  "Consent Version": CREDIT_BUREAU_CONSENT_VERSION,
  "Received Date": "2026-08-11T01:00:00Z",
  "Verified At": "2026-08-11T01:05:00Z",
  "Verified By": "regional-manager",
};

test("LMS consent gate fails closed when no signed form exists", () => {
  const result = evaluateCreditBureauConsent("LB-CONSENT-1", []);
  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasons, ["CTOS_CCRIS_CONSENT_NOT_RECEIVED"]);
});

test("a received form remains locked until authorised verification", () => {
  const result = evaluateCreditBureauConsent("LB-CONSENT-1", [
    {
      ...verifiedConsent,
      Status: "RECEIVED",
      "Verification Status": "PENDING",
      "Verified At": "",
      "Verified By": "",
    },
  ]);
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("CTOS_CCRIS_CONSENT_NOT_VERIFIED"));
});

test("only the approved consent version with a complete audit can pass", () => {
  assert.equal(
    evaluateCreditBureauConsent("LB-CONSENT-1", [verifiedConsent]).eligible,
    true,
  );
  const wrongVersion = evaluateCreditBureauConsent("LB-CONSENT-1", [
    { ...verifiedConsent, "Consent Version": "V3" },
  ]);
  assert.equal(wrongVersion.eligible, false);
  assert.ok(
    wrongVersion.reasons.includes("CTOS_CCRIS_CONSENT_VERSION_INVALID"),
  );
});

test("withdrawal overrides an earlier verified consent", () => {
  const revoked = {
    ...verifiedConsent,
    Status: "REVOKED",
    "Verification Status": "REVOKED",
    "Received Date": "2026-08-11T02:00:00Z",
    "Revoked At": "2026-08-11T02:05:00Z",
  };
  assert.equal(
    latestCreditBureauConsent("LB-CONSENT-1", [verifiedConsent, revoked]),
    revoked,
  );
  const result = evaluateCreditBureauConsent("LB-CONSENT-1", [
    verifiedConsent,
    revoked,
  ]);
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("CTOS_CCRIS_CONSENT_REVOKED"));
});
