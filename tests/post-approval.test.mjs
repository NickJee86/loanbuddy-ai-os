import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPostApprovalCases,
  derivePostApprovalCase,
} from "../app/post-approval.mjs";

const lead = {
  id: "LB-APPROVED-1",
  name: "Approved Applicant",
  stage: "LMS",
  raw: { "Lead ID": "LB-APPROVED-1" },
};

const approval = {
  "Lead ID": lead.id,
  "Final Decision": "APPROVED",
  "Decision At": "2026-08-11T01:00:00Z",
};

test("official LMS approval enters agreement pending", () => {
  const result = derivePostApprovalCase(lead, approval);
  assert.equal(result.officialApproval, true);
  assert.equal(result.stage, "AGREEMENT_PENDING");
  assert.equal(result.agreementStatus, "PENDING");
});

test("signed agreement advances to Direct Debit pending", () => {
  const result = derivePostApprovalCase(
    { ...lead, raw: { ...lead.raw, "Agreement Signed At": "2026-08-11T02:00:00Z" } },
    approval,
  );
  assert.equal(result.stage, "DIRECT_DEBIT_PENDING");
  assert.equal(result.directDebitStatus, "PENDING");
});

test("registered Direct Debit advances to ready for disbursement", () => {
  const result = derivePostApprovalCase(
    {
      ...lead,
      raw: {
        ...lead.raw,
        "Agreement Status": "SIGNED",
        "Direct Debit Status": "ACTIVE",
      },
    },
    approval,
  );
  assert.equal(result.stage, "READY_FOR_DISBURSEMENT");
  assert.equal(result.disbursementStatus, "READY");
});

test("disbursement evidence completes fulfilment", () => {
  const result = derivePostApprovalCase(
    {
      ...lead,
      raw: {
        ...lead.raw,
        "Agreement Status": "SIGNED",
        "Direct Debit Status": "REGISTERED",
        "Disbursed At": "2026-08-11T03:00:00Z",
      },
    },
    approval,
  );
  assert.equal(result.stage, "DISBURSED");
  assert.equal(result.disbursed, true);
});

test("append-only fulfilment activities advance the official case", () => {
  const result = derivePostApprovalCase(lead, approval, [
    {
      "Lead ID": lead.id,
      "Activity Type": "FULFILMENT_AGREEMENT_SIGNED",
      "Activity Date": "2026-08-11T02:00:00Z",
    },
    {
      "Lead ID": lead.id,
      "Activity Type": "FULFILMENT_DIRECT_DEBIT_REGISTERED",
      "Activity Date": "2026-08-11T03:00:00Z",
    },
  ]);
  assert.equal(result.stage, "READY_FOR_DISBURSEMENT");
  assert.equal(result.agreementSigned, true);
  assert.equal(result.directDebitReady, true);
});

test("out-of-sequence fulfilment evidence is fail-closed", () => {
  const result = derivePostApprovalCase(lead, approval, [
    {
      "Lead ID": lead.id,
      "Activity Type": "FULFILMENT_DIRECT_DEBIT_REGISTERED",
      "Activity Date": "2026-08-11T03:00:00Z",
    },
  ]);
  assert.equal(result.stage, "FULFILMENT_DATA_EXCEPTION");
  assert.deepEqual(result.dataIssues, ["DIRECT_DEBIT_WITHOUT_AGREEMENT"]);
  assert.equal(result.tone, "red");
});

test("generic Loan Status does not count as disbursement evidence", () => {
  const result = derivePostApprovalCase(
    {
      ...lead,
      raw: {
        ...lead.raw,
        "Agreement Status": "SIGNED",
        "Direct Debit Status": "REGISTERED",
        "Loan Status": "PAID",
      },
    },
    approval,
  );
  assert.equal(result.stage, "READY_FOR_DISBURSEMENT");
  assert.equal(result.disbursed, false);
});

test("latest official result is authoritative and a later decline excludes the case", () => {
  const result = buildPostApprovalCases({
    leads: [lead],
    lmsResults: [
      approval,
      {
        "Lead ID": lead.id,
        "Final Decision": "DECLINED",
        "Decision At": "2026-08-11T04:00:00Z",
      },
    ],
  });
  assert.equal(result.length, 0);
});

test("an internal queue or READY_FOR_LMS stage never becomes post-approval", () => {
  const queuedLead = {
    ...lead,
    stage: "READY_FOR_LMS",
    raw: { ...lead.raw, "LMS Status": "QUEUED" },
  };
  const result = buildPostApprovalCases({ leads: [queuedLead], lmsResults: [] });
  assert.equal(result.length, 0);
  assert.equal(derivePostApprovalCase(queuedLead).stage, "AWAITING_LMS_DECISION");
});
