import assert from "node:assert/strict";
import test from "node:test";
import { buildActionCenter } from "../app/action-center.mjs";

const leads = [
  {
    "Lead ID": "LB-1",
    "Current Stage": "MANUAL_REVIEW",
    "Document Status": "PENDING",
    "Processing Route": "SA_ASSIST",
  },
  {
    "Lead ID": "LB-2",
    "Current Stage": "QUALIFIED",
    "Document Status": "COMPLETE",
    "Processing Route": "AI_DIRECT",
    "Risk Level": "LOW",
    Priority: "MEDIUM",
  },
];

test("action center consolidates role-scoped operational work", () => {
  const result = buildActionCenter({
    leads,
    role: "admin",
    data: {
      Product_Credit_Policy: [{ Status: "SHADOW" }],
      Follow_Up_Queue: [{ "Lead ID": "LB-1", Status: "PENDING" }],
      Escalation_Log: [{ "Lead ID": "LB-1", Status: "OPEN" }],
      LMS_Submission_Queue: [
        { "Lead ID": "LB-2", "Queue Status": "FAILED" },
      ],
      Credit_Assessment: [],
    },
  });
  assert.ok(result.alerts.some((alert) => alert.id === "policy"));
  assert.ok(result.alerts.some((alert) => alert.id === "manual-review"));
  assert.ok(result.alerts.some((alert) => alert.id === "documents"));
  assert.ok(result.alerts.some((alert) => alert.id === "lms-failed"));
  assert.equal(result.readiness.activePolicies, 0);
  assert.ok(result.totalActions >= 6);
});

test("closed work and unrelated lead rows do not create notifications", () => {
  const result = buildActionCenter({
    leads: [leads[1]],
    role: "staff",
    data: {
      Follow_Up_Queue: [
        { "Lead ID": "LB-2", Status: "COMPLETED" },
        { "Lead ID": "OTHER", Status: "PENDING" },
      ],
      Escalation_Log: [{ "Lead ID": "LB-2", Status: "RESOLVED" }],
      Product_Credit_Policy: [],
    },
  });
  assert.equal(result.alerts.length, 0);
  assert.equal(result.readiness.activePolicies, null);
});

test("stale snapshots are surfaced as a critical operational warning", () => {
  const result = buildActionCenter({
    leads: [],
    data: {},
    role: "manager",
    connected: true,
    stale: true,
  });
  assert.equal(result.alerts[0].id, "connection");
  assert.equal(result.summary.critical, 1);
  assert.equal(result.readiness.connection, "STALE");
});

test("officially approved but undisbursed cases create a post-approval action", () => {
  const result = buildActionCenter({
    leads: [
      {
        "Lead ID": "LB-APPROVED",
        "Current Stage": "LMS",
        "Document Status": "COMPLETE",
        "Processing Route": "AI_DIRECT",
        "Risk Level": "LOW",
        Priority: "HIGH",
      },
    ],
    role: "admin",
    data: {
      Product_Credit_Policy: [{ Status: "ACTIVE" }],
      LMS_Credit_Result: [
        {
          "Lead ID": "LB-APPROVED",
          "Final Decision": "APPROVED",
          "Decision At": "2026-08-11T03:00:00Z",
        },
      ],
    },
  });
  const alert = result.alerts.find((item) => item.id === "post-approval");
  assert.equal(alert?.count, 1);
  assert.equal(alert?.target, "Post-Approval");
});

test("eligible assessments with no verified bureau consent create an action", () => {
  const result = buildActionCenter({
    leads: [
      {
        "Lead ID": "LB-CONSENT-ACTION",
        "Current Stage": "CREDIT_ASSESSMENT",
        "Document Status": "VERIFIED",
        "Processing Route": "AI_DIRECT",
        "Risk Level": "LOW",
        Priority: "HIGH",
      },
    ],
    role: "admin",
    data: {
      Product_Credit_Policy: [{ Status: "ACTIVE" }],
      Credit_Assessment: [
        {
          "Lead ID": "LB-CONSENT-ACTION",
          "Assessment Status": "ELIGIBLE_FOR_LMS",
          "LMS Submission Eligibility": "YES",
        },
      ],
      Document_Received_Log: [],
    },
  });
  const alert = result.alerts.find(
    (item) => item.id === "credit-bureau-consent",
  );
  assert.equal(alert?.count, 1);
  assert.equal(alert?.target, "Applications");
});

test("disbursed and declined cases do not create post-approval actions", () => {
  const result = buildActionCenter({
    leads: [
      {
        "Lead ID": "LB-DISBURSED",
        "Current Stage": "DISBURSED",
        "Disbursed At": "2026-08-11T04:00:00Z",
        "Document Status": "COMPLETE",
        "Processing Route": "AI_DIRECT",
        "Risk Level": "LOW",
        Priority: "HIGH",
      },
      {
        "Lead ID": "LB-DECLINED",
        "Current Stage": "LMS",
        "Document Status": "COMPLETE",
        "Processing Route": "AI_DIRECT",
        "Risk Level": "LOW",
        Priority: "HIGH",
      },
    ],
    role: "admin",
    data: {
      Product_Credit_Policy: [{ Status: "ACTIVE" }],
      LMS_Credit_Result: [
        { "Lead ID": "LB-DISBURSED", "Final Decision": "APPROVED" },
        { "Lead ID": "LB-DECLINED", "Final Decision": "DECLINED" },
      ],
    },
  });
  assert.equal(
    result.alerts.some((item) => item.id === "post-approval"),
    false,
  );
});
