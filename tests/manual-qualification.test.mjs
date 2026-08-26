import assert from "node:assert/strict";
import test from "node:test";
import {
  appendMissingHeaders,
  buildConversationStateRecord,
  creditDataGaps,
  MANUAL_LEAD_HEADERS,
} from "../app/manual-qualification.mjs";

const completeBody = {
  action: "submit",
  "Lead Name": "Synthetic Applicant",
  "Phone Number": "60123456789",
  "IC Number": "900101-14-1234",
  "Branch ID": "BR001",
  "Loan Amount Requested": "10000",
  "Monthly Income": "5000",
  "Salary Bank In": "YES",
  "Employment Status": "Fixed Salary",
  "EPF Available": "YES",
  "Consent Status": "YES",
  Age: "36",
  "Employer Name": "Synthetic Employer",
  Industry: "Manufacturing",
  "Employment Tenure Months": "48",
  "Verified Net Income": "4600",
  "Income Verification Source": "Payslip + Bank Statement",
  "Variable Income Average": "0",
  "Monthly Commitments": "600",
  "Commitment Breakdown": "Vehicle RM600",
  "Requested Tenure Months": "36",
  "Preferred Language": "BM",
};

test("manual fields are appended without moving existing Leads columns", () => {
  const current = ["Lead ID", "Phone Number", "Monthly Income"];
  const next = appendMissingHeaders(current, MANUAL_LEAD_HEADERS);
  assert.deepEqual(next.slice(0, 3), current);
  assert.ok(next.includes("IC Number"));
  assert.ok(next.includes("Requested Tenure Months"));
  assert.equal(new Set(next).size, next.length);
});

test("manual submit creates complete Conversation_State credit inputs", () => {
  const record = buildConversationStateRecord({
    body: completeBody,
    leadId: "LB-SYNTHETIC-1",
    now: "2026-08-11T01:00:00.000Z",
  });
  assert.equal(record["Lead ID"], "LB-SYNTHETIC-1");
  assert.equal(record["Employment Type"], "Fixed Salary");
  assert.equal(record["Existing Commitment"], "600");
  assert.equal(record["Credit Data Status"], "COMPLETE");
  assert.equal(record["Pre-LMS Assessment Status"], "PENDING");
  assert.equal(record["Next Action"], "AI_DOCUMENT_VERIFICATION");
  assert.deepEqual(creditDataGaps(record), []);
});

test("missing or declined consent fail-closes credit-data readiness", () => {
  const record = buildConversationStateRecord({
    body: { ...completeBody, "Consent Status": "NO" },
    leadId: "LB-SYNTHETIC-2",
    now: "2026-08-11T01:00:00.000Z",
  });
  assert.ok(creditDataGaps(record).includes("Consent Status"));
  assert.equal(record["Credit Data Status"], "INCOMPLETE");
  assert.equal(record["Pre-LMS Assessment Status"], "BLOCKED_INCOMPLETE_DATA");
});

test("manual save preserves AI-owned Conversation_State fields", () => {
  const record = buildConversationStateRecord({
    body: { ...completeBody, action: "draft", "Employer Name": "Updated Employer" },
    existing: {
      "Fraud Flag": "CLEAR",
      "Income Stability Grade": "A",
      "Employer Risk Band": "LOW",
    },
    leadId: "LB-SYNTHETIC-3",
    now: "2026-08-11T01:00:00.000Z",
  });
  assert.equal(record["Employer Name"], "Updated Employer");
  assert.equal(record["Fraud Flag"], "CLEAR");
  assert.equal(record["Income Stability Grade"], "A");
  assert.equal(record["Employer Risk Band"], "LOW");
});
