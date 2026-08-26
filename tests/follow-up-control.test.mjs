import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFollowUpConfigRecords,
  DEFAULT_FOLLOW_UP_SETTINGS,
  readFollowUpSettings,
  validateFollowUpSettings,
} from "../app/follow-up-control.mjs";

test("uses safe production defaults when configuration is absent", () => {
  assert.deepEqual(
    readFollowUpSettings([]),
    { ...DEFAULT_FOLLOW_UP_SETTINGS, configured: false, updatedAt: "" },
  );
});

test("rejects unordered timings and unsafe stop controls", () => {
  const result = validateFollowUpSettings({
    ...DEFAULT_FOLLOW_UP_SETTINGS,
    secondMinutes: 60,
    stopOnReply: false,
  });
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 2);
});

test("round trips the approved four-step schedule", () => {
  const records = buildFollowUpConfigRecords(
    DEFAULT_FOLLOW_UP_SETTINGS,
    "2026-08-26T04:00:00.000Z",
  );
  const result = readFollowUpSettings(records);
  assert.equal(result.configured, true);
  assert.equal(result.firstMinutes, 120);
  assert.equal(result.finalMinutes, 10080);
  assert.equal(result.stopOnOptOut, true);
});
