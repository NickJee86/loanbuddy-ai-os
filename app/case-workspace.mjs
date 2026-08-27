const REQUIRED_DOCUMENTS = Object.freeze([
  "IC_FRONT",
  "IC_BACK",
  "PAYSLIP",
  "BANK_STATEMENT",
]);

import { evaluateLmsQueueEligibility } from "./lms-queue.mjs";
import { readCreditPolicyEngineConfig } from "./credit-policy-control.mjs";

const QUALIFICATION_FIELDS = Object.freeze([
  ["Consent", ["Consent Status"]],
  ["Age", ["Age"]],
  ["Requested amount", ["Loan Amount", "Loan Amount Requested"]],
  ["Gross monthly income", ["Monthly Income"]],
  ["Salary bank-in", ["Salary Bank In"]],
  ["Employment type", ["Employment Type", "Employment Status"]],
  ["Employment tenure", ["Employment Tenure Months", "Employment Duration"]],
  ["Employer", ["Employer Name"]],
  ["Industry", ["Industry"]],
  ["Verified net income", ["Verified Net Income"]],
  ["Income evidence", ["Income Verification Source"]],
  ["Monthly commitments", ["Existing Commitment", "Monthly Commitments"]],
  ["Requested tenure", ["Requested Tenure Months"]],
]);

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
    "Assessed At",
    "Assessment At",
    "Requested At",
    "Updated At",
    "Last Updated",
    "Created At",
    "Created Date",
    "Timestamp",
  ]) {
    const value = Date.parse(clean(row[key]));
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

export function latestRow(rows = [], leadId = "") {
  return rows
    .filter((row) => clean(row["Lead ID"]) === clean(leadId))
    .map((row, index) => ({ row, index }))
    .sort((a, b) => timeValue(a.row) - timeValue(b.row) || a.index - b.index)
    .at(-1)?.row;
}

export function qualificationSnapshot(lead = {}, state = {}) {
  const raw = lead.raw || lead;
  const fields = QUALIFICATION_FIELDS.map(([label, keys]) => {
    const value = first(state, keys) || first(raw, keys);
    const complete =
      Boolean(value) && (label !== "Consent" || normalized(value) === "YES");
    return { label, value, complete };
  });
  return {
    fields,
    completed: fields.filter((field) => field.complete).length,
    total: fields.length,
    missing: fields.filter((field) => !field.complete).map((field) => field.label),
  };
}

function documentSnapshot(leadId, rows = []) {
  const accepted = new Set([
    "",
    "RECEIVED",
    "VERIFIED",
    "PASSED",
    "COMPLETE",
    "COMPLETED",
    "APPROVED",
    "PENDING",
  ]);
  const present = new Set(
    rows
      .filter((row) => clean(row["Lead ID"]) === clean(leadId))
      .filter((row) => accepted.has(normalized(row.Status)))
      .map((row) =>
        normalized(
          row["Document Type"] ||
            row["Detected Document Type"] ||
            row["Document Label"],
        ),
      ),
  );
  const missing = REQUIRED_DOCUMENTS.filter((type) => !present.has(type));
  return {
    completed: REQUIRED_DOCUMENTS.length - missing.length,
    total: REQUIRED_DOCUMENTS.length,
    missing,
  };
}

function passedVerification(row = {}) {
  return ["VERIFIED", "PASSED", "COMPLETE", "COMPLETED", "APPROVED"].includes(
    normalized(
      row["Overall Verification Status"] || row["Verification Status"],
    ),
  );
}

function applicationState({ qualification, documents, verification, assessment, queue, lead, queueEligibility }) {
  const lmsStatus = normalized(lead.lmsStatus || lead.raw?.["LMS Status"]);
  if (["APPROVED", "COMPLETED", "DISBURSED"].includes(lmsStatus))
    return { phase: "COMPLETED", blocker: "No open CRM gate", tone: "teal" };
  if (queue)
    return {
      phase: "LMS QUEUE",
      blocker: `Internal queue: ${queue["Queue Status"] || "QUEUED"}`,
      tone: "blue",
    };
  if (qualification.missing.length)
    return {
      phase: "QUALIFICATION",
      blocker: `Missing: ${qualification.missing.join(", ")}`,
      tone: "amber",
    };
  if (documents.missing.length)
    return {
      phase: "DOCUMENTS",
      blocker: `Missing: ${documents.missing.join(", ")}`,
      tone: "amber",
    };
  if (!passedVerification(verification))
    return {
      phase: "VERIFICATION",
      blocker: verification
        ? verification["Overall Verification Status"] || "Verification not passed"
        : "No verification result",
      tone: "blue",
    };
  if (!assessment)
    return {
      phase: "CREDIT",
      blocker: "Pre-LMS assessment not created",
      tone: "blue",
    };
  if (queueEligibility?.eligible)
    return {
      phase: "READY FOR LMS",
      blocker: "ACTIVE assessment and policy passed; waiting for internal queue entry",
      tone: "teal",
    };
  const queueReasonList = Array.isArray(queueEligibility?.reasons)
    ? queueEligibility.reasons
    : [];
  const consentReasons = queueReasonList.filter((reason) =>
    String(reason).startsWith("CTOS_CCRIS_CONSENT_"),
  );
  const nonConsentReasons = queueReasonList.filter(
    (reason) => !String(reason).startsWith("CTOS_CCRIS_CONSENT_"),
  );
  if (consentReasons.length && !nonConsentReasons.length)
    return {
      phase: "CONSENT",
      blocker: consentReasons.join(", ").replace(/_/g, " "),
      tone: consentReasons.includes("CTOS_CCRIS_CONSENT_REVOKED")
        ? "red"
        : "amber",
    };
  const queueReasons = Array.isArray(queueEligibility?.reasons)
    ? queueEligibility.reasons.join(", ").replace(/_/g, " ")
    : "Credit assessment unresolved";
  return {
    phase: "CREDIT",
    blocker:
      assessment["Reason Codes"] ||
      assessment["Hard Rule Reasons"] ||
      queueReasons,
    tone: normalized(assessment["Hard Rule Status"]) === "FAIL" ? "red" : "amber",
  };
}

export function buildApplicationRegister(leads = [], data = {}) {
  return leads.map((lead) => {
    const state = latestRow(data.Conversation_State || [], lead.id) || {};
    const verification =
      latestRow(data.Document_Verification_Log || [], lead.id) || undefined;
    const assessment = latestRow(data.Credit_Assessment || [], lead.id);
    const queue = latestRow(data.LMS_Submission_Queue || [], lead.id);
    const queueEligibility = evaluateLmsQueueEligibility({
      leadId: lead.id,
      assessmentRows: data.Credit_Assessment || [],
      policyRows: data.Product_Credit_Policy || [],
      existingQueueRows: [],
      documentRows: data.Document_Received_Log || [],
      policyEngineEnabled: readCreditPolicyEngineConfig(
        data.System_Config || [],
      ).enabled,
    });
    const qualification = qualificationSnapshot(lead, state);
    const documents = documentSnapshot(
      lead.id,
      data.Document_Received_Log || [],
    );
    return {
      lead,
      state,
      verification,
      assessment,
      queue,
      qualification,
      documents,
      ...applicationState({
        qualification,
        documents,
        verification,
        assessment,
        queue,
        lead,
        queueEligibility,
      }),
    };
  });
}

export function mergedQualificationRows(leads = [], stateRows = []) {
  const rows = stateRows.map((row) => ({ ...row }));
  const stateLeadIds = new Set(
    stateRows.map((row) => clean(row["Lead ID"])).filter(Boolean),
  );
  for (const lead of leads) {
    const leadId = clean(lead?.id || lead?.raw?.["Lead ID"]);
    if (!leadId || stateLeadIds.has(leadId)) continue;
    const leadPhone = phoneDigits(
      lead?.phone || lead?.raw?.["Phone Number"],
    );
    const phoneMatch = leadPhone
      ? rows.findIndex(
          (row) =>
            !clean(row["Lead ID"]) &&
            phoneDigits(
              row["Phone Number"] ||
                row["WhatsApp Number"] ||
                row["Customer Phone"],
            ) === leadPhone,
        )
      : -1;
    if (phoneMatch >= 0) {
      rows[phoneMatch] = {
        ...rows[phoneMatch],
        "Lead ID": leadId,
        "Lead Name":
          clean(rows[phoneMatch]["Lead Name"]) ||
          clean(lead?.name || lead?.raw?.["Lead Name"]),
        "Phone Number":
          clean(rows[phoneMatch]["Phone Number"]) ||
          clean(lead?.phone || lead?.raw?.["Phone Number"]),
      };
      stateLeadIds.add(leadId);
      continue;
    }
    const qualification = qualificationSnapshot(lead, {});
    if (!qualification.missing.length) continue;
    rows.push({
      "Lead ID": leadId,
      "Lead Name": clean(lead?.name || lead?.raw?.["Lead Name"]),
      "Phone Number": clean(lead?.phone || lead?.raw?.["Phone Number"]),
      "Current Step": "QUALIFICATION",
      "Qualification Status": "PENDING",
      "Last Customer Reply": "",
      "Next Action": `Collect missing: ${qualification.missing.join(", ")}`,
      "Last Updated": clean(lead?.updated || lead?.raw?.["Last AI Update"]),
      "Assigned To": clean(lead?.owner),
      "Processing Route": clean(lead?.processingRoute),
      Source: "Application_Register",
    });
  }
  return rows;
}

export function formatConfidence(value) {
  const text = clean(value);
  if (!text) return "—";
  const hasPercent = text.endsWith("%");
  const numeric = Number(text.replace(/%$/, "").trim());
  if (!Number.isFinite(numeric) || numeric < 0) return text;
  const percentage = !hasPercent && numeric <= 1 ? numeric * 100 : numeric;
  const rounded = Math.round(percentage * 10) / 10;
  return `${rounded}%`;
}

export function mergedFollowUpRows(queueRows = [], stateRows = []) {
  const rows = [...queueRows];
  const queuedLeadIds = new Set(
    queueRows.map((row) => clean(row["Lead ID"])).filter(Boolean),
  );
  for (const state of stateRows) {
    const leadId = clean(state["Lead ID"]);
    const nextAction = clean(state["Next Action"]);
    if (!leadId || !nextAction || queuedLeadIds.has(leadId)) continue;
    rows.push({
      "Lead ID": leadId,
      "Lead Name": state["Lead Name"] || "",
      "Phone Number": state["Phone Number"] || "",
      "Follow Up Type": "CONVERSATION_NEXT_ACTION",
      "Next Action": nextAction,
      Status: state["Qualification Status"] || state["Document Status"] || "OPEN",
      "Due At": state["Next Follow Up At"] || state["Last Updated"] || "",
      "Assigned To": state["Assigned To"] || "AI / case owner",
      Source: "Conversation_State",
    });
  }
  return rows;
}

function phoneDigits(value) {
  return clean(value).replace(/\D/g, "");
}

export function rowsForVisibleLeads(rows = [], leads = []) {
  const leadIds = new Set();
  const phones = new Set();
  for (const lead of leads) {
    const raw = lead?.raw || lead || {};
    const leadId = clean(lead?.id || raw["Lead ID"]);
    const phone = phoneDigits(
      lead?.phone ||
        raw["Phone Number"] ||
        raw["Customer Phone"] ||
        raw["WhatsApp Number"],
    );
    if (leadId) leadIds.add(leadId);
    if (phone) phones.add(phone);
  }
  return (rows || []).filter((row) => {
    const leadId = clean(row?.["Lead ID"]);
    if (leadId) return leadIds.has(leadId);
    const phone = phoneDigits(
      row?.["Phone Number"] ||
        row?.["Customer Phone"] ||
        row?.["WhatsApp Number"] ||
        row?.From,
    );
    return Boolean(phone) && phones.has(phone);
  });
}
