import test from "node:test";
import assert from "node:assert/strict";
import { followUpMetrics, followUpPatch, followUpPriority, validateFollowUpAction } from "../app/follow-up-operations.mjs";

test("requires a future date when rescheduling", () => {
  const result = validateFollowUpAction({ action: "RESCHEDULE", leadId: "L1", dueAt: "2026-01-01" }, Date.parse("2026-08-28"));
  assert.equal(result.valid, false);
});

test("queue now remains a queue action and does not claim delivery", () => {
  const result = followUpPatch({ action: "QUEUE_NOW", leadId: "L1", phone: "6012", note: "" }, {}, "2026-08-28T08:00:00.000Z");
  assert.equal(result.Status, "READY");
  assert.match(result["Next Action"], /S09 is enabled/);
  assert.equal(result["Delivery Status"], undefined);
});

test("rejects outcomes outside the reporting whitelist", () => {
  const result = validateFollowUpAction({ action: "OUTCOME", leadId: "L1", outcome: "maybe later lah" });
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /Outcome must be/);
});

test("normalizes accepted outcomes for consistent reporting", () => {
  const result = validateFollowUpAction({ action: "OUTCOME", leadId: "L1", outcome: "documents received" });
  assert.equal(result.valid, true);
  assert.equal(result.value.outcome, "DOCUMENTS_RECEIVED");
  assert.equal(followUpPatch(result.value).Outcome, "DOCUMENTS_RECEIVED");
});

test("derives urgent and operational metrics", () => {
  const rows = [
    { "Due At": "2026-08-28T07:00:00.000Z", Status: "READY" },
    { Status: "PAUSED", "AI Status": "PAUSED" },
    { Status: "FAILED", "Delivery Status": "ERROR" },
  ];
  assert.equal(followUpPriority(rows[0], Date.parse("2026-08-28T08:00:00.000Z")), "URGENT");
  assert.deepEqual(followUpMetrics(rows, Date.parse("2026-08-28T08:00:00.000Z")), {
    total: 3, dueNow: 1, paused: 1, failed: 1, finalStage: 0,
  });
});
