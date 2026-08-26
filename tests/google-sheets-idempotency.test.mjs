import assert from "node:assert/strict";
import test from "node:test";
import { idempotencyMetadataCandidates } from "../app/idempotency-metadata.mjs";

test("spreadsheet idempotency metadata IDs are deterministic, positive and collision-probed", () => {
  const first = idempotencyMetadataCandidates("LOANBUDDY_LMS_QUEUE", "LB-LMS-LB-1-V2-CA-1");
  const second = idempotencyMetadataCandidates("LOANBUDDY_LMS_QUEUE", "LB-LMS-LB-1-V2-CA-1");
  assert.deepEqual(first, second);
  assert.equal(new Set(first).size, first.length);
  assert.ok(first.every((id) => Number.isInteger(id) && id > 0));
});
