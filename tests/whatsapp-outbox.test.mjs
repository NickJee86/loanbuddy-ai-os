import test from "node:test";
import assert from "node:assert/strict";
import { buildManualMediaOutboxRecord, buildManualOutboxRecord, buildWhatsAppMediaPayload, findMatchingConversationRow, matchesPreLeadConversation, shouldCancelAutomatedOutboxRow, validateManualWhatsApp, validateWhatsAppAttachment } from "../app/whatsapp-outbox.mjs";

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
test("validates supported WhatsApp attachments and limits", () => {
  const image = validateWhatsAppAttachment({ leadId: "L1", phone: "016-896 8888", fileName: "offer.jpg", mimeType: "image/jpeg", size: 1024, caption: "Offer" });
  assert.equal(image.ok, true); assert.equal(image.attachmentType, "image");
  assert.equal(validateWhatsAppAttachment({ leadId: "L1", phone: "60168968888", fileName: "x.exe", mimeType: "application/octet-stream", size: 10 }).ok, false);
  assert.equal(validateWhatsAppAttachment({ leadId: "L1", phone: "60168968888", fileName: "x.png", mimeType: "image/png", size: 6 * 1024 * 1024 }).ok, false);
});
test("builds Meta image and document payloads", () => {
  assert.deepEqual(buildWhatsAppMediaPayload({ attachmentType: "image", mediaId: "m1", phone: "60168968888", caption: "Hi" }), { messaging_product: "whatsapp", recipient_type: "individual", to: "60168968888", type: "image", image: { id: "m1", caption: "Hi" } });
  assert.equal(buildWhatsAppMediaPayload({ attachmentType: "document", mediaId: "m2", phone: "60168968888", fileName: "form.pdf" }).document.filename, "form.pdf");
});
test("builds a sent media outbox row", () => {
  const row = buildManualMediaOutboxRecord({ leadId: "L1", phone: "60168968888", fileName: "offer.png", mimeType: "image/png", size: 1024, caption: "Offer", mediaId: "media-1" }, "2026-08-28T00:00:00.000Z", "wamid-1");
  assert.equal(row["Message Type"], "IMAGE"); assert.equal(row["Attachment Reference"], "media-1"); assert.equal(row["Delivery Status"], "ACCEPTED");
});


test("pre-lead access accepts a verified temporary ID and phone pair", () => {
  assert.equal(matchesPreLeadConversation({
    leadId: "WA-NEW-1",
    phone: "+60147984989",
    rows: [{ "Lead ID": "WA-NEW-1", From: "+60147984989" }],
  }), true);
});

test("pre-lead access rejects a temporary ID paired with another phone", () => {
  assert.equal(matchesPreLeadConversation({
    leadId: "WA-NEW-1",
    phone: "+60140000000",
    rows: [{ "Lead ID": "WA-NEW-1", From: "+60147984989" }],
  }), false);
});

test("pre-lead and manual CRM controls accept a valid international WhatsApp number", () => {
  assert.equal(matchesPreLeadConversation({
    leadId: "WA-US-1",
    phone: "16315551181",
    rows: [{ "Lead ID": "WA-US-1", From: "16315551181" }],
  }), true);
  assert.equal(validateManualWhatsApp({ leadId: "WA-US-1", phone: "16315551181", message: "Hello" }).ok, true);
});

test("manual takeover cancels pending automated messages for the same customer", () => {
  assert.equal(shouldCancelAutomatedOutboxRow({
    "Lead ID": "L1", "Phone Number": "60168968888", "Send Status": "Pending", "Message Type": "AI_DOCUMENT_REMINDER_1", Source: "S09",
  }, { leadId: "L1", phone: "60168968888" }), true);
});

test("manual takeover preserves staff messages and other customers", () => {
  assert.equal(shouldCancelAutomatedOutboxRow({
    "Lead ID": "L1", "Phone Number": "60168968888", "Send Status": "Pending", "Message Type": "MANUAL_CRM", Source: "CRM_MANUAL",
  }, { leadId: "L1", phone: "60168968888" }), false);
  assert.equal(shouldCancelAutomatedOutboxRow({
    "Lead ID": "L2", "Phone Number": "60120000000", "Send Status": "Pending", "Message Type": "AI_REPLY", Source: "S00",
  }, { leadId: "L1", phone: "60168968888" }), false);
});

test("handoff state prefers the exact lead and otherwise the latest row for the phone", () => {
  const rows = [
    { rowNumber: 2, record: { "Lead ID": "OLD", "Phone Number": "60168968888", "AI Status": "ACTIVE" } },
    { rowNumber: 3, record: { "Lead ID": "NEW", "Phone Number": "60168968888", "AI Status": "PAUSED_MANUAL" } },
  ];
  assert.equal(findMatchingConversationRow(rows, { leadId: "NEW", phone: "60168968888" }).rowNumber, 3);
  assert.equal(findMatchingConversationRow(rows, { leadId: "UNKNOWN", phone: "0168968888" }).rowNumber, 3);
});
