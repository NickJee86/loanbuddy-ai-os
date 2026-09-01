export const OUTBOX_HEADERS = Object.freeze([
  "Message ID", "Created Date", "Lead ID", "Lead Name", "Phone Number",
  "Branch ID", "Assigned Sales ID", "Message Type", "Message Content",
  "Send Status", "Send Date", "Remarks", "Channel", "Idempotency Key",
  "Assessment ID", "Language", "Attachment Type", "Attachment Reference",
  "Attachment File Name", "Consent Form ID", "Inbound WABA ID",
  "Inbound Phone Number ID", "Inbound WhatsApp Number", "Sender Channel",
  "External LMS Submission",
  "Consent Version", "Delivery Status", "Scheduled Time", "Source",
]);

export const WHATSAPP_MEDIA_LIMITS = Object.freeze({
  "image/jpeg": 5 * 1024 * 1024,
  "image/png": 5 * 1024 * 1024,
  "application/pdf": 10 * 1024 * 1024,
});

export function shouldCancelAutomatedOutboxRow(row = {}, identity = {}) {
  const leadId = String(identity.leadId || "").trim();
  const phone = String(identity.phone || "").replace(/\D/g, "").replace(/^0/, "60");
  const rowLeadId = String(row["Lead ID"] || "").trim();
  const rowPhone = String(row["Phone Number"] || "").replace(/\D/g, "").replace(/^0/, "60");
  const matchesCustomer = (leadId && rowLeadId === leadId) || (phone && rowPhone === phone);
  const pending = String(row["Send Status"] || "").trim().toLowerCase() === "pending";
  const source = String(row.Source || "").trim().toUpperCase();
  const messageType = String(row["Message Type"] || "").trim().toUpperCase();
  const manual = source === "CRM_MANUAL" || messageType === "MANUAL_CRM";
  return Boolean(matchesCustomer && pending && !manual);
}

export function findMatchingConversationRow(rows = [], identity = {}) {
  const leadId = String(identity.leadId || "").trim();
  const phone = String(identity.phone || "").replace(/\D/g, "").replace(/^0/, "60");
  const exactLead = [...rows].reverse().find((row) => String(row?.record?.["Lead ID"] || "").trim() === leadId);
  if (exactLead) return exactLead;
  return [...rows].reverse().find((row) => phone && String(row?.record?.["Phone Number"] || "").replace(/\D/g, "").replace(/^0/, "60") === phone);
}

export function matchesPreLeadConversation(input = {}) {
  const leadId = String(input.leadId || "").trim();
  const phoneKey = String(input.phone || "").replace(/\D/g, "").replace(/^0/, "60");
  if (!leadId || !/^\d{8,15}$/.test(phoneKey)) return false;
  const identityPhone = leadId.replace(/\D/g, "").replace(/^0/, "60");
  if (identityPhone === phoneKey) return true;
  return (input.rows || []).some((row) => {
    const rowLeadId = String(row?.["Lead ID"] || row?.LeadId || row?.leadId || "").trim();
    const rowPhone = String(row?.["Phone Number"] || row?.["WhatsApp Number"] || row?.["Customer Phone"] || row?.Phone || row?.From || "")
      .replace(/\D/g, "")
      .replace(/^0/, "60");
    return rowLeadId === leadId && rowPhone === phoneKey;
  });
}

export function validateManualWhatsApp(input = {}) {
  const leadId = String(input.leadId || "").trim();
  const phone = String(input.phone || "").replace(/\D/g, "").replace(/^0/, "60");
  const message = String(input.message || "").trim();
  if (!leadId) return { ok: false, error: "Lead ID is required." };
  if (!/^\d{8,15}$/.test(phone)) return { ok: false, error: "Customer phone number is invalid." };
  if (!message) return { ok: false, error: "Message cannot be empty." };
  if (message.length > 3000) return { ok: false, error: "Message is too long (maximum 3,000 characters)." };
  return { ok: true, leadId, phone, message };
}


