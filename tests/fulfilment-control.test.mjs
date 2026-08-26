import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateFulfilmentAction,
  fulfilmentActionForCase,
} from "../app/fulfilment-control.mjs";
import { derivePostApprovalCase } from "../app/post-approval.mjs";

const approval = {
  "Lead ID": "LB-FUL-1",
  "Final Decision": "APPROVED",
  "Decision At": "2026-08-11T01:00:00Z",
};
const directLead = {
  "Lead ID": "LB-FUL-1",
  "Processing Route": "AI_DIRECT",
  "Branch ID": "BR-01",
};
const assistedLead = {
  ...directLead,
  "Processing Route": "SA_ASSIST",
  "Assigned Sales ID": "SA-01",
};
const admin = {
  username: "admin",
  role: "admin",
  branchIds: [],
};
const regional = {
  username: "regional",
  role: "regional_manager",
  branchIds: [],
};
const manager = {
  username: "manager",
  role: "manager",
  branchIds: ["BR-01"],
};
const staff = {
  username: "staff",
  role: "staff",
  branchIds: ["BR-01"],
  salesId: "SA-01",
};
const agreementActivity = {
  "Lead ID": "LB-FUL-1",
  "Activity Type": "FULFILMENT_AGREEMENT_SIGNED",
  "Activity Date": "2026-08-11T02:00:00Z",
};
const directDebitActivity = {
  "Lead ID": "LB-FUL-1",
  "Activity Type": "FULFILMENT_DIRECT_DEBIT_REGISTERED",
  "Activity Date": "2026-08-11T03:00:00Z",
};

test("Admin can record the agreement after official approval", () => {
  const result = evaluateFulfilmentAction({
    user: admin,
    lead: directLead,
    lmsResults: [approval],
    action: "agreement_signed",
  });
  assert.equal(result.allowed, true);
  assert.equal(result.definition.eventType, "FULFILMENT_AGREEMENT_SIGNED");
});

test("an internal state without official approval is blocked", () => {
  const result = evaluateFulfilmentAction({
    user: admin,
    lead: { ...directLead, "LMS Status": "QUEUED" },
    action: "agreement_signed",
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "OFFICIAL_LMS_APPROVAL_REQUIRED");
});

test("Branch Manager cannot update an AI-direct case", () => {
  const result = evaluateFulfilmentAction({
    user: manager,
    lead: directLead,
    lmsResults: [approval],
    action: "agreement_signed",
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "CASE_ACCESS_DENIED");
});

test("Branch Manager can record agreement on an in-branch assisted case", () => {
  const result = evaluateFulfilmentAction({
    user: manager,
    lead: assistedLead,
    lmsResults: [approval],
    action: "agreement_signed",
  });
  assert.equal(result.allowed, true);
});

test("assigned Staff can record agreement on an assisted case", () => {
  const result = evaluateFulfilmentAction({
    user: staff,
    lead: assistedLead,
    lmsResults: [approval],
    action: "agreement_signed",
  });
  assert.equal(result.allowed, true);
});

test("Direct Debit cannot be recorded before the agreement", () => {
  const result = evaluateFulfilmentAction({
    user: admin,
    lead: directLead,
    lmsResults: [approval],
    action: "direct_debit_registered",
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "AGREEMENT_REQUIRED");
});

test("a completed step cannot be recorded twice", () => {
  const result = evaluateFulfilmentAction({
    user: admin,
    lead: directLead,
    lmsResults: [approval],
    activities: [agreementActivity],
    action: "agreement_signed",
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "ALREADY_RECORDED");
});

test("Branch Manager cannot record disbursement", () => {
  const result = evaluateFulfilmentAction({
    user: manager,
    lead: assistedLead,
    lmsResults: [approval],
    activities: [agreementActivity, directDebitActivity],
    action: "disbursed",
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "REGIONAL_DISBURSEMENT_CONTROL_REQUIRED");
});

test("Regional Manager can record disbursement after prior steps", () => {
  const result = evaluateFulfilmentAction({
    user: regional,
    lead: directLead,
    lmsResults: [approval],
    activities: [agreementActivity, directDebitActivity],
    action: "disbursed",
  });
  assert.equal(result.allowed, true);
  assert.equal(result.definition.status, "DISBURSED");
});

test("latest official decline blocks fulfilment even after an earlier approval", () => {
  const result = evaluateFulfilmentAction({
    user: admin,
    lead: directLead,
    lmsResults: [
      approval,
      {
        ...approval,
        "Final Decision": "DECLINED",
        "Decision At": "2026-08-11T04:00:00Z",
      },
    ],
    action: "agreement_signed",
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "OFFICIAL_LMS_APPROVAL_REQUIRED");
});

test("UI action helper applies the same role and sequence locks", () => {
  const item = derivePostApprovalCase(directLead, approval, [
    agreementActivity,
    directDebitActivity,
  ]);
  assert.equal(fulfilmentActionForCase(item, manager), null);
  assert.equal(fulfilmentActionForCase(item, admin), "disbursed");
});
