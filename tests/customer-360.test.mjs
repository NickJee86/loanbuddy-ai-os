import assert from "node:assert/strict";
import test from "node:test";
import { buildConversationRows, buildConversationSummaries, buildConversationTimeline, buildDocumentChecklist } from "../app/customer-360.mjs";

const sources = {
  customerInbox: [{ "Lead ID": "LB-1", "Message ID": "MSG-1", "Customer Message": "Saya mahu pinjaman", Timestamp: "2026-08-08T01:00:00Z" }],
  replyLog: [{ "Lead ID": "LB-1", "Message ID": "MSG-2", "Customer Message": "Gaji RM5000", "AI Response": "Baik, sila hantar dokumen", Timestamp: "2026-08-08T01:01:00Z" }],
  messageOutbox: [{ "Lead ID": "LB-1", "Message ID": "OUT-1", Message: "Reminder dokumen", "Created Date": "2026-08-08T01:02:00Z" }],
  documents: [
    { "Lead ID": "LB-1", "Document Type": "IC_FRONT", "Original File Name": "ic-front.png", "File URL": "https://rexmgt.sharepoint.com/ic-front", Status: "RECEIVED", "Verification Status": "PENDING", "Received Date": "2026-08-08T01:03:00Z" },
    { "Lead ID": "LB-1", "Document Type": "PAYSLIP", "Original File Name": "payslip.pdf", Status: "RECEIVED", "Received Date": "2026-08-08T01:04:00Z" },
  ],
};

test("customer timeline merges inbound, AI and document events chronologically", () => {
  const timeline = buildConversationTimeline("LB-1", sources);
  assert.deepEqual(timeline.map((event) => `${event.type}:${event.direction}`), [
    "message:customer",
    "message:customer",
    "message:ai",
    "message:ai",
    "document:customer",
    "document:customer",
  ]);
  assert.equal(timeline[4].documentType, "IC_FRONT");
});

test("the same webhook message copied between logs is shown only once", () => {
  const timeline = buildConversationTimeline("LB-1", {
    customerInbox: [{
      "Lead ID": "LB-1",
      "Message ID": "wamid.duplicate-1",
      "Customer Message": "Saya mahu pinjaman",
      Timestamp: "2026-08-08T01:00:00Z",
    }],
    replyLog: [{
      "Lead ID": "LB-1",
      "Message ID": "WAMID.DUPLICATE-1",
      "Customer Message": "Saya mahu pinjaman",
      Timestamp: "2026-08-08T01:00:03Z",
    }],
  });
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].source, "Customer Inbox");
});

test("repeated customer text remains separate when message IDs differ", () => {
  const timeline = buildConversationTimeline("LB-1", {
    customerInbox: [
      {
        "Lead ID": "LB-1",
        "Message ID": "wamid.answer-1",
        "Customer Message": "Ya",
        Timestamp: "2026-08-08T01:00:00Z",
      },
      {
        "Lead ID": "LB-1",
        "Message ID": "wamid.answer-2",
        "Customer Message": "Ya",
        Timestamp: "2026-08-08T01:02:00Z",
      },
    ],
  });
  assert.equal(timeline.length, 2);
});

test("document checklist keeps required and optional slots with latest record", () => {
  const checklist = buildDocumentChecklist("LB-1", sources.documents);
  assert.equal(checklist.length, 7);
  assert.equal(checklist.find((item) => item.type === "IC_FRONT").record.fileName, "ic-front.png");
  assert.equal(checklist.find((item) => item.type === "EPF_STATEMENT").required, false);
  assert.equal(
    checklist.find((item) => item.type === "CTOS_CCRIS_CONSENT").lmsRequired,
    true,
  );
  assert.equal(
    checklist.find((item) => item.type === "CUSTOMER_CCRIS_REPORT").referenceOnly,
    true,
  );
});

test("conversation summary groups one customer into one thread", () => {
  const summaries = buildConversationSummaries([{ id: "LB-1", name: "Synthetic Customer", updated: "" }], sources);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].documentCount, 2);
  assert.equal(summaries[0].requiredReceived, 2);
  assert.equal(summaries[0].requiredTotal, 4);
});

