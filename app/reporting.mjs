import { inferProcessingRoute } from "./access-control.mjs";

const FINAL_STAGES = new Set([
  "DISBURSED",
  "COMPLETED",
  "REJECTED",
  "DECLINED",
  "CANCELLED",
  "CANCELED",
]);

const QUALIFIED_STAGES = new Set([
  "QUALIFIED",
  "QUALIFICATION_COMPLETED",
  "QUALIFICATION_COMPLETE",
  "DOCUMENT_COLLECTION",
  "DOCUMENT_VERIFICATION",
  "SUBMITTED_FOR_VERIFICATION",
  "VERIFICATION_APPROVED",
  "CREDIT_ASSESSMENT",
  "READY_FOR_LMS",
  "LMS_QUEUE",
  "LMS_SUBMISSION_QUEUE",
  "LMS_SUBMITTED",
  "APPROVED",
  "DISBURSED",
  "COMPLETED",
]);

const DOCUMENT_COMPLETE_STAGES = new Set([
  "VERIFICATION_APPROVED",
  "CREDIT_ASSESSMENT",
  "READY_FOR_LMS",
  "LMS_QUEUE",
  "LMS_SUBMISSION_QUEUE",
  "LMS_SUBMITTED",
  "APPROVED",
  "DISBURSED",
  "COMPLETED",
]);

const DATE_KEYS = [
  "Created Date",
  "Created At",
  "Timestamp",
  "Received Date",
  "Received At",
  "Sent Date",
  "Sent At",
  "Scheduled Time",
  "Verification Date",
  "Verified At",
  "Requested At",
  "Submitted At",
  "Assessment At",
  "Assessment Timestamp",
  "Decision At",
  "Updated At",
  "Last Updated",
  "Last AI Update",
];

