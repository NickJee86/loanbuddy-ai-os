export const DOCUMENT_DEFINITIONS = Object.freeze([
  { type: "IC_FRONT", label: "IC Front", required: true },
  { type: "IC_BACK", label: "IC Back", required: true },
  { type: "PAYSLIP", label: "Latest Payslip", required: true },
  { type: "BANK_STATEMENT", label: "Bank Statement", required: true },
  { type: "EPF_STATEMENT", label: "EPF Statement", required: false },
  {
    type: "CTOS_CCRIS_CONSENT",
    label: "CTOS / CCRIS Consent Letter",
    required: false,
    lmsRequired: true,
  },
  {
    type: "CUSTOMER_CCRIS_REPORT",
    label: "Customer-provided CCRIS Report",
    required: false,
    referenceOnly: true,
  },
]);

function value(row, keys) {
  for (const key of keys) {
    const candidate = String(row?.[key] || "").trim();
    if (candidate) return candidate;
  }
  return "";
}

function normalizedType(input) {
  return String(input || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function timestamp(row, keys) {
  return value(row, keys) || "";
}

function timeValue(input) {
  const parsed = Date.parse(input || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function fileName(row) {
  const explicit = value(row, ["Original File Name", "File Name", "Document Name"]);
  if (explicit) return explicit;
  try {
    const url = new URL(value(row, ["File URL", "SharePoint URL", "Document URL"]));
    return decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
  } catch { return ""; }
}

function conversationIdentity(row) {
  return value(row, ["Lead ID", "LeadId", "leadId"]) ||
    value(row, ["Phone Number", "WhatsApp Number", "Customer Phone", "Phone", "From"]);
}

function rowsForLead(rows, leadId) {
  return (rows || []).filter((row) => conversationIdentity(row) === leadId);
}

function messageEvent(row, leadId, direction, text, at, source, index) {
  const messageId = value(row, ["Message ID", "Reply ID", "Outbox ID", "Webhook ID"]);
  return {
    id: `${source}-${messageId || index}-${direction}`,
    type: "message",
    direction,
    leadId,
    text,
    at,
    source,
    messageId,
    status: value(row, ["Status", "Process Status", "Delivery Status"]),
    attachmentType: value(row, ["Attachment Type"]).toLowerCase(),
    attachmentReference: value(row, ["Attachment Reference"]),
    attachmentFileName: value(row, ["Attachment File Name"]),
  };
}

function activityEvent(row, leadId, category, text, at, source, index) {
  return {
    id: `activity-${category}-${value(row, ["Activity ID", "Decision ID", "Follow Up ID"]) || index}`,
    type: "activity",
    direction: "system",
    leadId,
    category,
    text,
    at,
    source,
    actor: value(row, ["Created By", "Staff ID", "Assigned To", "Assessed By"]),
    status: value(row, ["Status", "Decision", "Assessment Status"]),
  };
}

function normalizedMessageText(input) {
  return String(input || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function messageDeduplicationKey(event) {
  const messageId = String(event.messageId || "").trim().toLowerCase();
  if (messageId) {
    return `message|${event.direction}|${event.leadId}|id:${messageId}`;
  }
  return `message|${event.direction}|${event.leadId}|text:${normalizedMessageText(event.text)}|${event.at}`;
}

export function buildConversationTimeline(leadId, sources = {}) {
  function isReplyLogCopyOfInbox(event, events) {
    if (event.type !== "message" || event.direction !== "customer" || event.source !== "Customer Reply Log") return false;
    const eventTime = timeValue(event.at);
    return events.some((candidate) =>
      candidate.type === "message" &&
      candidate.direction === "customer" &&
      candidate.source === "Customer Inbox" &&
      candidate.leadId === event.leadId &&
      normalizedMessageText(candidate.text) === normalizedMessageText(event.text) &&
      Math.abs(timeValue(candidate.at) - eventTime) <= 15000
    );
  }
  const events = [];
  rowsForLead(sources.customerInbox, leadId).forEach((row, index) => {
    const text = value(row, ["Customer Message", "Message", "Message Text", "Text"]);
    if (text) events.push(messageEvent(row, leadId, "customer", text, timestamp(row, ["Timestamp", "Received Date", "Created Date"]), "Customer Inbox", index));
  });

  rowsForLead(sources.replyLog, leadId).forEach((row, index) => {
    const at = timestamp(row, ["Timestamp", "Reply Timestamp", "Created Date", "Last Updated"]);
    const customerText = value(row, ["Customer Message", "Customer Reply", "Message"]);
    const aiText = value(row, ["AI Response", "AI Reply", "Response", "Assistant Message"]);
    if (customerText) events.push(messageEvent(row, leadId, "customer", customerText, at, "Customer Reply Log", index));
    if (aiText) events.push(messageEvent(row, leadId, "ai", aiText, at, "AI Response", index));
  });

  rowsForLead(sources.messageOutbox, leadId).forEach((row, index) => {
    const text = value(row, ["Message Content", "AI Response", "Outbound Message", "Message Body", "Message", "Message Text"]);
    const attachmentFileName = value(row, ["Attachment File Name"]);
    if (text || attachmentFileName) events.push(messageEvent(row, leadId, "ai", text || (value(row, ["Attachment Type"]).toLowerCase() === "image" ? "Image" : "File"), timestamp(row, ["Timestamp", "Sent Date", "Created Date", "Scheduled Time"]), "Message Outbox", index));
  });

  rowsForLead(sources.documents, leadId).forEach((row, index) => {
    const documentType = normalizedType(value(row, ["Document Type", "Detected Document Type", "Document Label"]));
    const resolvedFileName = fileName(row);
    const at = timestamp(row, ["Received Date", "Created Date", "Timestamp"]);
    const fileId = value(row, ["SharePoint File ID", "Drive File ID", "Received ID"]);
    events.push({
      id: `document-${fileId || `${documentType}-${index}`}`,
      type: "document",
      direction: "customer",
      leadId,
      text: resolvedFileName || documentType || "Customer document",
      at,
      source: value(row, ["Source", "Uploaded By"]) || "Document Received Log",
      documentType,
      fileName: resolvedFileName,
      fileUrl: value(row, ["File URL", "SharePoint URL", "Document URL"]),
      mimeType: value(row, ["MIME Type", "Mime Type"]),
      status: value(row, ["Status"]) || "RECEIVED",
      verificationStatus: value(row, ["Verification Status", "Overall Verification Status"]) || "PENDING",
    });
  });

  rowsForLead(sources.activities, leadId).forEach((row, index) => {
    const category = normalizedType(value(row, ["Activity Type"])) || "CASE_ACTIVITY";
    const text = value(row, ["Description", "Activity", "Notes"]) || category.replace(/_/g, " ");
    events.push(activityEvent(row, leadId, category, text, timestamp(row, ["Activity Date", "Created Date", "Timestamp"]), "Lead Activities", index));
  });

  rowsForLead(sources.followUps, leadId).forEach((row, index) => {
    const nextAction = value(row, ["Next Action", "Required Action", "Follow Up Type"]);
    const reason = value(row, ["Reason", "Remarks", "Description"]);
    const text = [nextAction, reason].filter(Boolean).join(" · ") || "Customer follow-up";
    events.push(activityEvent(row, leadId, "FOLLOW_UP", text, timestamp(row, ["Due At", "Scheduled At", "Follow Up Date", "Created At"]), "Follow-up Queue", index));
  });

  rowsForLead(sources.creditDecisions, leadId).forEach((row, index) => {
    const decision = value(row, ["Decision", "Decision Stage", "Assessment Status"]) || "Credit decision recorded";
    const reasons = value(row, ["Reason Codes", "Hard Rule Reasons"]);
    events.push(activityEvent(row, leadId, "CREDIT_DECISION", [decision, reasons].filter(Boolean).join(" · "), timestamp(row, ["Created At", "Assessed At"]), "Credit Decision Log", index));
  });

  rowsForLead(sources.verifications, leadId).forEach((row, index) => {
    const status = value(row, ["Overall Verification Status", "Verification Status", "Status"]) || "Verification recorded";
    const nextAction = value(row, ["Next Action"]);
    const confidence = value(row, ["AI Confidence", "Confidence"]);
    const details = [status, nextAction && `Next: ${nextAction}`, confidence && `Confidence: ${confidence}`].filter(Boolean).join(" · ");
    events.push(activityEvent(row, leadId, "DOCUMENT_VERIFICATION", details, timestamp(row, ["Verified At", "Verification Date", "Created At", "Last Updated"]), "Document Verification Log", index));
  });

  rowsForLead(sources.assessments, leadId).forEach((row, index) => {
    const status = value(row, ["Assessment Status", "Decision"]) || "Assessment recorded";
    const mode = value(row, ["Assessment Mode"]);
    const reasons = value(row, ["Reason Codes", "Hard Rule Reasons"]);
    const details = [status, mode && `Mode: ${mode}`, reasons].filter(Boolean).join(" · ");
    events.push(activityEvent(row, leadId, "PRE_LMS_ASSESSMENT", details, timestamp(row, ["Assessed At", "Assessment At", "Created At"]), "Credit Assessment", index));
  });

  rowsForLead(sources.lmsQueue, leadId).forEach((row, index) => {
    const status = value(row, ["Queue Status", "Status"]) || "QUEUED";
    const queueId = value(row, ["Queue ID"]);
    const details = ["Internal queue", status, queueId].filter(Boolean).join(" · ");
    events.push(activityEvent(row, leadId, "INTERNAL_LMS_QUEUE", details, timestamp(row, ["Requested At", "Submitted At", "Updated At"]), "LMS Submission Queue", index));
  });

  rowsForLead(sources.lmsResults, leadId).forEach((row, index) => {
    const decision = value(row, ["Final Decision", "Decision", "Result", "Status"]) || "LMS result recorded";
    const submissionId = value(row, ["LMS Submission ID", "Submission ID"]);
    const details = [decision, submissionId && `Submission: ${submissionId}`].filter(Boolean).join(" · ");
    events.push(activityEvent(row, leadId, "LMS_RESULT", details, timestamp(row, ["Decision At", "Callback At", "Updated At", "Created At"]), "LMS Credit Result", index));
  });

  const deduped = new Map();
  for (const event of events) {
    if (isReplyLogCopyOfInbox(event, events)) continue;
    const contentKey = event.type === "document"
      ? `${event.type}|${event.leadId}|${event.documentType}|${event.fileName}|${event.at}`
      : event.type === "activity"
        ? `${event.type}|${event.leadId}|${event.category}|${String(event.text).trim().toLowerCase()}|${event.at}`
      : messageDeduplicationKey(event);
    if (!deduped.has(contentKey)) deduped.set(contentKey, event);
  }

  const order = { customer: 0, document: 1, activity: 2, ai: 3 };
  return [...deduped.values()].sort((a, b) => {
    const byTime = timeValue(a.at) - timeValue(b.at);
    if (byTime) return byTime;
    const aOrder = a.type === "document" ? order.document : a.type === "activity" ? order.activity : order[a.direction] ?? 4;
    const bOrder = b.type === "document" ? order.document : b.type === "activity" ? order.activity : order[b.direction] ?? 4;
    return aOrder - bOrder;
  });
}

export function buildDocumentChecklist(leadId, rows = []) {
  const byType = new Map();
  for (const row of rowsForLead(rows, leadId)) {
    const type = normalizedType(value(row, ["Document Type", "Detected Document Type", "Document Label"]));
    if (!type) continue;
    const at = timestamp(row, ["Received Date", "Created Date", "Timestamp"]);
    const current = byType.get(type);
    if (!current || timeValue(at) >= timeValue(current.at)) {
      byType.set(type, {
        type,
        at,
        fileName: fileName(row),
        fileUrl: value(row, ["File URL", "SharePoint URL", "Document URL"]),
        status: value(row, ["Status"]) || "RECEIVED",
        verificationStatus: value(row, ["Verification Status", "Overall Verification Status"]) || "PENDING",
      });
    }
  }
  return DOCUMENT_DEFINITIONS.map((definition) => ({ ...definition, record: byType.get(definition.type) || null }));
}

export function buildConversationSummaries(leads = [], sources = {}) {
  const conversationLeads = [...leads];
  const knownLeadIds = new Set(conversationLeads.map((lead) => String(lead?.id || "").trim()).filter(Boolean));
  for (const rows of Object.values(sources)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const id = conversationIdentity(row);
      if (!id || knownLeadIds.has(id)) continue;
      conversationLeads.push({
        id,
        name: value(row, ["Customer Name", "Full Name", "Name"]) || "WhatsApp User",
        phone: value(row, ["Phone Number", "WhatsApp Number", "Customer Phone", "Phone"]),
        branch: "Not assigned",
        owner: "AI managed",
        stage: "New WhatsApp",
        score: 0,
        amount: "—",
        documentStatus: "Not Started",
        risk: "Unknown",
        aiAssessment: "No AI assessment recorded.",
        lmsStatus: "Not Submitted",
        processingRoute: "AI_DIRECT",
        caseVisibility: "REGIONAL_ADMIN_ONLY",
        escalationReason: "—",
        raw: {},
        updated: timestamp(row, ["Timestamp", "Reply Timestamp", "Received Date", "Created Date", "Last Updated"]),
        synthetic: true,
      });
      knownLeadIds.add(id);
    }
  }

  return conversationLeads.map((lead) => {
    const timeline = buildConversationTimeline(lead.id, sources);
    const checklist = buildDocumentChecklist(lead.id, sources.documents);
    const lastEvent = timeline[timeline.length - 1];
    const requiredReceived = checklist.filter((item) => item.required && item.record).length;
    return {
      lead,
      timeline,
      checklist,
      lastAt: lastEvent?.at || lead.updated || "",
      preview: lastEvent?.type === "document" ? `${lastEvent.documentType || "Document"} received` : lastEvent?.text || "No conversation activity yet",
      customerMessageCount: timeline.filter((event) => event.type === "message" && event.direction === "customer").length,
      aiMessageCount: timeline.filter((event) => event.type === "message" && event.direction === "ai").length,
      documentCount: timeline.filter((event) => event.type === "document").length,
      requiredReceived,
      requiredTotal: DOCUMENT_DEFINITIONS.filter((item) => item.required).length,
    };
  }).sort((a, b) => timeValue(b.lastAt) - timeValue(a.lastAt));
}

export function buildConversationRows(leads = [], sources = {}) {
  return buildConversationSummaries(leads, sources)
    .flatMap((summary) =>
      summary.timeline
        .filter((event) => event.type === "message")
        .map((event) => ({
          "Lead ID": summary.lead.id,
          "Lead Name": summary.lead.name,
          "Phone Number": summary.lead.phone,
          Direction: event.direction === "customer" ? "CUSTOMER" : "OUTBOUND",
          Message: event.text,
          Source: event.source,
          Timestamp: event.at,
          Status: event.status || (event.direction === "customer" ? "RECEIVED" : "RECORDED"),
        })),
    )
    .sort((a, b) => timeValue(b.Timestamp) - timeValue(a.Timestamp));
}