function routingFields(input = {}) {
  return {
    "Inbound WABA ID": String(input.inboundWabaId || input["Inbound WABA ID"] || "").trim(),
    "Inbound Phone Number ID": String(input.inboundPhoneNumberId || input["Inbound Phone Number ID"] || "").trim(),
    "Inbound WhatsApp Number": String(input.inboundWhatsAppNumber || input["Inbound WhatsApp Number"] || "").trim(),
    "Sender Channel": String(input.senderChannel || input["Sender Channel"] || "WhatsApp Primary").trim(),
  };
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
    Source: "CRM_MANUAL", ...routingFields(input), "External LMS Submission": "NO",
  };
}

export function validateWhatsAppAttachment(input = {}) {
  const leadId = String(input.leadId || "").trim();
  const phone = String(input.phone || "").replace(/\D/g, "").replace(/^0/, "60");
  const fileName = String(input.fileName || "").trim();
  const mimeType = String(input.mimeType || "").trim().toLowerCase();
  const size = Number(input.size || 0);
  const caption = String(input.caption || "").trim();
  if (!leadId) return { ok: false, error: "Lead ID is required." };
  if (!/^\d{8,15}$/.test(phone)) return { ok: false, error: "Customer phone number is invalid." };
  if (!fileName) return { ok: false, error: "Please choose an image or PDF file." };
  const limit = WHATSAPP_MEDIA_LIMITS[mimeType];
  if (!limit) return { ok: false, error: "Only JPG, PNG and PDF files are supported." };
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: "The selected file is empty." };
  if (size > limit) return { ok: false, error: `File is too large (maximum ${limit / 1024 / 1024} MB).` };
  if (caption.length > 1024) return { ok: false, error: "Media caption is too long (maximum 1,024 characters)." };
  return { ok: true, leadId, phone, fileName, mimeType, size, caption, attachmentType: mimeType === "application/pdf" ? "document" : "image" };
}

export function buildWhatsAppMediaPayload(input = {}) {
  const attachmentType = input.attachmentType === "document" ? "document" : "image";
  const media = { id: String(input.mediaId || "").trim() };
  if (!media.id) throw new Error("WhatsApp media ID is required.");
  const caption = String(input.caption || "").trim();
  if (caption) media.caption = caption;
  if (attachmentType === "document") media.filename = String(input.fileName || "document.pdf").trim();
  return { messaging_product: "whatsapp", recipient_type: "individual", to: String(input.phone || "").trim(), type: attachmentType, [attachmentType]: media };
}

export function buildManualMediaOutboxRecord(input = {}, now = new Date().toISOString(), id = crypto.randomUUID()) {
  const valid = validateWhatsAppAttachment(input);
  if (!valid.ok) throw new Error(valid.error);
  const messageId = `CRM-WA-MEDIA-${id}`;
  return {
    "Message ID": messageId, "Created Date": now, "Lead ID": valid.leadId,
    "Lead Name": String(input.leadName || "").trim(), "Phone Number": valid.phone,
    "Branch ID": String(input.branchId || "").trim(), "Assigned Sales ID": String(input.salesId || "").trim(),
    "Message Type": valid.attachmentType === "image" ? "IMAGE" : "DOCUMENT", "Message Content": valid.caption,
    "Send Status": "Sent", "Send Date": now, Remarks: "Sent from CRM via WhatsApp Cloud API", Channel: "WhatsApp",
    "Idempotency Key": String(input.idempotencyKey || messageId), "Assessment ID": "", Language: String(input.language || "ms").trim().toLowerCase(),
    "Attachment Type": valid.attachmentType, "Attachment Reference": String(input.mediaId || "").trim(), "Attachment File Name": valid.fileName,
    "Consent Form ID": "", "Consent Version": "", "Delivery Status": "ACCEPTED", "Scheduled Time": now,
    Source: "CRM_MANUAL", ...routingFields(input), "External LMS Submission": "NO",
  };
}
