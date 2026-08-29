import test from "node:test";
import assert from "node:assert/strict";
import { deliveryOutcomeMetrics, deliveryTransition, evaluateFollowUpCandidate, followUpStopReason, retryDecision } from "../app/follow-up-runtime.mjs";

const settings = { enabled: true, stopOnReply: true, stopOnOptOut: true, firstMinutes: 120, secondMinutes: 1440, thirdMinutes: 4320, finalMinutes: 10080, maxCount: 4 };

test("queues only a due candidate and derives its deterministic stage", () => {
  const result = evaluateFollowUpCandidate({ lead: { "Lead ID": "L1", "Reminder Count": "0", "Created Date": "2026-08-29T00:00:00.000Z" }, settings, now: Date.parse("2026-08-29T02:00:00.000Z") });
  assert.deepEqual(result, { eligible: true, stopReason: "", stage: "REMINDER_1", dueAt: "2026-08-29T02:00:00.000Z" });
});

test("stops on reply, takeover, opt-out, completion, LMS and duplicate queue", () => {
  assert.equal(followUpStopReason({ lead: {}, conversation: { "AI Status": "PAUSED_MANUAL" }, settings }), "MANUAL_TAKEOVER");
  assert.equal(followUpStopReason({ lead: { "Last AI Message Time": "2026-08-29T01:00:00Z" }, conversation: { "Last Customer Reply At": "2026-08-29T02:00:00Z" }, settings }), "CUSTOMER_REPLIED");
  assert.equal(followUpStopReason({ lead: {}, conversation: { "Last Customer Reply": "Stop, tak mahu lagi" }, settings }), "OPTED_OUT");
  assert.equal(followUpStopReason({ lead: { "Document Status": "VERIFIED" }, settings }), "DOCUMENTS_RECEIVED");
  assert.equal(followUpStopReason({ lead: { "LMS Status": "SUBMITTED" }, settings }), "LMS_STARTED");
  assert.equal(followUpStopReason({ lead: { "Lead ID": "L1" }, outbox: [{ "Lead ID": "L1", "Send Status": "Pending", Source: "S09" }], settings }), "ALREADY_QUEUED");
});

test("delivery callbacks never regress and failed rows use bounded retry", () => {
  assert.equal(deliveryTransition("DELIVERED", "SENT"), "DELIVERED");
  assert.equal(deliveryTransition("DELIVERED", "READ"), "READ");
  assert.deepEqual(retryDecision({ "Delivery Status": "FAILED", "Retry Count": "0" }, Date.parse("2026-08-29T00:00:00Z")), { retry: true, escalate: false, dueAt: "2026-08-29T00:05:00.000Z", nextRetryCount: 1 });
  assert.deepEqual(retryDecision({ "Delivery Status": "FAILED", "Retry Count": "3" }), { retry: false, escalate: true, dueAt: "" });
});

test("reports sent, delivered, read, reply, recovery and failure outcomes", () => {
  assert.deepEqual(deliveryOutcomeMetrics([
    { "Delivery Status": "SENT" },
    { "Delivery Status": "DELIVERED", "Customer Reply At": "2026-08-29T01:00:00Z" },
    { "Delivery Status": "READ", Outcome: "DOCUMENTS_RECEIVED" },
    { "Delivery Status": "FAILED" },
  ]), { sent: 3, delivered: 2, read: 1, replied: 1, recovered: 1, failed: 1 });
});
