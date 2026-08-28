export const FOLLOW_UP_ACTIONS = Object.freeze([
  "QUEUE_NOW",
  "PAUSE",
  "RESUME",
  "SKIP",
  "RESCHEDULE",
  "OUTCOME",
  "ASSIGN",
  "RETRY",
]);

const clean = (value) => String(value || "").trim();
const upper = (value) => clean(value).toUpperCase().replace(/[\s-]+/g, "_");

export function followUpPriority(row = {}, now = Date.now()) {
  const explicit = upper(row.Priority || row["Follow Up Priority"]);
  if (["URGENT", "HIGH", "NORMAL", "LOW"].includes(explicit)) return explicit;
  const due = Date.parse(clean(row["Due At"] || row["Scheduled At"]));
  if (Number.isFinite(due) && due <= now) return "URGENT";
  const stage = upper(row["Reminder Stage"] || row["Last AI Message Type"]);
  if (stage.includes("FINAL") || stage.includes("4")) return "HIGH";
  return "NORMAL";
}

export function validateFollowUpAction(input = {}, now = Date.now()) {
  const action = upper(input.action);
  const leadId = clean(input.leadId);
  const phone = clean(input.phone).replace(/[^\d+]/g, "");
  const errors = [];
  if (!FOLLOW_UP_ACTIONS.includes(action)) errors.push("Unsupported follow-up action.");
  if (!leadId && !phone) errors.push("A Lead ID or phone number is required.");
  if (action === "RESCHEDULE") {
    const due = Date.parse(clean(input.dueAt));
    if (!Number.isFinite(due) || due <= now)
      errors.push("The rescheduled time must be a valid future date and time.");
  }
  if (action === "OUTCOME" && !clean(input.outcome))
    errors.push("A follow-up outcome is required.");
  if (action === "ASSIGN" && !clean(input.assignedTo))
    errors.push("An assignee is required.");
  return {
    valid: errors.length === 0,
    errors,
    value: {
      action,
      leadId,
      phone,
      dueAt: clean(input.dueAt),
      outcome: clean(input.outcome),
      assignedTo: clean(input.assignedTo),
      note: clean(input.note).slice(0, 500),
    },
  };
}

export function followUpPatch(actionInput, current = {}, now = new Date().toISOString()) {
  const action = actionInput.action;
  const patch = {
    "Lead ID": actionInput.leadId || clean(current["Lead ID"]),
    "Phone Number": actionInput.phone || clean(current["Phone Number"]),
    "Last Action": action,
    "Last Action At": now,
    "Last Action Note": actionInput.note,
    "Updated At": now,
  };
  if (action === "QUEUE_NOW") Object.assign(patch, { Status: "READY", "Due At": now, "Next Action": "Send follow-up when S09 is enabled", Priority: "URGENT" });
  if (action === "PAUSE") Object.assign(patch, { Status: "PAUSED", "AI Status": "PAUSED", "Next Action": "Paused by staff" });
  if (action === "RESUME") Object.assign(patch, { Status: "READY", "AI Status": "ACTIVE", "Next Action": "Resume follow-up sequence" });
  if (action === "SKIP") Object.assign(patch, { Status: "SKIPPED", "Next Action": "Wait for next configured reminder" });
  if (action === "RESCHEDULE") Object.assign(patch, { Status: "SCHEDULED", "Due At": actionInput.dueAt, "Scheduled At": actionInput.dueAt, "Next Action": "Scheduled follow-up" });
  if (action === "OUTCOME") Object.assign(patch, { Status: upper(actionInput.outcome), Outcome: actionInput.outcome, "Next Action": actionInput.note || actionInput.outcome });
  if (action === "ASSIGN") Object.assign(patch, { "Assigned To": actionInput.assignedTo, Status: clean(current.Status) || "OPEN" });
  if (action === "RETRY") Object.assign(patch, { Status: "READY", "Delivery Status": "RETRY", "Due At": now, "Next Action": "Retry failed follow-up when S09 is enabled", Priority: "URGENT" });
  return patch;
}

export function followUpMetrics(rows = [], now = Date.now()) {
  const active = rows.filter((row) => !["RESOLVED", "CLOSED", "COMPLETED", "CANCELLED"].includes(upper(row.Status)));
  return {
    total: active.length,
    dueNow: active.filter((row) => {
      const due = Date.parse(clean(row["Due At"] || row["Scheduled At"]));
      return Number.isFinite(due) && due <= now;
    }).length,
    paused: active.filter((row) => upper(row.Status) === "PAUSED" || upper(row["AI Status"]) === "PAUSED").length,
    failed: active.filter((row) => /FAILED|ERROR|REJECTED|UNDELIVER/.test(upper(row["Delivery Status"] || row.Status))).length,
    finalStage: active.filter((row) => /FINAL|REMINDER_4/.test(upper(row["Reminder Stage"] || row["Last AI Message Type"]))).length,
  };
}
