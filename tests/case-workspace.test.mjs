import assert from "node:assert/strict";
import test from "node:test";
import {
  buildApplicationRegister,
  formatConfidence,
  mergedFollowUpRows,
  mergedQualificationRows,
  qualificationSnapshot,
  rowsForVisibleLeads,
} from "../app/case-workspace.mjs";

const lead = {
  id: "LB-SYNTHETIC-READY",
  name: "Synthetic Ready Applicant",
  phone: "60120000000",
  owner: "AI managed",
  processingRoute: "AI_DIRECT",
  lmsStatus: "Not Submitted",
  raw: { "Lead ID": "LB-SYNTHETIC-READY", "Monthly Income": "5000" },
};

const state = {
  "Lead ID": lead.id,
  "Consent Status": "YES",
  Age: "36",
  "Loan Amount": "10000",
  "Monthly Income": "5000",
  "Salary Bank In": "YES",
  "Employment Type": "Fixed Salary",
  "Employment Tenure Months": "48",
  "Employer Name": "Synthetic Employer",
  Industry: "Manufacturing",
  "Verified Net Income": "4600",
  "Income Verification Source": "Payslip + Bank Statement",
  "Existing Commitment": "600",
  "Requested Tenure Months": "36",
  "Last Updated": "2026-08-11T01:00:00.000Z",
};

const documents = ["IC_FRONT", "IC_BACK", "PAYSLIP", "BANK_STATEMENT"].map(
  (type) => ({
    "Lead ID": lead.id,
    "Document Type": type,
    Status: "RECEIVED",
  }),
);
documents.push({
  "Lead ID": lead.id,
  "Document Type": "CTOS_CCRIS_CONSENT",
  Status: "VERIFIED",
  "Verification Status": "VERIFIED",
  "Consent Version": "V4.0-01112020",
  "Verified At": "2026-08-11T01:05:00Z",
  "Verified By": "regional-manager",
});

const activePolicy = {
  "Policy Code": "LB_PERSONAL_LOAN",
  "Policy Version": "SYNTHETIC-V2",
  Status: "ACTIVE",
  "Effective From": "2026-08-01",
  "Product Name": "Personal Loan",
  Currency: "MYR",
  "Minimum Age": "21",
  "Maximum Age At Maturity": "65",
  "Minimum Employment Tenure Months": "3",
  "Minimum Verified Net Income": "1700",
  "Maximum Preliminary DSR": "60",
  "Minimum Net Disposable Income": "1500",
  "Minimum Loan Amount": "1000",
  "Maximum Loan Amount": "100000",
  "Minimum Tenure Months": "6",
  "Maximum Tenure Months": "66",
  "Variable Income Recognition Percent": "100",
  "Minimum Auto LMS Score": "80",
  "Manual Review Score": "65",
  "Required Documents": "IC_FRONT,IC_BACK,PAYSLIP,BANK_STATEMENT",
  "Optional Documents": "EPF_STATEMENT",
  "Approved By": "synthetic-test-approver",
  "Approved At": "2026-08-10T00:30:00Z",
};

test("application register identifies a fully eligible case as ready for LMS", () => {
  const result = buildApplicationRegister([lead], {
    Conversation_State: [state],
    Document_Received_Log: documents,
    Document_Verification_Log: [
      {
        "Lead ID": lead.id,
        "Overall Verification Status": "VERIFIED",
      },
    ],
    Credit_Assessment: [
      {
        "Lead ID": lead.id,
        "Assessment ID": "CA-SYNTHETIC-READY",
        "Assessed At": "2026-08-11T01:00:00Z",
        "Policy Code": "LB_PERSONAL_LOAN",
        "Policy Version": "SYNTHETIC-V2",
        "Assessment Mode": "ACTIVE",
        "Assessment Status": "ELIGIBLE_FOR_LMS",
        "Hard Rule Status": "PASS",
        "LMS Submission Eligibility": "YES",
        "Manual Review Required": "NO",
      },
    ],
    Product_Credit_Policy: [activePolicy],
    System_Config: [
      {
        "Config Key": "CREDIT_POLICY_ENGINE_ENABLED",
        "Config Value": "ON",
      },
    ],
  })[0];
  assert.equal(result.phase, "READY FOR LMS");
  assert.equal(result.qualification.completed, result.qualification.total);
  assert.equal(result.documents.completed, 4);
});

test("application register never labels a SHADOW assessment as ready for LMS", () => {
  const result = buildApplicationRegister([lead], {
    Conversation_State: [state],
    Document_Received_Log: documents,
    Document_Verification_Log: [
      { "Lead ID": lead.id, "Overall Verification Status": "VERIFIED" },
    ],
    Credit_Assessment: [
      {
        "Lead ID": lead.id,
        "Assessment ID": "CA-SHADOW",
        "Assessed At": "2026-08-11T01:00:00Z",
        "Policy Code": "LB_PERSONAL_LOAN",
        "Policy Version": "SYNTHETIC-V2",
        "Assessment Mode": "SHADOW",
        "Assessment Status": "ELIGIBLE_FOR_LMS",
        "Hard Rule Status": "PASS",
        "LMS Submission Eligibility": "YES",
        "Manual Review Required": "NO",
      },
    ],
    Product_Credit_Policy: [activePolicy],
  })[0];
  assert.equal(result.phase, "CREDIT");
  assert.match(result.blocker, /ASSESSMENT MODE NOT ACTIVE/i);
});

