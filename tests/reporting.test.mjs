import assert from "node:assert/strict";
import test from "node:test";
import { buildManagementReport } from "../app/reporting.mjs";

const now = new Date("2026-08-10T09:00:00.000Z");

const leads = [
  {
    "Lead ID": "LB-1",
    "Lead Name": "Ahmad",
    "Phone Number": "60111111111",
    "Created Date": "2026-08-10T01:00:00.000Z",
    "Last AI Update": "2026-08-10T05:00:00.000Z",
    "Current Stage": "READY_FOR_LMS",
    "Document Status": "VERIFIED",
    "Branch ID": "BR001",
    "Assigned Sales ID": "K1001",
    "Processing Route": "SA_ASSIST",
    Source: "META",
    "Lead Score": "82",
    "AI Confidence": "90",
    "Loan Amount Requested": "RM 10,000",
    "Monthly Income": "5000",
    "Risk Level": "LOW",
    "Follow Up Priority": "HIGH",
  },
  {
    "Lead ID": "LB-2",
    "Lead Name": "Siti",
    "Phone Number": "60122222222",
    "Created Date": "2026-08-09T02:00:00.000Z",
    "Current Stage": "QUALIFIED",
    "Document Status": "IN_PROGRESS",
    "Branch ID": "BR002",
    "Assigned Sales ID": "K2002",
    "Processing Route": "SA_ASSIST",
    Source: "TIKTOK",
    "Lead Score": "68",
    "AI Confidence": "70",
    "Loan Amount Requested": "5000",
    "Monthly Income": "3000",
    "Risk Level": "MEDIUM",
    "Queue Priority": "MEDIUM",
  },
  {
    "Lead ID": "LB-3",
    "Lead Name": "Ali",
    "Phone Number": "60133333333",
    "Created Date": "2026-08-08T02:00:00.000Z",
    "Current Stage": "MANUAL_REVIEW",
    "Document Status": "REVIEW_REQUIRED",
    "Branch ID": "BR001",
    "Processing Route": "AI_DIRECT",
    Source: "META",
    "Risk Level": "HIGH",
  },
];

const data = {
  Credit_Assessment: [
    {
      "Lead ID": "LB-1",
      "Assessment Mode": "ACTIVE",
      "LMS Eligibility": "ELIGIBLE",
    },
  ],
  LMS_Submission_Queue: [
    {
      "Lead ID": "LB-1",
      "Queue Status": "QUEUED",
      "Requested At": "2026-08-10T04:00:00.000Z",
    },
  ],
  LMS_Credit_Result: [],
  Document_Received_Log: [
    {
      "Lead ID": "LB-1",
      "Document Type": "IC_FRONT",
      "Received At": "2026-08-10T04:00:00.000Z",
    },
  ],
  Document_Verification_Log: [
    {
      "Lead ID": "LB-1",
      "Verification Status": "VERIFIED",
    },
  ],
  Follow_Up_Queue: [{ "Lead ID": "LB-2", Status: "PENDING" }],
  Escalation_Log: [{ "Lead ID": "LB-3", Status: "OPEN" }],
  Customer_Inbox: [
    {
      "Lead ID": "LB-2",
      Timestamp: "2026-08-10T03:00:00.000Z",
    },
  ],
  Message_Outbox: [],
};

test("management report calculates agreed executive and operational KPIs", () => {
  const report = buildManagementReport({ leads, data, now });
  assert.deepEqual(report.overview, {
    totalLeads: 3,
    todayLeads: 1,
    qualified: 2,
    documentsComplete: 1,
    documentsPending: 2,
    rejected: 0,
    manualReview: 1,
    creditReady: 1,
    internalQueue: 1,
    externallySubmitted: 0,
    lmsApproved: 0,
    disbursed: 0,
    activeProcessing: 3,
  });
  assert.equal(report.operations.followUps, 1);
  assert.equal(report.operations.escalations, 1);
  assert.equal(report.operations.todayMessages, 1);
  assert.equal(report.operations.todayDocuments, 1);
  assert.equal(report.operations.verifiedDocuments, 1);
  assert.ok(report.averages.processingDays > 1);
});

test("an internal queue row is never reported as an external LMS submission", () => {
  const queued = buildManagementReport({ leads, data, now });
  assert.equal(queued.overview.internalQueue, 1);
  assert.equal(queued.overview.externallySubmitted, 0);

  const completedWithoutEvidence = buildManagementReport({
    leads,
    data: {
      ...data,
      LMS_Submission_Queue: [
        { "Lead ID": "LB-1", "Queue Status": "COMPLETED" },
      ],
    },
    now,
  });
  assert.equal(completedWithoutEvidence.overview.externallySubmitted, 0);

  const submitted = buildManagementReport({
    leads,
    data: {
      ...data,
      LMS_Submission_Queue: [
        {
          "Lead ID": "LB-1",
          "Queue Status": "SUBMITTED",
          "Submitted At": "2026-08-10T06:00:00.000Z",
          "LMS Submission ID": "LMS-123",
        },
      ],
    },
    now,
  });
  assert.equal(submitted.overview.externallySubmitted, 1);
});

