export function normalizedStage(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

export function pipelineBucket(value, lmsValue = "") {
  const stage = normalizedStage(value);
  const lmsStatus = normalizedStage(lmsValue);
  if (
    ["REJECTED", "DECLINED", "CANCELLED", "CANCELED", "CLOSED"].includes(
      lmsStatus || stage,
    )
  )
    return "closed";
  if (
    ["APPROVED", "DISBURSED", "COMPLETED"].includes(lmsStatus) ||
    ["APPROVED", "LMS_APPROVED", "DISBURSED", "COMPLETED"].includes(stage)
  )
    return "approved";
  if (
    [
      "READY_FOR_LMS",
      "LMS_QUEUE",
      "LMS_SUBMISSION_QUEUE",
      "LMS_SUBMITTED",
      "LMS_PROCESSING",
    ].includes(stage)
  )
    return "lms";
  if (["QUEUED", "SUBMITTED", "PROCESSING", "IN_PROGRESS"].includes(lmsStatus))
    return "lms";
  if (
    [
      "LEAD_SCORING",
      "SCORING_COMPLETED",
      "VERIFICATION_APPROVED",
      "CREDIT_ASSESSMENT",
      "CREDIT_REVIEW",
    ].includes(stage)
  )
    return "credit";
  if (
    stage.includes("DOCUMENT") ||
    ["SUBMITTED_FOR_VERIFICATION", "RETURNED_FOR_DOCUMENTS"].includes(stage)
  )
    return "documents";
  if (
    ["QUALIFIED", "QUALIFICATION_COMPLETED", "QUALIFICATION_COMPLETE"].includes(
      stage,
    )
  )
    return "qualified";
  if (
    [
      "CONTACTED",
      "AI_WELCOME",
      "QUALIFICATION",
      "QUALIFICATION_IN_PROGRESS",
      "FOLLOW_UP",
      "FOLLOWUP",
    ].includes(stage)
  )
    return "contacted";
  return "new";
}

export function pipelineCounts(leads = []) {
  const counts = {
    new: 0,
    contacted: 0,
    qualified: 0,
    documents: 0,
    credit: 0,
    lms: 0,
    approved: 0,
    closed: 0,
  };
  for (const lead of leads)
    counts[pipelineBucket(lead?.stage, lead?.lmsStatus)] += 1;
  return counts;
}

function leadTime(lead = {}) {
  const raw = lead?.raw || lead;
  for (const key of [
    "Last AI Update",
    "Last Updated",
    "Updated At",
    "Created Date",
    "Created At",
    "Timestamp",
  ]) {
    const value = key === "Last AI Update" && lead?.updated
      ? lead.updated
      : raw?.[key];
    const parsed = Date.parse(String(value || ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NEGATIVE_INFINITY;
}

export function recentLeads(leads = [], limit = 10) {
  return leads
    .map((lead, index) => ({ lead, index, timestamp: leadTime(lead) }))
    .sort((a, b) => b.timestamp - a.timestamp || a.index - b.index)
    .slice(0, Math.max(0, limit))
    .map((item) => item.lead);
}

function usableBranch(value) {
  const branch = String(value || "").trim();
  const placeholder = normalizedStage(branch);
  return branch &&
    !["NOT_ASSIGNED", "UNASSIGNED", "AI_MANAGED", "ALL", "—", "-"].includes(
      placeholder,
    )
    ? branch
    : "";
}

export function mergeBranchRows(masterRows = [], users = []) {
  const rows = [...masterRows];
  const known = new Set(
    rows
      .map((row) =>
        usableBranch(row?.["Branch ID"] || row?.["Branch Code"] || row?.Branch),
      )
      .filter(Boolean),
  );
  for (const user of users) {
    if (user?.active === false) continue;
    for (const value of user?.branchIds || []) {
      const branch = usableBranch(value);
      if (!branch || known.has(branch)) continue;
      known.add(branch);
      rows.push({ "Branch ID": branch, Active: "YES", Source: "CRM_Users" });
    }
  }
  return rows;
}

export function buildBranchOptions(
  leads = [],
  branchRows = [],
  userBranchIds = [],
) {
  const values = new Set();
  for (const row of branchRows) {
    const active = normalizedStage(row?.Active || row?.Status);
    if (["NO", "FALSE", "INACTIVE", "DISABLED", "0"].includes(active)) continue;
    const branch = usableBranch(
      row?.["Branch ID"] || row?.["Branch Code"] || row?.Branch,
    );
    if (branch) values.add(branch);
  }
  for (const branch of userBranchIds) {
    const usable = usableBranch(branch);
    if (usable) values.add(usable);
  }
  for (const lead of leads) {
    const branch = usableBranch(lead?.branch);
    if (branch) values.add(branch);
  }
  return [...values].sort((a, b) => a.localeCompare(b));
}

export function isSyntheticLead(row = {}) {
  const flag = String(
    row["Is Test Data"] || row["Test Data"] || row["Data Classification"] || "",
  )
    .trim()
    .toUpperCase();
  if (["YES", "TRUE", "TEST", "UAT", "SYNTHETIC"].includes(flag)) return true;
  const leadId = String(row["Lead ID"] || "").trim();
  const name = String(row["Lead Name"] || "").trim();
  const source = String(row.Source || row["Manual Source Detail"] || "").trim();
  return (
    /^(TEST|UAT|SYNTHETIC)[-_]/i.test(leadId) ||
    /\b(TEST|UAT|SYNTHETIC|DUMMY)\b/i.test(name) ||
    /\b(TEST|UAT|SYNTHETIC)\b/i.test(source)
  );
}

const DATE_KEYS = [
  "Last AI Update",
  "Last Updated",
  "Updated At",
  "Timestamp",
  "Received Date",
  "Verification Date",
  "Created Date",
  "Activity Date",
  "Scheduled Time",
  "Sent Date",
];

function rowTimestamp(row) {
  for (const key of DATE_KEYS) {
    const value = String(row?.[key] || "").trim();
    if (!value) continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function rangeStart(range, now) {
  if (range === "Last 30 Days") return now.getTime() - 30 * 24 * 60 * 60 * 1000;
  if (range === "This Month")
    return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  if (range === "This Quarter")
    return new Date(
      now.getFullYear(),
      Math.floor(now.getMonth() / 3) * 3,
      1,
    ).getTime();
  return null;
}

export function filterCrmDataByDate(
  data = {},
  range = "All Time",
  now = new Date(),
) {
  const start = rangeStart(range, now);
  if (start === null) return data;
  const end = now.getTime();
  return Object.fromEntries(
    Object.entries(data).map(([tab, rows]) => {
      if (tab === "Branch_Master") return [tab, rows];
      return [
        tab,
        (rows || []).filter((row) => {
          const timestamp = rowTimestamp(row);
          return timestamp === null || (timestamp >= start && timestamp <= end);
        }),
      ];
    }),
  );
}
