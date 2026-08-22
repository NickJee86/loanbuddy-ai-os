function clean(value) {
  return String(value ?? "").trim();
}

function normalized(value) {
  return clean(value).toUpperCase().replace(/[\s-]+/g, "_");
}

function leadIdOf(lead) {
  return clean(lead?.id || lead?.["Lead ID"] || lead?.raw?.["Lead ID"]);
}

function timeValue(row = {}) {
  for (const key of [
    "Decision At",
    "Callback At",
    "Submitted At",
    "Updated At",
    "Created At",
    "Requested At",
    "Timestamp",
  ]) {
    const parsed = Date.parse(clean(row?.[key]));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function hasExternalSubmissionEvidence(row = {}) {
  return Boolean(
    clean(row?.["Submitted At"]) ||
      clean(row?.["LMS Submission ID"]),
  );
}

function latestByLead(rows = []) {
  const latest = new Map();
  rows.forEach((row, index) => {
    const leadId = clean(row?.["Lead ID"]);
    if (!leadId) return;
    const current = latest.get(leadId);
    const candidate = { row, index, time: timeValue(row) };
    if (
      !current ||
      candidate.time > current.time ||
      (candidate.time === current.time && candidate.index > current.index)
    )
      latest.set(leadId, candidate);
  });
  return [...latest.values()].map((item) => item.row);
}

/**
 * @param {{leads?: any[], queueRows?: Array<Record<string, string>>, resultRows?: Array<Record<string, string>>}} input
 */
export function buildLmsStatus({
  leads = [],
  queueRows = [],
  resultRows = [],
} = {}) {
  const leadIds = new Set(leads.map(leadIdOf).filter(Boolean));
  const visibleQueueRows = queueRows.filter((row) =>
    leadIds.has(clean(row?.["Lead ID"])),
  );
  const visibleResultRows = latestByLead(
    resultRows.filter((row) => leadIds.has(clean(row?.["Lead ID"]))),
  );
  const externalSubmittedLeadIds = new Set(
    visibleQueueRows
      .filter(hasExternalSubmissionEvidence)
      .map((row) => clean(row?.["Lead ID"]))
      .filter(Boolean),
  );
  const approved = visibleResultRows.filter(
    (row) =>
      normalized(
        row?.["Final Decision"] || row?.Decision || row?.Result || row?.Status,
      ) === "APPROVED",
  ).length;
  return {
    queueRows: visibleQueueRows,
    resultRows: visibleResultRows,
    summary: {
      internalQueue: visibleQueueRows.length,
      externalSubmitted: externalSubmittedLeadIds.size,
      officialDecisions: visibleResultRows.length,
      approved,
    },
  };
}
