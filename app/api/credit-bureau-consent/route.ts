import { NextRequest, NextResponse } from "next/server";
import { sessionCookieName, verifySession } from "../../auth";
import {
  CREDIT_BUREAU_CONSENT_TYPE,
  CREDIT_BUREAU_CONSENT_VERSION,
} from "../../credit-bureau-consent.mjs";
import {
  appendAudit,
  readSheetValues,
  rowsToRecords,
  writableSheetContext,
  writeSheetValues,
} from "../../google-sheets-write";

export const runtime = "nodejs";

type ConsentAction = "verify" | "reject" | "revoke";
type ConsentBody = {
  leadId?: string;
  action?: ConsentAction;
  reason?: string;
};

const CONSENT_LOG_HEADERS = Object.freeze([
  "Consent Version",
  "Consent Purpose",
  "Verified At",
  "Verified By",
  "Verification Notes",
  "Revoked At",
]);
const CONSENT_LEAD_HEADERS = Object.freeze([
  "Credit Bureau Consent Status",
  "Credit Bureau Consent Version",
  "Credit Bureau Consent Received At",
  "Credit Bureau Consent Verified At",
  "Credit Bureau Consent Verified By",
  "Credit Bureau Consent Revoked At",
]);

function normalized(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

function columnName(index: number) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

async function ensureHeaders(
  sheetId: string,
  token: string,
  sheet: string,
  existing: string[],
  required: readonly string[],
) {
  const headers = [...existing];
  for (const header of required)
    if (!headers.includes(header)) headers.push(header);
  if (headers.length !== existing.length)
    await writeSheetValues(
      sheetId,
      token,
      `${sheet}!A1:${columnName(headers.length - 1)}1`,
      [headers],
    );
  return headers;
}

export async function POST(request: NextRequest) {
  const user = await verifySession(
    request.cookies.get(sessionCookieName())?.value,
  );
  if (!user)
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (!["admin", "regional_manager"].includes(user.role))
    return NextResponse.json(
      {
        error:
          "Only Admin or Regional Manager can verify credit-bureau consent.",
      },
      { status: 403 },
    );

  try {
    const body = (await request.json()) as ConsentBody;
    const leadId = String(body.leadId || "").trim();
    const action = body.action;
    const reason = String(body.reason || "").trim();
    if (!leadId)
      return NextResponse.json(
        { error: "Lead ID is required." },
        { status: 400 },
      );
    if (!action || !["verify", "reject", "revoke"].includes(action))
      return NextResponse.json(
        { error: "A valid consent action is required." },
        { status: 400 },
      );
    if (["reject", "revoke"].includes(action) && !reason)
      return NextResponse.json(
        { error: "A reason is required for rejection or withdrawal." },
        { status: 400 },
      );
    if (reason.length > 500)
      return NextResponse.json(
        { error: "The reason must not exceed 500 characters." },
        { status: 400 },
      );

    const { sheetId, token } = await writableSheetContext();
    const [leadValues, documentValues, queueValues] = await Promise.all([
      readSheetValues(sheetId, token, "Leads!A1:CZ"),
      readSheetValues(sheetId, token, "Document_Received_Log!A1:CZ"),
      readSheetValues(sheetId, token, "LMS_Submission_Queue!A1:R"),
    ]);
    const leadHeaders = await ensureHeaders(
      sheetId,
      token,
      "Leads",
      leadValues[0] || [],
      CONSENT_LEAD_HEADERS,
    );
    const leadRows = rowsToRecords([leadHeaders, ...leadValues.slice(1)]);
    const leadItem = leadRows.find(
      ({ record }) => String(record["Lead ID"] || "").trim() === leadId,
    );
    if (!leadItem)
      return NextResponse.json({ error: "Lead not found." }, { status: 404 });

    const documentHeaders = await ensureHeaders(
      sheetId,
      token,
      "Document_Received_Log",
      documentValues[0] || [],
      CONSENT_LOG_HEADERS,
    );
    const consentItems = rowsToRecords([
      documentHeaders,
      ...documentValues.slice(1),
    ]).filter(
      ({ record }) =>
        String(record["Lead ID"] || "").trim() === leadId &&
        normalized(
          record["Document Type"] ||
            record["Detected Document Type"] ||
            record["Document Label"],
        ) === CREDIT_BUREAU_CONSENT_TYPE,
    );
    const consentItem = consentItems.at(-1);
    if (!consentItem)
      return NextResponse.json(
        { error: "Upload the signed CTOS / CCRIS consent letter first." },
        { status: 409 },
      );
    const currentVerification = normalized(
      consentItem.record["Verification Status"],
    );
    if (currentVerification === "REVOKED")
      return NextResponse.json(
        {
          error:
            "This consent was withdrawn. Upload a new signed form before any further verification.",
        },
        { status: 409 },
      );
    if (action === "verify" && currentVerification === "VERIFIED")
      return NextResponse.json({ ok: true, status: "VERIFIED", unchanged: true });

    const queueItems = rowsToRecords(queueValues).filter(
      ({ record }) => String(record["Lead ID"] || "").trim() === leadId,
    );
    if (
      action === "revoke" &&
      queueItems.some(
        ({ record }) =>
          String(record["Submitted At"] || "").trim() ||
          ["SUBMITTED", "PROCESSING", "IN_PROGRESS"].includes(
            normalized(record["Queue Status"]),
          ),
      )
    )
      return NextResponse.json(
        {
          error:
            "The case has already entered the external LMS lifecycle. Follow the official LMS withdrawal procedure before recording consent withdrawal.",
        },
        { status: 409 },
      );

    const now = new Date().toISOString();
    const consentRecord = { ...consentItem.record };
    consentRecord["Consent Version"] = CREDIT_BUREAU_CONSENT_VERSION;
    consentRecord["Consent Purpose"] =
      "CREDIT_ACCOUNT_EVALUATION_AND_AUTHORISED_CCRIS_CHECK";
    consentRecord["Verification Notes"] = reason;
    if (action === "verify") {
      consentRecord.Status = "VERIFIED";
      consentRecord["Verification Status"] = "VERIFIED";
      consentRecord["Verified At"] = now;
      consentRecord["Verified By"] = user.username;
      consentRecord["Revoked At"] = "";
    } else if (action === "reject") {
      consentRecord.Status = "REUPLOAD_REQUIRED";
      consentRecord["Verification Status"] = "REJECTED";
      consentRecord["Verified At"] = now;
      consentRecord["Verified By"] = user.username;
      consentRecord["Revoked At"] = "";
    } else {
      consentRecord.Status = "REVOKED";
      consentRecord["Verification Status"] = "REVOKED";
      consentRecord["Revoked At"] = now;
    }
    await writeSheetValues(
      sheetId,
      token,
      `Document_Received_Log!A${consentItem.rowNumber}:${columnName(documentHeaders.length - 1)}${consentItem.rowNumber}`,
      [documentHeaders.map((header) => consentRecord[header] || "")],
    );

    const leadRecord = { ...leadItem.record };
    leadRecord["Credit Bureau Consent Status"] =
      action === "verify"
        ? "VERIFIED"
        : action === "reject"
          ? "REUPLOAD_REQUIRED"
          : "REVOKED";
    leadRecord["Credit Bureau Consent Version"] =
      CREDIT_BUREAU_CONSENT_VERSION;
    if (action === "verify") {
      leadRecord["Credit Bureau Consent Verified At"] = now;
      leadRecord["Credit Bureau Consent Verified By"] = user.username;
      leadRecord["Credit Bureau Consent Revoked At"] = "";
    } else if (action === "revoke") {
      leadRecord["Credit Bureau Consent Revoked At"] = now;
    }
    await writeSheetValues(
      sheetId,
      token,
      `Leads!A${leadItem.rowNumber}:${columnName(leadHeaders.length - 1)}${leadItem.rowNumber}`,
      [leadHeaders.map((header) => leadRecord[header] || "")],
    );

    if (action === "revoke") {
      const queueHeaders = queueValues[0] || [];
      for (const queueItem of queueItems) {
        const queueStatus = normalized(queueItem.record["Queue Status"]);
        if (!["QUEUED", "FAILED", "ERROR", "RETRY", "RETRYING"].includes(queueStatus))
          continue;
        const queueRecord = { ...queueItem.record };
        queueRecord["Queue Status"] = "CANCELLED_CONSENT_REVOKED";
        queueRecord["Last Error"] = reason;
        queueRecord["Locked At"] = now;
        queueRecord["Locked By"] = user.username;
        await writeSheetValues(
          sheetId,
          token,
          `LMS_Submission_Queue!A${queueItem.rowNumber}:R${queueItem.rowNumber}`,
          [queueHeaders.map((header) => queueRecord[header] || "")],
        );
      }
    }

    try {
      await appendAudit(
        sheetId,
        token,
        `CRM_CREDIT_BUREAU_CONSENT_${action.toUpperCase()}`,
        user.username,
        leadId,
        reason || CREDIT_BUREAU_CONSENT_VERSION,
      );
    } catch (auditError) {
      console.error(
        "[credit-bureau-consent] Consent state saved but audit mirror failed.",
        auditError,
      );
    }
    return NextResponse.json({
      ok: true,
      status: leadRecord["Credit Bureau Consent Status"],
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to update credit-bureau consent.";
    console.error(`[credit-bureau-consent] ${message}`);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
