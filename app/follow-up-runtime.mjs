const clean = (value) => String(value || "").trim();
const upper = (value) => clean(value).toUpperCase().replace(/[\s-]+/g, "_");
const phoneKey = (value) => clean(value).replace(/\D/g, "").replace(/^0/, "60");

export const TERMINAL_FOLLOW_UP_STATES = Object.freeze([
  "CANCELLED", "CLOSED", "COMPLETED", "DECLINED", "DOCUMENTS_RECEIVED",
  "LMS_STARTED", "OPTED_OUT", "PAUSED", "RESOLVED", "SKIPPED",
]);

export const DELIVERY_RANK = Object.freeze({
  QUEUED: 0,
  ACCEPTED: 1,
  SENT: 2,
  DELIVERED: 3,
  READ: 4,
  FAILED: 5,
});

export function reminderStage(row = {}, settings = {}) {
  const count = Number(row["Reminder Count"] || row["Follow Up Count"] || 0);
  const maxCount = Math.min(4, Number(settings.maxCount || 4));
  if (!Number.isSafeInteger(count) || count < 0 || count >= maxCount) return null;
  return ["REMINDER_1", "REMINDER_2", "REMINDER_3", "FINAL"][count] || null;
}

export function followUpStopReason({ lead = {}, conversation = {}, outbox = [], settings = {} } = {}) {
  if (!settings.enabled) return "ENGINE_OFF";
  const status = upper(conversation["AI Status"] || lead["AI Status"] || lead.Status);
  if (status.startsWith("PAUSED") || status === "HUMAN_TAKEOVER") return "MANUAL_TAKEOVER";
  if (TERMINAL_FOLLOW_UP_STATES.includes(status)) return status;
  const lms = upper(lead["LMS Status"] || lead["External LMS Submission"] || conversation["LMS Status"]);
  if (lms && !["NO", "NOT_STARTED", "PENDING", ""].includes(lms)) return "LMS_STARTED";
  const outcome = upper(lead.Outcome || conversation.Outcome);
  if (["DECLINED", "DOCUMENTS_RECEIVED", "CLOSED", "OPTED_OUT"].includes(outcome)) return outcome;
  if (settings.stopOnOptOut !== false && /\b(STOP|UNSUBSCRIBE|OPT[ _-]?OUT|JANGAN|TAK MAHU|TIDAK MAHU)\b/i.test(clean(conversation["Last Customer Reply"]))) return "OPTED_OUT";
  const lastReply = Date.parse(clean(conversation["Last Customer Reply At"] || conversation["Customer Reply At"]));
  const lastReminder = Date.parse(clean(lead["Last AI Message Time"] || lead["Last Reminder At"]));
  if (settings.stopOnReply !== false && Number.isFinite(lastReply) && (!Number.isFinite(lastReminder) || lastReply > lastReminder)) return "CUSTOMER_REPLIED";
  const complete = upper(lead["Document Status"] || conversation["Document Status"]);
  if (["COMPLETE", "COMPLETED", "VERIFIED", "ALL_RECEIVED"].includes(complete)) return "DOCUMENTS_RECEIVED";
  const pending = outbox.some((row) =>
    ["PENDING", "QUEUED", "PROCESSING"].includes(upper(row["Send Status"])) &&
    ["S09", "FOLLOW_UP"].includes(upper(row.Source)) &&
    ((lead["Lead ID"] && clean(row["Lead ID"]) === clean(lead["Lead ID"])) ||
      (phoneKey(lead["Phone Number"]) && phoneKey(row["Phone Number"]) === phoneKey(lead["Phone Number"])))
  );
  if (pending) return "ALREADY_QUEUED";
  return "";
}

export function evaluateFollowUpCandidate({ lead = {}, conversation = {}, outbox = [], settings = {}, now = Date.now() } = {}) {
  const stopReason = followUpStopReason({ lead, conversation, outbox, settings });
  if (stopReason) return { eligible: false, stopReason, stage: null, dueAt: "" };
  const stage = reminderStage(lead, settings);
  if (!stage) return { eligible: false, stopReason: "MAX_REMINDERS_REACHED", stage: null, dueAt: "" };
  const delays = [settings.firstMinutes, settings.secondMinutes, settings.thirdMinutes, settings.finalMinutes].map(Number);
  const base = Date.parse(clean(conversation["Last Updated"] || lead["Last AI Message Time"] || lead["Created Date"]));
  if (!Number.isFinite(base) || !Number.isFinite(delays[Number(lead["Reminder Count"] || 0)]))
    return { eligible: false, stopReason: "MISSING_SCHEDULE_DATA", stage, dueAt: "" };
  const due = base + delays[Number(lead["Reminder Count"] || 0)] * 60_000;
  return { eligible: due <= now, stopReason: due <= now ? "" : "NOT_DUE", stage, dueAt: new Date(due).toISOString() };
}

export function deliveryTransition(currentInput, incomingInput) {
  const current = upper(currentInput || "QUEUED");
  const incoming = upper(incomingInput);
  if (!(incoming in DELIVERY_RANK)) return current;
  if (current === "FAILED" && ["QUEUED", "ACCEPTED"].includes(incoming)) return incoming;
  return (DELIVERY_RANK[incoming] || 0) >= (DELIVERY_RANK[current] || 0) ? incoming : current;
}

export function retryDecision(row = {}, now = Date.now()) {
  const attempts = Number(row["Retry Count"] || 0);
  const status = upper(row["Delivery Status"] || row["Send Status"]);
  if (!/FAILED|ERROR|REJECTED|UNDELIVER/.test(status)) return { retry: false, escalate: false, dueAt: "" };
  if (attempts >= 3) return { retry: false, escalate: true, dueAt: "" };
  const delayMinutes = [5, 30, 120][Math.max(0, attempts)] || 120;
  return { retry: true, escalate: false, dueAt: new Date(now + delayMinutes * 60_000).toISOString(), nextRetryCount: attempts + 1 };
}

export function deliveryOutcomeMetrics(rows = []) {
  const statuses = rows.map((row) => upper(row["Delivery Status"] || row["Send Status"]));
  const sent = statuses.filter((status) => ["SENT", "DELIVERED", "READ"].includes(status)).length;
  const delivered = statuses.filter((status) => ["DELIVERED", "READ"].includes(status)).length;
  const read = statuses.filter((status) => status === "READ").length;
  const replied = rows.filter((row) => Boolean(clean(row["Customer Reply At"] || row["Replied At"]))).length;
  const recovered = rows.filter((row) => ["DOCUMENTS_RECEIVED", "COMPLETED", "LMS_STARTED"].includes(upper(row.Outcome || row.Status))).length;
  return { sent, delivered, read, replied, recovered, failed: statuses.filter((status) => status === "FAILED").length };
}