function normalized(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

function rowStage(row) {
  return normalized(row?.["Current Stage"] || row?.["Lead Status"]);
}

function parseNumber(value) {
  const cleaned = String(value ?? "").replace(/[^0-9.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function average(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  return usable.length
    ? usable.reduce((total, value) => total + value, 0) / usable.length
    : 0;
}

function percent(numerator, denominator) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

function firstTimestamp(row, keys = DATE_KEYS) {
  for (const key of keys) {
    const value = String(row?.[key] || "").trim();
    if (!value) continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

const malaysiaDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kuala_Lumpur",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const malaysiaLabelFormatter = new Intl.DateTimeFormat("en-MY", {
  timeZone: "Asia/Kuala_Lumpur",
  day: "2-digit",
  month: "short",
});

function malaysiaDayKey(timestamp) {
  return malaysiaDateFormatter.format(new Date(timestamp));
}

function leadPhone(row) {
  return String(
    row?.["Phone Number"] ||
      row?.["Customer Phone"] ||
      row?.["WhatsApp Number"] ||
      row?.From ||
      "",
  )
    .replace(/\D/g, "")
    .trim();
}

function linkedRows(data, tab, leadIds, phones) {
  return (data?.[tab] || []).filter((row) => {
    const leadId = String(row?.["Lead ID"] || "").trim();
    if (leadId) return leadIds.has(leadId);
    const phone = leadPhone(row);
    return phone ? phones.has(phone) : false;
  });
}

function isQualified(row) {
  return QUALIFIED_STAGES.has(rowStage(row));
}

function isDocumentComplete(row) {
  const documentStatus = normalized(row?.["Document Status"]);
  return (
    ["COMPLETE", "COMPLETED", "VERIFIED"].includes(documentStatus) ||
    DOCUMENT_COMPLETE_STAGES.has(rowStage(row))
  );
}

function isRejected(row) {
  const stage = rowStage(row);
  const lmsStatus = normalized(row?.["LMS Status"]);
  return ["REJECTED", "DECLINED"].includes(stage) ||
    ["REJECTED", "DECLINED"].includes(lmsStatus);
}

function isManualReview(row) {
  const stage = rowStage(row);
  return (
    stage === "MANUAL_REVIEW" ||
    normalized(row?.["Document Status"]).includes("REVIEW") ||
    ["YES", "TRUE", "REQUIRED"].includes(
      normalized(row?.["Manual Review Required"]),
    )
  );
}

function isCreditReady(row) {
  return [
    "READY_FOR_LMS",
    "LMS_QUEUE",
    "LMS_SUBMISSION_QUEUE",
    "LMS_SUBMITTED",
    "APPROVED",
    "DISBURSED",
    "COMPLETED",
  ].includes(rowStage(row));
}

function assessmentEligible(row) {
  if (normalized(row?.["Assessment Mode"]) !== "ACTIVE") return false;
  const value = normalized(
    row?.["LMS Eligibility"] ||
      row?.["Eligibility"] ||
      row?.["Assessment Result"] ||
      row?.["Decision"],
  );
  return ["ELIGIBLE", "AUTO_LMS_READY", "READY_FOR_LMS", "PASS"].includes(
    value,
  );
}

function latestRowsByLead(rows) {
  const latest = new Map();
  rows.forEach((row, index) => {
    const key = String(row?.["Lead ID"] || "").trim() || leadPhone(row);
    if (!key) return;
    const timestamp = firstTimestamp(row);
    const current = latest.get(key);
    if (
      !current ||
      (timestamp !== null &&
        (current.timestamp === null || timestamp >= current.timestamp)) ||
      (timestamp === current.timestamp && index > current.index)
    )
      latest.set(key, { row, timestamp, index });
  });
  return [...latest.values()].map((entry) => entry.row);
}

function queueExternallySubmitted(row) {
  return Boolean(
    String(row?.["Submitted At"] || "").trim() ||
      String(row?.["LMS Submission ID"] || "").trim(),
  );
}

function lmsApproved(row) {
  return normalized(
    row?.["Final Decision"] || row?.Decision || row?.Status || row?.Result,
  ) === "APPROVED";
}

function activeOperationalRow(row) {
  const status = normalized(
    row?.Status || row?.["Queue Status"] || row?.["Escalation Status"],
  );
  return ![
    "COMPLETED",
    "CLOSED",
    "CANCELLED",
    "CANCELED",
    "RESOLVED",
    "SENT",
  ].includes(status);
}

function distribution(values, fallback = "Unknown") {
  const counts = new Map();
  for (const value of values) {
    const label = String(value || fallback).trim() || fallback;
    const display = label
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
    counts.set(display, (counts.get(display) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function uniqueLeadCount(rows) {
  const ids = new Set(
    rows.map((row) => String(row?.["Lead ID"] || "").trim()).filter(Boolean),
  );
  return ids.size || rows.length;
}

function groupPerformance(leads, keyGetter) {
  const groups = new Map();
  for (const row of leads) {
    const key = String(keyGetter(row) || "Unassigned").trim() || "Unassigned";
    const rows = groups.get(key) || [];
    rows.push(row);
    groups.set(key, rows);
  }
  return [...groups.entries()]
    .map(([name, rows]) => {
      const qualified = rows.filter(isQualified).length;
      const documentsComplete = rows.filter(isDocumentComplete).length;
      const creditReady = rows.filter(isCreditReady).length;
      return {
        name,
        leads: rows.length,
        qualified,
        documentsComplete,
        creditReady,
        conversionRate: percent(qualified, rows.length),
      };
    })
    .sort(
      (a, b) =>
        b.creditReady - a.creditReady ||
        b.qualified - a.qualified ||
        b.leads - a.leads ||
        a.name.localeCompare(b.name),
    );
}

function sevenDayTrend(leads, now) {
  const counts = new Map();
  for (const row of leads) {
    const timestamp = firstTimestamp(row, ["Created Date", "Created At"]);
    if (timestamp === null) continue;
    const key = malaysiaDayKey(timestamp);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from({ length: 7 }, (_, index) => {
    const timestamp = now.getTime() - (6 - index) * 24 * 60 * 60 * 1000;
    const key = malaysiaDayKey(timestamp);
    return {
      key,
      label: malaysiaLabelFormatter.format(new Date(timestamp)),
      count: counts.get(key) || 0,
    };
  });
}

/**
 * @param {{
 *   leads?: Array<Record<string, string>>,
 *   data?: Record<string, Array<Record<string, string>>>,
 *   now?: Date
 * }} input
 */
export function buildManagementReport({ leads = [], data = {}, now = new Date() }) {
  const leadIds = new Set(
    leads.map((row) => String(row?.["Lead ID"] || "").trim()).filter(Boolean),
  );
  const phones = new Set(leads.map(leadPhone).filter(Boolean));
  const assessments = linkedRows(data, "Credit_Assessment", leadIds, phones);
  const queue = linkedRows(data, "LMS_Submission_Queue", leadIds, phones);
  const lmsResults = latestRowsByLead(
    linkedRows(data, "LMS_Credit_Result", leadIds, phones),
  );
  const documents = linkedRows(data, "Document_Received_Log", leadIds, phones);
  const verification = linkedRows(
    data,
    "Document_Verification_Log",
    leadIds,
    phones,
  );
  const followUps = linkedRows(data, "Follow_Up_Queue", leadIds, phones).filter(
    activeOperationalRow,
  );
  const escalations = linkedRows(data, "Escalation_Log", leadIds, phones).filter(
    activeOperationalRow,
  );
  const inbound = linkedRows(data, "Customer_Inbox", leadIds, phones);
  const outbound = linkedRows(data, "Message_Outbox", leadIds, phones);

  const totalLeads = leads.length;
  const todayKey = malaysiaDayKey(now.getTime());
  const todayLeads = leads.filter((row) => {
    const timestamp = firstTimestamp(row, ["Created Date", "Created At"]);
    return timestamp !== null && malaysiaDayKey(timestamp) === todayKey;
  }).length;
  const qualified = leads.filter(isQualified).length;
  const documentsComplete = leads.filter(isDocumentComplete).length;
  const documentsPending = leads.filter(
    (row) => !isDocumentComplete(row) && !isRejected(row),
  ).length;
  const rejected = leads.filter(isRejected).length;
  const latestAssessments = latestRowsByLead(assessments);
  const assessmentByLead = new Map(
    latestAssessments
      .map((row) => [String(row?.["Lead ID"] || "").trim(), row])
      .filter(([leadId]) => leadId),
  );
  const manualReviewIds = new Set(
    leads.filter(isManualReview).map((row) => row["Lead ID"]).filter(Boolean),
  );
  for (const row of latestAssessments) {
    if (
      ["YES", "TRUE", "REQUIRED"].includes(
        normalized(row?.["Manual Review Required"]),
      ) &&
      row["Lead ID"]
    )
      manualReviewIds.add(row["Lead ID"]);
  }
  const creditReadyIds = new Set();
  for (const lead of leads) {
    const leadId = String(lead?.["Lead ID"] || "").trim();
    if (!leadId) continue;
    const latestAssessment = assessmentByLead.get(leadId);
    if (
      latestAssessment
        ? assessmentEligible(latestAssessment)
        : isCreditReady(lead)
    )
      creditReadyIds.add(leadId);
  }
  const externallySubmittedRows = queue.filter(queueExternallySubmitted);
  const approvedResults = lmsResults.filter(lmsApproved);
  const lmsDecisionRows = lmsResults.filter((row) =>
    String(
      row?.["Final Decision"] || row?.Decision || row?.Status || row?.Result || "",
    ).trim(),
  );
  const disbursed = leads.filter((row) => rowStage(row) === "DISBURSED").length;
  const activeProcessing = leads.filter(
    (row) => !FINAL_STAGES.has(rowStage(row)),
  ).length;

  const todayMessages = [...inbound, ...outbound].filter((row) => {
    const timestamp = firstTimestamp(row);
    return timestamp !== null && malaysiaDayKey(timestamp) === todayKey;
  }).length;
  const todayDocuments = documents.filter((row) => {
    const timestamp = firstTimestamp(row);
    return timestamp !== null && malaysiaDayKey(timestamp) === todayKey;
  }).length;

  const processingDays = leads
    .map((row) => {
      const created = firstTimestamp(row, ["Created Date", "Created At"]);
      if (created === null) return null;
      const updated = firstTimestamp(row, [
        "Last AI Update",
        "Last Updated",
        "Updated At",
      ]);
      const end = FINAL_STAGES.has(rowStage(row)) && updated && updated >= created
        ? updated
        : now.getTime();
      return Math.max(0, (end - created) / (24 * 60 * 60 * 1000));
    })
    .filter((value) => value !== null);

  const scoreValues = leads
    .map((row) => parseNumber(row?.["Lead Score"]))
    .filter((value) => value !== null);
  const confidenceValues = leads
    .map((row) => parseNumber(row?.["AI Confidence"]))
    .filter((value) => value !== null);
  const loanValues = leads
    .map((row) => parseNumber(row?.["Loan Amount Requested"]))
    .filter((value) => value !== null);
  const incomeValues = leads
    .map((row) => parseNumber(row?.["Monthly Income"]))
    .filter((value) => value !== null);

  return {
    overview: {
      totalLeads,
      todayLeads,
      qualified,
      documentsComplete,
      documentsPending,
      rejected,
      manualReview: manualReviewIds.size,
      creditReady: creditReadyIds.size,
      internalQueue: uniqueLeadCount(queue),
      externallySubmitted: uniqueLeadCount(externallySubmittedRows),
      lmsApproved: uniqueLeadCount(approvedResults),
      disbursed,
      activeProcessing,
    },
    conversion: {
      qualificationRate: percent(qualified, totalLeads),
      documentCompletionRate: percent(documentsComplete, totalLeads),
      creditReadyRate: percent(creditReadyIds.size, totalLeads),
      externalApprovalRate: percent(
        uniqueLeadCount(approvedResults),
        uniqueLeadCount(lmsDecisionRows),
      ),
      externalDecisionCount: uniqueLeadCount(lmsDecisionRows),
    },
    averages: {
      leadScore: average(scoreValues),
      aiConfidence: average(confidenceValues),
      loanAmount: average(loanValues),
      monthlyIncome: average(incomeValues),
      processingDays: average(processingDays),
    },
    operations: {
      followUps: followUps.length,
      escalations: escalations.length,
      documentsReceived: documents.length,
      verifiedDocuments: verification.filter((row) =>
        ["VERIFIED", "PASSED", "PASS", "ACCEPTED", "VALID"].includes(
          normalized(
            row?.["Verification Status"] ||
              row?.Status ||
              row?.["AI Verification Result"],
          ),
        ),
      ).length,
      todayMessages,
      todayDocuments,
    },
    branchPerformance: groupPerformance(
      leads,
      (row) => row?.["Branch ID"] || "Unassigned",
    ),
    staffPerformance: groupPerformance(
      leads.filter((row) => String(row?.["Assigned Sales ID"] || "").trim()),
      (row) => row?.["Assigned Sales ID"],
    ),
    sourcePerformance: groupPerformance(
      leads,
      (row) => row?.Source || row?.["Manual Source Detail"] || "Unknown",
    ),
    routeDistribution: distribution(
      leads.map((row) => inferProcessingRoute(row)),
    ),
    riskDistribution: distribution(
      leads.map((row) => row?.["Risk Level"] || "Unknown"),
    ),
    priorityDistribution: distribution(
      leads.map(
        (row) =>
          row?.["Follow Up Priority"] ||
          row?.["Queue Priority"] ||
          row?.Priority ||
          "Unknown",
      ),
    ),
    sevenDayTrend: sevenDayTrend(leads, now),
  };
}
