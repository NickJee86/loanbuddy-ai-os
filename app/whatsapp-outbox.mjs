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
