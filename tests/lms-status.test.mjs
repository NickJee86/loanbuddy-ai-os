import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLmsStatus,
  hasExternalSubmissionEvidence,
} from "../app/lms-status.mjs";

test("a queued internal row is not an external submission", () => {
  assert.equal(hasExternalSubmissionEvidence({ "Queue Status": "QUEUED" }), false);
  const result = buildLmsStatus({
    leads: [{ "Lead ID": "LB-1" }],
    queueRows: [{ "Lead ID": "LB-1", "Queue Status": "QUEUED" }],
  });
  assert.equal(result.summary.internalQueue, 1);
  assert.equal(result.summary.externalSubmitted, 0);
});

test("submission evidence is counted once per visible lead", () => {
  assert.equal(
    hasExternalSubmissionEvidence({ "Queue Status": "SUBMITTED" }),
    false,
  );
  const result = buildLmsStatus({
    leads: [{ "Lead ID": "LB-1" }],
    queueRows: [
      { "Lead ID": "LB-1", "Queue Status": "SUBMITTED" },
      { "Lead ID": "LB-1", "LMS Submission ID": "LMS-1" },
    ],
  });
  assert.equal(result.summary.externalSubmitted, 1);
});

test("only the latest official decision is displayed and counted", () => {
  const result = buildLmsStatus({
    leads: [{ "Lead ID": "LB-1" }],
    resultRows: [
      {
        "Lead ID": "LB-1",
        "Final Decision": "APPROVED",
        "Decision At": "2026-08-11T01:00:00Z",
      },
      {
        "Lead ID": "LB-1",
        "Final Decision": "DECLINED",
        "Decision At": "2026-08-11T02:00:00Z",
      },
    ],
  });
  assert.equal(result.summary.officialDecisions, 1);
  assert.equal(result.summary.approved, 0);
  assert.equal(result.resultRows[0]["Final Decision"], "DECLINED");
});

test("rows outside the current role-scoped lead set stay hidden", () => {
  const result = buildLmsStatus({
    leads: [{ "Lead ID": "LB-1" }],
    queueRows: [{ "Lead ID": "OTHER", "Queue Status": "SUBMITTED" }],
    resultRows: [{ "Lead ID": "OTHER", "Final Decision": "APPROVED" }],
  });
  assert.equal(result.queueRows.length, 0);
  assert.equal(result.resultRows.length, 0);
});
