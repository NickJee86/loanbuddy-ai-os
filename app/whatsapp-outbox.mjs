export const OUTBOX_HEADERS = Object.freeze([
  "Message ID", "Created Date", "Lead ID", "Lead Name", "Phone Number", "Branch ID", "Assigned Sales ID", "Message Type", "Message Content", "Send Status", "Send Date", "Remarks", "Channel", "Idempotency Key", "Assessment ID", "Language", "Attachment Type", "Attachment Reference", "Attachment File Name", "Consent Form ID", "Consent Version", "Delivery Status", "Scheduled Time", "Source", "External LMS Submission",
]);

export function validateManualWhatsApp(input = {}) {
  const leadId = String(input.leadId || "").trim();
  const phone = String(input.phone || "").replace(/\D/g, "").replace(/^0/, "60");
  const message = String(input.message || "").trim();
  if (!leadId) return { ok: false, error: "Lead ID is required." };
  if (!/^601\d{8,9}$/.test(phone)) return { ok: false, error: "Customer phone number is invalid." };
  if (!message) return { ok: false, error: "Message cannot be empty." };
  if (message.length > 3000) return { ok: false, error: "Message is too long (maximum 3,000 characters)." };
  return { ok: true, leadId, phone, message };
}

export function buildManualOutboxRecord(input = {}, now = new Date().toISOString(), id = crypto.randomUUID()) {
  const valid = validateManualWhatsApp(input);
  if (!valid.ok) throw new Error(valid.error);
  const messageId = `CRM-WA-${id}`;
  return {
    "Message ID": messageId, "Created Date": now, "Lead ID": valid.leadId,
    "Lead Name": String(input.leadName || "").trim(), "Phone Number": valid.phone,
    "Branch ID": String(input.branchId || "").trim(), "Assigned Sales ID": String(input.salesId || "").trim(),
    "Message Type": "MANUAL_CRM", "Message Content": valid.message, "Send Status": "Pending",
    "Send Date": "", Remarks: "Queued by CRM user", Channel: "WhatsApp",
    "Idempotency Key": String(input.idempotencyKey || messageId), "Assessment ID": "",
    Language: String(input.language || "ms").trim().toLowerCase(), "Attachment Type": "",
    "Attachment Reference": "", "Attachment File Name": "", "Consent Form ID": "",
    "Consent Version": "", "Delivery Status": "QUEUED", "Scheduled Time": now,
    Source: "CRM_MANUAL", "External LMS Submission": "NO",
  };
}