test("conversation summary includes WhatsApp activity before a Leads row exists", () => {
  const summaries = buildConversationSummaries([], {
    customerInbox: [{
      "Lead ID": "WA-NEW-1",
      "Phone Number": "60147984989",
      "Customer Message": "hi",
      Timestamp: "2026-08-26T02:00:00Z",
    }],
  });
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].lead.id, "WA-NEW-1");
  assert.equal(summaries[0].lead.name, "WhatsApp User");
  assert.equal(summaries[0].lead.phone, "60147984989");
  assert.equal(summaries[0].lead.stage, "New WhatsApp");
  assert.equal(summaries[0].lead.processingRoute, "AI_DIRECT");
  assert.deepEqual(summaries[0].lead.raw, {});
  assert.equal(summaries[0].timeline[0].text, "hi");
});

test("conversation records combine inbox, reply log and outbox instead of hiding sources", () => {
  const rows = buildConversationRows(
    [{ id: "LB-1", name: "Synthetic Customer", phone: "60123456789", updated: "" }],
    sources,
  );
  assert.equal(rows.length, 4);
  assert.deepEqual(new Set(rows.map((row) => row.Source)), new Set([
    "Customer Inbox",
    "Customer Reply Log",
    "AI Response",
    "Message Outbox",
  ]));
  assert.equal(rows[0].Message, "Reminder dokumen");
  assert.equal(rows[0].Direction, "OUTBOUND");
});

test("manual CRM outbox messages use the production Message Content field", () => {
  const timeline = buildConversationTimeline("L-MANUAL", {
    messageOutbox: [
      {
        "Message ID": "CRM-WA-1",
        "Lead ID": "L-MANUAL",
        "Message Content": "Manual WhatsApp reply",
        "Created Date": "2026-08-22T01:00:00.000Z",
        "Send Status": "Pending",
      },
    ],
  });
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].text, "Manual WhatsApp reply");
  assert.equal(timeline[0].source, "Message Outbox");
});

test("SharePoint filename is recovered when legacy log rows have no filename column", () => {
  const checklist = buildDocumentChecklist("LB-2", [{
    "Lead ID": "LB-2",
    "Document Type": "BANK_STATEMENT",
    "File URL": "https://rexmgt.sharepoint.com/sites/Loanbuddy/Documents/LB-2_BANK_STATEMENT_test-file.pdf",
  }]);
  assert.equal(checklist.find((item) => item.type === "BANK_STATEMENT").record.fileName, "LB-2_BANK_STATEMENT_test-file.pdf");
});

test("customer timeline includes staff activities and credit decisions", () => {
  const timeline = buildConversationTimeline("LB-3", {
    activities: [{
      "Lead ID": "LB-3",
      "Activity Type": "CASE_NOTE",
      Description: "Customer called and confirmed employment details.",
      "Created By": "k2015",
      "Activity Date": "2026-08-11T01:00:00Z",
    }],
    creditDecisions: [{
      "Lead ID": "LB-3",
      "Decision ID": "DEC-1",
      Decision: "MANUAL_REVIEW",
      "Reason Codes": "EMPLOYER_REVIEW",
      "Created At": "2026-08-11T01:01:00Z",
    }],
  });
  assert.deepEqual(timeline.map((event) => event.type), ["activity", "activity"]);
  assert.equal(timeline[0].actor, "k2015");
  assert.match(timeline[1].text, /EMPLOYER_REVIEW/);
});

test("customer timeline includes verification, assessment, internal queue and official LMS result events", () => {
  const timeline = buildConversationTimeline("LB-4", {
    verifications: [{
      "Lead ID": "LB-4",
      "Overall Verification Status": "VERIFIED",
      "AI Confidence": "98",
      "Verified At": "2026-08-11T01:00:00Z",
    }],
    assessments: [{
      "Lead ID": "LB-4",
      "Assessment ID": "CA-4",
      "Assessment Status": "ELIGIBLE_FOR_LMS",
      "Assessment Mode": "ACTIVE",
      "Assessed At": "2026-08-11T01:01:00Z",
    }],
    lmsQueue: [{
      "Lead ID": "LB-4",
      "Queue ID": "LMSQ-4",
      "Queue Status": "QUEUED",
      "Requested At": "2026-08-11T01:02:00Z",
    }],
    lmsResults: [{
      "Lead ID": "LB-4",
      "Final Decision": "APPROVED",
      "LMS Submission ID": "LMS-4",
      "Decision At": "2026-08-11T01:03:00Z",
    }],
  });
  assert.deepEqual(
    timeline.map((event) => event.category),
    [
      "DOCUMENT_VERIFICATION",
      "PRE_LMS_ASSESSMENT",
      "INTERNAL_LMS_QUEUE",
      "LMS_RESULT",
    ],
  );
  assert.match(timeline[2].text, /Internal queue/);
  assert.match(timeline[3].text, /APPROVED/);
});