test("external approval rate requires an official LMS decision row", () => {
  const noDecision = buildManagementReport({ leads, data, now });
  assert.equal(noDecision.conversion.externalDecisionCount, 0);
  assert.equal(noDecision.conversion.externalApprovalRate, 0);

  const decided = buildManagementReport({
    leads,
    data: {
      ...data,
      LMS_Credit_Result: [
        { "Lead ID": "LB-1", "Final Decision": "APPROVED" },
        { "Lead ID": "LB-2", "Final Decision": "DECLINED" },
      ],
    },
    now,
  });
  assert.equal(decided.overview.lmsApproved, 1);
  assert.equal(decided.conversion.externalDecisionCount, 2);
  assert.equal(decided.conversion.externalApprovalRate, 50);
});

test("latest assessment and LMS result are authoritative for reporting", () => {
  const report = buildManagementReport({
    leads,
    data: {
      ...data,
      Credit_Assessment: [
        {
          "Lead ID": "LB-1",
          "Assessment Mode": "ACTIVE",
          "LMS Eligibility": "ELIGIBLE",
          "Assessment At": "2026-08-10T04:00:00.000Z",
        },
        {
          "Lead ID": "LB-1",
          "Assessment Mode": "ACTIVE",
          "LMS Eligibility": "INELIGIBLE",
          "Manual Review Required": "YES",
          "Assessment At": "2026-08-10T05:00:00.000Z",
        },
      ],
      LMS_Credit_Result: [
        {
          "Lead ID": "LB-1",
          "Final Decision": "APPROVED",
          "Decision At": "2026-08-10T06:00:00.000Z",
        },
        {
          "Lead ID": "LB-1",
          "Final Decision": "DECLINED",
          "Decision At": "2026-08-10T07:00:00.000Z",
        },
      ],
    },
    now,
  });
  assert.equal(report.overview.creditReady, 0);
  assert.equal(report.overview.manualReview, 2);
  assert.equal(report.overview.lmsApproved, 0);
  assert.equal(report.conversion.externalDecisionCount, 1);
});

test("shadow assessments cannot be counted as production credit ready", () => {
  const report = buildManagementReport({
    leads,
    data: {
      ...data,
      Credit_Assessment: [
        {
          "Lead ID": "LB-1",
          "Assessment Mode": "SHADOW",
          "LMS Eligibility": "ELIGIBLE",
        },
      ],
    },
    now,
  });
  assert.equal(report.overview.creditReady, 0);
});

test("branch, staff and source reports rank real lead performance", () => {
  const report = buildManagementReport({ leads, data, now });
  assert.equal(report.branchPerformance[0].name, "BR001");
  assert.equal(report.branchPerformance[0].leads, 2);
  assert.equal(report.branchPerformance[0].creditReady, 1);
  assert.deepEqual(
    report.staffPerformance.map((row) => row.name),
    ["K1001", "K2002"],
  );
  assert.equal(report.sourcePerformance[0].name, "META");
  assert.equal(report.sourcePerformance[0].leads, 2);
});

test("route reporting uses the same safe inference as case access control", () => {
  const report = buildManagementReport({
    leads: [
      {
        "Lead ID": "MANUAL-1",
        Source: "CRM_MANUAL",
        "Branch ID": "BR001",
      },
      {
        "Lead ID": "WEBSITE-1",
        Source: "Website",
        "Branch ID": "BR001",
      },
    ],
    data: {},
    now,
  });

  assert.deepEqual(report.routeDistribution, [
    { label: "Ai Direct", count: 1 },
    { label: "Sa Assist", count: 1 },
  ]);
});

test("missing numeric fields are excluded from averages instead of becoming zero", () => {
  const report = buildManagementReport({ leads, data, now });
  assert.equal(report.averages.leadScore, 75);
  assert.equal(report.averages.aiConfidence, 80);
  assert.equal(report.averages.loanAmount, 7500);
  assert.equal(report.averages.monthlyIncome, 4000);
});

test("seven-day trend uses Malaysia dates and always returns seven points", () => {
  const report = buildManagementReport({ leads, data, now });
  assert.equal(report.sevenDayTrend.length, 7);
  assert.equal(
    report.sevenDayTrend.reduce((total, day) => total + day.count, 0),
    3,
  );
  assert.equal(report.sevenDayTrend.at(-1).count, 1);
});

test("report rows unrelated to visible leads are excluded", () => {
  const report = buildManagementReport({
    leads: [leads[0]],
    data: {
      ...data,
      Escalation_Log: [
        { "Lead ID": "LB-1", Status: "OPEN" },
        { "Lead ID": "HIDDEN", Status: "OPEN" },
      ],
    },
    now,
  });
  assert.equal(report.operations.escalations, 1);
});