test("an eligible assessment waits at the dedicated consent gate", () => {
  const result = buildApplicationRegister([lead], {
    Conversation_State: [state],
    Document_Received_Log: documents.filter(
      (row) => row["Document Type"] !== "CTOS_CCRIS_CONSENT",
    ),
    Document_Verification_Log: [
      { "Lead ID": lead.id, "Overall Verification Status": "VERIFIED" },
    ],
    Credit_Assessment: [
      {
        "Lead ID": lead.id,
        "Assessment ID": "CA-CONSENT-PENDING",
        "Assessed At": "2026-08-11T01:00:00Z",
        "Policy Code": "LB_PERSONAL_LOAN",
        "Policy Version": "SYNTHETIC-V2",
        "Assessment Mode": "ACTIVE",
        "Assessment Status": "ELIGIBLE_FOR_LMS",
        "Hard Rule Status": "PASS",
        "LMS Submission Eligibility": "YES",
        "Manual Review Required": "NO",
      },
    ],
    Product_Credit_Policy: [activePolicy],
    System_Config: [
      {
        "Config Key": "CREDIT_POLICY_ENGINE_ENABLED",
        "Config Value": "ON",
      },
    ],
  })[0];
  assert.equal(result.phase, "CONSENT");
  assert.match(result.blocker, /NOT RECEIVED/i);
});

test("application register reports exact missing qualification inputs first", () => {
  const result = buildApplicationRegister([lead], {
    Conversation_State: [{ "Lead ID": lead.id, "Consent Status": "YES" }],
    Document_Received_Log: documents,
  })[0];
  assert.equal(result.phase, "QUALIFICATION");
  assert.match(result.blocker, /Age/);
  assert.match(result.blocker, /Employer/);
});

test("qualification snapshot can use legacy Leads values as fallbacks", () => {
  const result = qualificationSnapshot({
    raw: {
      "Monthly Income": "5000",
      "Employment Status": "Fixed Salary",
      "Monthly Commitments": "0",
    },
  });
  assert.equal(result.completed, 3);
});

test("qualification queue derives incomplete applications missing a Conversation_State row", () => {
  const result = mergedQualificationRows(
    [
      {
        id: "LB-MANUAL-INCOMPLETE",
        name: "Manual Applicant",
        phone: "60120000088",
        owner: "Unassigned",
        processingRoute: "SA_ASSIST",
        updated: "2026-08-11T02:00:00Z",
        raw: {
          "Lead ID": "LB-MANUAL-INCOMPLETE",
          "Monthly Income": "4000",
        },
      },
    ],
    [],
  );
  assert.equal(result.length, 1);
  assert.equal(result[0]["Qualification Status"], "PENDING");
  assert.match(result[0]["Next Action"], /Consent/);
  assert.equal(result[0].Source, "Application_Register");
});

test("qualification queue preserves an existing state row without adding a duplicate", () => {
  const existing = {
    "Lead ID": lead.id,
    "Qualification Status": "PENDING",
    "Next Action": "ASK_AGE",
  };
  const result = mergedQualificationRows([lead], [existing]);
  assert.deepEqual(result, [existing]);
});

test("verification confidence is consistently displayed as a percentage", () => {
  assert.equal(formatConfidence("0.92"), "92%");
  assert.equal(formatConfidence("54"), "54%");
  assert.equal(formatConfidence("78.25%"), "78.3%");
  assert.equal(formatConfidence(""), "—");
});

test("real Follow_Up_Queue rows take precedence over derived state rows", () => {
  const result = mergedFollowUpRows(
    [{ "Lead ID": "LB-1", "Next Action": "CALL", Status: "OPEN" }],
    [
      { "Lead ID": "LB-1", "Next Action": "ASK_DOCUMENT" },
      { "Lead ID": "LB-2", "Next Action": "ASK_INCOME", "Lead Name": "Synthetic" },
    ],
  );
  assert.equal(result.filter((row) => row["Lead ID"] === "LB-1").length, 1);
  assert.equal(result.find((row) => row["Lead ID"] === "LB-2").Source, "Conversation_State");
});

test("operational rows are fail-closed to the currently visible Lead IDs", () => {
  const result = rowsForVisibleLeads(
    [
      { "Lead ID": "LB-BR001", Status: "OPEN" },
      { "Lead ID": "LB-BR002", Status: "OPEN" },
      { "Phone Number": "6012-000-0001", Status: "OPEN" },
      { Status: "OPEN" },
    ],
    [
      {
        id: "LB-BR001",
        phone: "60120000001",
        raw: { "Lead ID": "LB-BR001", "Phone Number": "60120000001" },
      },
    ],
  );
  assert.deepEqual(
    result.map((row) => row["Lead ID"] || row["Phone Number"]),
    ["LB-BR001", "6012-000-0001"],
  );
});

test("a row with an explicit out-of-scope Lead ID cannot re-enter by phone", () => {
  const result = rowsForVisibleLeads(
    [
      {
        "Lead ID": "LB-BR002",
        "Phone Number": "60120000001",
        Status: "OPEN",
      },
    ],
    [
      {
        id: "LB-BR001",
        phone: "60120000001",
        raw: { "Lead ID": "LB-BR001", "Phone Number": "60120000001" },
      },
    ],
  );
  assert.equal(result.length, 0);
});
