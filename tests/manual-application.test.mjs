import assert from "node:assert/strict";
import test from "node:test";
import { buildManualApplicationRecord } from "../app/manual-application.mjs";

const admin = { username: "nick", role: "admin", branchIds: [] };
const staff = { username: "k1357", role: "staff", branchIds: ["BR002"], salesId: "K1357" };

test("final submit preserves document and SharePoint status written during upload", () => {
  const existing = {
    "Lead ID": "LB-UAT-1",
    "Created Date": "2026-08-08T01:00:00.000Z",
    "Branch ID": "BR001",
    "Document Status": "IN_PROGRESS",
    "IC Status": "RECEIVED",
    "Payslip Status": "RECEIVED",
    "Bank Statement Status": "RECEIVED",
  };
  const record = buildManualApplicationRecord({
    body: { action: "submit", "Lead Name": "Synthetic UAT", "Branch ID": "BR001" },
    user: admin,
    existing,
    leadId: "LB-UAT-1",
    now: "2026-08-08T02:00:00.000Z",
  });

  assert.equal(record["Document Status"], "IN_PROGRESS");
  assert.equal(record["IC Status"], "RECEIVED");
  assert.equal(record["Payslip Status"], "RECEIVED");
  assert.equal(record["Bank Statement Status"], "RECEIVED");
  assert.equal(record["Lead Status"], "SUBMITTED_FOR_VERIFICATION");
  assert.equal(record["Current Stage"], "DOCUMENT_VERIFICATION");
  assert.equal(record["Created Date"], existing["Created Date"]);
});

test("staff branch and Sales ID are always enforced", () => {
  const record = buildManualApplicationRecord({
    body: { action: "draft", "Branch ID": "BR003", "Assigned Sales ID": "K9999" },
    user: staff,
    leadId: "LB-UAT-2",
    now: "2026-08-08T02:00:00.000Z",
  });
  assert.equal(record["Branch ID"], "BR002");
  assert.equal(record["Assigned Sales ID"], "K1357");
  assert.equal(record["Processing Route"], "SA_ASSIST");
  assert.equal(record["Case Visibility"], "BRANCH_SA");
});

test("manual intake cannot overwrite protected workflow and LMS fields", () => {
  const record = buildManualApplicationRecord({
    body: {
      action: "draft",
      "Branch ID": "BR001",
      "Assigned Sales ID": "K9999",
      "Processing Route": "AI_DIRECT",
      "Case Visibility": "REGIONAL_ADMIN_ONLY",
      "Document Status": "VERIFIED",
      "LMS Status": "SUBMITTED",
      "Lead Score": "100",
      "Policy Version": "INVENTED",
      "Lead Name": "Controlled UAT",
    },
    user: admin,
    leadId: "LB-UAT-3",
    now: "2026-08-10T01:00:00.000Z",
  });
  assert.equal(record["Lead Name"], "Controlled UAT");
  assert.equal(record["Branch ID"], "BR001");
  assert.equal(record["Assigned Sales ID"], "");
  assert.equal(record["Processing Route"], "SA_ASSIST");
  assert.equal(record["Case Visibility"], "BRANCH_SA");
  assert.equal(record["Document Status"], undefined);
  assert.equal(record["LMS Status"], undefined);
  assert.equal(record["Lead Score"], undefined);
  assert.equal(record["Policy Version"], undefined);
});

test("existing application ownership, route and branch are preserved", () => {
  const existing = {
    "Lead ID": "LB-AI-1",
    "Source": "WHATSAPP",
    "Branch ID": "BR003",
    "Assigned Sales ID": "",
    "Processing Route": "AI_DIRECT",
    "Case Visibility": "REGIONAL_ADMIN_ONLY",
  };
  const record = buildManualApplicationRecord({
    body: {
      action: "draft",
      "Branch ID": "BR001",
      "Assigned Sales ID": "K9999",
      "Lead Name": "Updated Name",
    },
    user: admin,
    existing,
    leadId: "LB-AI-1",
    now: "2026-08-10T01:00:00.000Z",
  });
  assert.equal(record["Lead Name"], "Updated Name");
  assert.equal(record["Source"], "WHATSAPP");
  assert.equal(record["Branch ID"], "BR003");
  assert.equal(record["Assigned Sales ID"], "");
  assert.equal(record["Processing Route"], "AI_DIRECT");
  assert.equal(record["Case Visibility"], "REGIONAL_ADMIN_ONLY");
});

test("manual application record retains all credit-intake fields when headers support them", () => {
  const record = buildManualApplicationRecord({
    body: {
      action: "draft",
      "Lead Name": "Synthetic Credit Intake",
      "IC Number": "900101-14-1234",
      "Consent Status": "YES",
      Age: "36",
      "Employment Status": "Fixed Salary",
      "Employment Tenure Months": "48",
      "Employer Name": "Synthetic Employer",
      Industry: "Manufacturing",
      "Verified Net Income": "4600",
      "Income Verification Source": "Payslip + Bank Statement",
      "Monthly Commitments": "600",
      "Commitment Breakdown": "Vehicle RM600",
      "Requested Tenure Months": "36",
      "Preferred Language": "BM",
    },
    user: admin,
    leadId: "LB-UAT-CREDIT-1",
    now: "2026-08-11T01:00:00.000Z",
  });
  assert.equal(record["IC Number"], "900101-14-1234");
  assert.equal(record["Employer Name"], "Synthetic Employer");
  assert.equal(record["Verified Net Income"], "4600");
  assert.equal(record["Requested Tenure Months"], "36");
});
