function clean(value) {
  return String(value ?? "").trim();
}

function normalized(value) {
  return clean(value).toUpperCase().replace(/[\s-]+/g, "_");
}

function first(record, keys) {
  for (const key of keys) {
    const value = clean(record?.[key]);
    if (value) return value;
  }
  return "";
}

function timeValue(row = {}) {
  for (const key of [
    "Decision At",
    "Callback At",
    "Updated At",
    "Created At",
    "Created Date",
    "Timestamp",
  ]) {
    const value = Date.parse(clean(row[key]));
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

export function latestLmsResult(rows = [], leadId = "") {
  return rows
    .filter((row) => clean(row?.["Lead ID"]) === clean(leadId))
    .map((row, index) => ({ row, index }))
    .sort((a, b) => timeValue(a.row) - timeValue(b.row) || a.index - b.index)
    .at(-1)?.row;
}

function isComplete(value, completedValues) {
  return completedValues.includes(normalized(value));
}

function combinedRecord(lead, lmsResult) {
  return { ...(lead?.raw || lead || {}), ...(lmsResult || {}) };
}

const FULFILMENT_ACTIVITY_TYPES = Object.freeze({
  FULFILMENT_AGREEMENT_SIGNED: "agreementSigned",
  FULFILMENT_DIRECT_DEBIT_REGISTERED: "directDebitReady",
  FULFILMENT_DISBURSED: "disbursed",
});

function fulfilmentActivityEvidence(rows = [], leadId = "") {
  const evidence = {
    agreementSigned: false,
    directDebitReady: false,
    disbursed: false,
    agreementSignedAt: "",
    directDebitAt: "",
    disbursedAt: "",
  };
  for (const row of rows) {
    if (clean(row?.["Lead ID"]) !== clean(leadId)) continue;
    const key = FULFILMENT_ACTIVITY_TYPES[normalized(row?.["Activity Type"])];
    if (!key) continue;
    const at = first(row, ["Activity Date", "Created Date", "Timestamp"]);
    evidence[key] = true;
    if (key === "agreementSigned" && at) evidence.agreementSignedAt = at;
    if (key === "directDebitReady" && at) evidence.directDebitAt = at;
    if (key === "disbursed" && at) evidence.disbursedAt = at;
  }
  return evidence;
}

/**
 * @param {any} lead
 * @param {Record<string, string> | undefined} lmsResult
 * @param {Array<Record<string, string>>} activityRows
 */
export function derivePostApprovalCase(lead = {}, lmsResult, activityRows = []) {
  const raw = lead?.raw || lead || {};
  const leadId = clean(lead?.id || raw["Lead ID"]);
  const record = combinedRecord(lead, lmsResult);
  const activity = fulfilmentActivityEvidence(activityRows, leadId);
  const lmsDecision = normalized(
    first(lmsResult || {}, ["Final Decision", "Decision", "Result", "Status"]),
  );
  const officialApproval = lmsDecision === "APPROVED";
  const closedWithoutFulfilment = ["DECLINED", "REJECTED", "CANCELLED"].includes(
    lmsDecision,
  );

  const agreementSignedAt = first(record, [
    "Agreement Signed At",
    "Contract Signed At",
    "Agreement Date",
  ]);
  const agreementValue = first(record, [
    "Agreement Status",
    "Contract Status",
    "Agreement Signed",
  ]);
  const agreementSigned = activity.agreementSigned || Boolean(agreementSignedAt) ||
    isComplete(agreementValue, ["SIGNED", "COMPLETED", "COMPLETE", "YES", "TRUE"]);

  const directDebitAt = first(record, [
    "Direct Debit Registered At",
    "Direct Debit Activated At",
    "Mandate Registered At",
  ]);
  const directDebitValue = first(record, [
    "Direct Debit Status",
    "Mandate Status",
    "Direct Debit Registered",
  ]);
  const directDebitReady = activity.directDebitReady || Boolean(directDebitAt) ||
    isComplete(directDebitValue, [
      "ACTIVE",
      "REGISTERED",
      "APPROVED",
      "COMPLETED",
      "COMPLETE",
      "YES",
      "TRUE",
    ]);

  const disbursedAt = first(record, [
    "Disbursed At",
    "Disbursement Date",
    "Funds Released At",
  ]);
  const disbursementValue = first(record, [
    "Disbursement Status",
    "Funds Release Status",
  ]);
  const leadStage = normalized(lead?.stage || raw["Current Stage"] || raw["Lead Status"]);
  const disbursed = activity.disbursed || Boolean(disbursedAt) ||
    leadStage === "DISBURSED" ||
    isComplete(disbursementValue, [
      "DISBURSED",
      "COMPLETED",
      "COMPLETE",
      "RELEASED",
      "PAID",
    ]);

  const dataIssues = [];
  if (directDebitReady && !agreementSigned)
    dataIssues.push("DIRECT_DEBIT_WITHOUT_AGREEMENT");
  if (disbursed && !directDebitReady)
    dataIssues.push("DISBURSEMENT_WITHOUT_DIRECT_DEBIT");

  let stage = "AWAITING_LMS_DECISION";
  let nextAction = "Await an official LMS approval result";
  let tone = "gray";
  if (officialApproval && dataIssues.length) {
    stage = "FULFILMENT_DATA_EXCEPTION";
    nextAction = "Resolve inconsistent fulfilment evidence before continuing";
    tone = "red";
  } else if (closedWithoutFulfilment) {
    stage = "CLOSED_NO_FULFILMENT";
    nextAction = "No post-approval action required";
  } else if (officialApproval && disbursed) {
    stage = "DISBURSED";
    nextAction = "No open fulfilment action";
    tone = "teal";
  } else if (officialApproval && directDebitReady) {
    stage = "READY_FOR_DISBURSEMENT";
    nextAction = "Complete the approved disbursement process";
    tone = "teal";
  } else if (officialApproval && agreementSigned) {
    stage = "DIRECT_DEBIT_PENDING";
    nextAction = "Register and confirm the Direct Debit mandate";
    tone = "amber";
  } else if (officialApproval) {
    stage = "AGREEMENT_PENDING";
    nextAction = "Prepare and obtain the signed loan agreement";
    tone = "amber";
  }

  return {
    lead,
    leadId,
    lmsResult,
    lmsDecision: lmsDecision || "NOT_RECORDED",
    officialApproval,
    dataIssues,
    stage,
    tone,
    nextAction,
    approvedAt: first(lmsResult || {}, ["Decision At", "Callback At", "Updated At", "Created At"]),
    agreementStatus: officialApproval
      ? agreementSigned
        ? "SIGNED"
        : agreementValue || "PENDING"
      : "NOT_STARTED",
    agreementSigned,
    agreementSignedAt: activity.agreementSignedAt || agreementSignedAt,
    directDebitStatus: officialApproval
      ? directDebitReady
        ? "REGISTERED"
        : agreementSigned
          ? directDebitValue || "PENDING"
          : "BLOCKED"
      : "NOT_STARTED",
    directDebitReady,
    directDebitAt: activity.directDebitAt || directDebitAt,
    disbursementStatus: officialApproval
      ? disbursed
        ? "DISBURSED"
        : directDebitReady
          ? disbursementValue || "READY"
          : "BLOCKED"
      : "NOT_STARTED",
    disbursed,
    disbursedAt: activity.disbursedAt || disbursedAt,
  };
}

/**
 * @param {{leads?: any[], lmsResults?: Array<Record<string, string>>, activities?: Array<Record<string, string>>}} input
 */
export function buildPostApprovalCases({ leads = [], lmsResults = [], activities = [] } = {}) {
  return leads
    .map((lead) => {
      const raw = lead?.raw || lead || {};
      const leadId = clean(lead?.id || raw["Lead ID"]);
      return derivePostApprovalCase(
        lead,
        latestLmsResult(lmsResults, leadId),
        activities,
      );
    })
    .filter((item) => item.officialApproval)
    .sort((a, b) => {
      if (a.disbursed !== b.disbursed) return a.disbursed ? 1 : -1;
      return timeValue(a.lmsResult) - timeValue(b.lmsResult) ||
        a.leadId.localeCompare(b.leadId);
    });
}
