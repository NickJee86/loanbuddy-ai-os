import test from "node:test";
import assert from "node:assert/strict";
import { buildManualOutboxRecord, validateManualWhatsApp } from "../app/whatsapp-outbox.mjs";

test("normalizes Malaysian mobile and validates content", () => {
  assert.deepEqual(validateManualWhatsApp({ leadId: "L1", phone: "016-896 8888", message: " Hi " }), { ok: true, leadId: "L1", phone: "60168968888", message: "Hi" });
});
test("builds a pending CRM WhatsApp outbox row", () => {
  const row = buildManualOutboxRecord({ leadId: "L1", phone: "60168968888", message: "Hello" }, "2026-08-22T00:00:00.000Z", "abc");
  assert.equal(row["Message ID"], "CRM-WA-abc"); assert.equal(row["Send Status"], "Pending"); assert.equal(row.Channel, "WhatsApp"); assert.equal(row.Source, "CRM_MANUAL");
});
test("rejects empty and invalid messages", () => {
  assert.equal(validateManualWhatsApp({ leadId: "L1", phone: "123", message: "x" }).ok, false);
  assert.equal(validateManualWhatsApp({ leadId: "L1", phone: "60168968888", message: " " }).ok, false);
});
