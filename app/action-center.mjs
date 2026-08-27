import { buildPostApprovalCases } from "./post-approval.mjs";
import { evaluateCreditBureauConsent } from "./credit-bureau-consent.mjs";

function normalized(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

function activeOperationalRow(row) {
  const status = normalized(
    row?.Status || row?.["Queue Status"] || row?.["Escalation Status"],
  );
  return ![
    "RESOLVED",
    "CLOSED",
    "COMPLETED",
    "CANCELLED",
    "CANCELED",
    "INACTIVE",
  ].includes(status);
}

function linkedRows(rows, leadIds) {
  return (rows || []).filter((row) => {
    const leadId = String(row?.["Lead ID"] || "").trim();
    return leadId && leadIds.has(leadId);
  });
}

function firstTimestamp(row) {
  for (const key of [
    "Assessed At",
    "Assessment At",
    "Updated At",
    "Created At",
    "Timestamp",
  ]) {
    const parsed = Date.parse(String(row?.[key] || ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function latestByLead(rows) {
  const latest = new Map();
  for (const row of rows || []) {
    const leadId = String(row?.["Lead ID"] || "").trim();
    if (!leadId) continue;
    const existing = latest.get(leadId);
    if (!existing || firstTimestamp(row) >= firstTimestamp(existing))
      latest.set(leadId, row);
  }
  return [...latest.values()];
}

function isManualReview(row) {
  const stage = normalized(row?.["Current Stage"] || row?.["Lead Status"]);
  const required = normalized(row?.["Manual Review Required"]);
  return (
    stage.includes("MANUAL_REVIEW") ||
    ["YES", "TRUE", "REQUIRED", "MANUAL_REVIEW"].includes(required)
  );
}

function needsDocuments(row) {
  const stage = normalized(row?.["Current Stage"] || row?.["Lead Status"]);
  const status = normalized(row?.["Document Status"]);
  if (["REJECTED", "DECLINED", "CLOSED", "COMPLETED"].includes(stage))
    return false;
  return (
    stage.includes("DOCUMENT") ||
    !status ||
    [
      "NOT_STARTED",
      "PENDING",
      "WAITING",
      "MISSING",
      "IN_PROGRESS",
      "RE_UPLOAD_REQUIRED",
      "RETURNED_FOR_DOCUMENTS",
    ].some((value) => status.includes(value))
  );
}

function hasDataQualityGap(row) {
  const route = String(row?.["Processing Route"] || "").trim();
  const risk = String(row?.["Risk Level"] || "").trim();
  const priority = String(
    row?.["Follow Up Priority"] || row?.["Queue Priority"] || row?.Priority || "",
  ).trim();
  return !route || !risk || !priority;
}

/** @typedef {Record<string, string>} SheetRow */

/**
 * Builds the role-scoped daily action list. The API has already applied the
 * case visibility boundary; this function additionally links operational rows
 * to the currently selected branch/date lead set.
 * @param {{
 *   leads?: SheetRow[],
 *   data?: Record<string, SheetRow[]>,
 *   role?: string,
 *   connected?: boolean,
 *   stale?: boolean
 * }} input
 */
export function buildActionCenter({
  leads = [],
  data = {},
  role = "staff",
  connected = true,
  stale = false,
}) {
  const management = ["admin", "regional_manager"].includes(role);
  const leadIds = new Set(
    leads.map((row) => String(row?.["Lead ID"] || "").trim()).filter(Boolean),
  );
  const assessments = latestByLead(
    linkedRows(data.Credit_Assessment, leadIds),
  );
  const consentActionIds = new Set(
    assessments
      .filter(
        (row) =>
          normalized(row?.["Assessment Status"]) === "ELIGIBLE_FOR_LMS" &&
          ["YES", "TRUE", "ELIGIBLE"].includes(
            normalized(row?.["LMS Submission Eligibility"]),
          ),
      )
      .filter(
        (row) =>
          !evaluateCreditBureauConsent(
            row["Lead ID"],
            data.Document_Received_Log || [],
          ).eligible,
      )
      .map((row) => String(row?.["Lead ID"] || "").trim())
      .filter(Boolean),
  );
  const manualReviewIds = new Set(
    [...leads, ...assessments]
      .filter(isManualReview)
      .map((row) => String(row?.["Lead ID"] || "").trim())
      .filter(Boolean),
  );
  const documentIds = new Set(
    leads
      .filter(needsDocuments)
      .map((row) => String(row?.["Lead ID"] || "").trim())
      .filter(Boolean),
  );
  const queueFollowUps = linkedRows(data.Follow_Up_Queue, leadIds).filter(
    activeOperationalRow,
  );
  const queuedFollowUpLeadIds = new Set(
    queueFollowUps
      .map((row) => String(row?.["Lead ID"] || "").trim())
      .filter(Boolean),
  );
  const stateFollowUps = linkedRows(data.Conversation_State, leadIds).filter(
    (row) =>
      String(row?.["Next Action"] || "").trim() &&
      !queuedFollowUpLeadIds.has(String(row?.["Lead ID"] || "").trim()) &&
      activeOperationalRow(row),
  );
  const followUps = [...queueFollowUps, ...stateFollowUps];
  const escalations = linkedRows(data.Escalation_Log, leadIds).filter(
    activeOperationalRow,
  );
  const queue = linkedRows(data.LMS_Submission_Queue, leadIds);
  const failedQueue = queue.filter((row) =>
    ["FAILED", "ERROR", "RETRY", "RETRYING"].includes(
      normalized(row?.["Queue Status"] || row?.Status),
    ),
  );
  const queued = queue.filter(
    (row) => normalized(row?.["Queue Status"] || row?.Status) === "QUEUED",
  );
  const qualityGapIds = new Set(
    leads
      .filter(hasDataQualityGap)
      .map((row) => String(row?.["Lead ID"] || "").trim())
      .filter(Boolean),
  );
  const pendingFulfilment = buildPostApprovalCases({
    leads,
    lmsResults: linkedRows(data.LMS_Credit_Result, leadIds),
    activities: linkedRows(data.Lead_Activities, leadIds),
  }).filter((item) => !item.disbursed);
  const activePolicies = management
    ? (data.Product_Credit_Policy || []).filter(
        (row) => normalized(row?.Status) === "ACTIVE",
      ).length
    : null;

  const alerts = [];
  if (!connected || stale)
    alerts.push({
      id: "connection",
      severity: "critical",
      count: 1,
      title: stale ? "Live CRM data is stale" : "CRM data connection is down",
      description: stale
        ? "The screen is using a cached snapshot. Do not treat it as the latest operational state."
        : "Google Sheets data is unavailable. Customer records are fail-closed.",
      target: "Dashboard",
    });
  if (management && activePolicies === 0)
    alerts.push({
      id: "policy",
      severity: "critical",
      count: 1,
      title: "No ACTIVE lending policy",
      description:
        "V1-SHADOW is preserved, but no case can become production credit-ready until management publishes approved thresholds.",
      target: "Credit Policy",
    });
  if (failedQueue.length)
    alerts.push({
      id: "lms-failed",
      severity: "critical",
      count: failedQueue.length,
      title: "Internal LMS queue failures",
      description:
        "These are internal queue failures only; they are not completed external LMS submissions.",
      target: "LMS Status",
    });
  if (manualReviewIds.size)
    alerts.push({
      id: "manual-review",
      severity: "warning",
      count: manualReviewIds.size,
      title: "Cases require manual review",
      description:
        "AI-unresolved or exception cases need an authorised reviewer. AI-direct cases remain protected from branch action.",
      target: "Work Queue",
    });
  if (escalations.length)
    alerts.push({
      id: "escalations",
      severity: "warning",
      count: escalations.length,
      title: "Open escalations",
      description: "Operational exceptions are still unresolved.",
      target: "Work Queue",
    });
  if (followUps.length)
    alerts.push({
      id: "follow-ups",
      severity: "warning",
      count: followUps.length,
      title: "Follow-ups pending",
      description: "Customer qualification or document actions remain open.",
      target: "Work Queue",
    });
  if (consentActionIds.size)
    alerts.push({
      id: "credit-bureau-consent",
      severity: "warning",
      count: consentActionIds.size,
      title: "CTOS / CCRIS consent action required",
      description:
        "Pre-LMS eligible cases still need a signed and verified V4.0-01112020 consent letter before LMS Queue entry.",
      target: "Applications",
    });
  if (pendingFulfilment.length)
    alerts.push({
      id: "post-approval",
      severity: "warning",
      count: pendingFulfilment.length,
      title: "Post-approval fulfilment pending",
      description:
        "Officially approved cases still require agreement, Direct Debit or disbursement completion.",
      target: "Post-Approval",
    });
  if (documentIds.size)
    alerts.push({
      id: "documents",
      severity: "info",
      count: documentIds.size,
      title: "Document collection incomplete",
      description: "Required files are missing, pending, or need re-upload.",
      target: "Work Queue",
    });
  if (management && queued.length)
    alerts.push({
      id: "lms-queued",
      severity: "info",
      count: queued.length,
      title: "Cases waiting in the internal LMS queue",
      description:
        "The official LMS API is not connected, so these rows have not been submitted externally.",
      target: "LMS Status",
    });
  if (qualityGapIds.size)
    alerts.push({
      id: "data-quality",
      severity: "info",
      count: qualityGapIds.size,
      title: "Reporting fields are incomplete",
      description:
        "Processing route, risk, or priority is missing. This is why some management report breakdowns show Unknown.",
      target: "Leads",
    });

  const severityOrder = { critical: 0, warning: 1, info: 2 };
  alerts.sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity],
  );
  return {
    alerts,
    totalActions: alerts.reduce((total, alert) => total + alert.count, 0),
    summary: {
      critical: alerts
        .filter((alert) => alert.severity === "critical")
        .reduce((total, alert) => total + alert.count, 0),
      warning: alerts
        .filter((alert) => alert.severity === "warning")
        .reduce((total, alert) => total + alert.count, 0),
      info: alerts
        .filter((alert) => alert.severity === "info")
        .reduce((total, alert) => total + alert.count, 0),
    },
    readiness: {
      connection: !connected ? "UNAVAILABLE" : stale ? "STALE" : "LIVE",
      activePolicies,
      lmsIntegration: "CONTRACT_REQUIRED",
      whatsapp: "AUTOMATION_LIVE",
    },
  };
}
