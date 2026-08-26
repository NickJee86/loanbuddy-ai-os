import { NextRequest, NextResponse } from "next/server";
import { sessionCookieName, verifySession } from "../../auth";
import { canControlLmsQueue } from "../../access-control.mjs";
import { readCreditPolicyEngineConfig } from "../../credit-policy-control.mjs";
import {
  evaluateLmsQueueEligibility,
  validateLmsQueueLeadContext,
} from "../../lms-queue.mjs";
import {
  appendAudit,
  claimSpreadsheetIdempotency,
  readSheetValues,
  releaseSpreadsheetIdempotency,
  rowsToRecords,
  writableSheetContext,
  writeSheetValues,
} from "../../google-sheets-write";

export const runtime = "nodejs";

const QUEUE_HEADERS = [
  "Queue ID",
  "Idempotency Key",
  "Lead ID",
  "Assessment ID",
  "Policy Code",
  "Policy Version",
  "Processing Route",
  "Queue Status",
  "Requested By",
  "Requested At",
  "Submitted At",
  "LMS Submission ID",
  "Attempt Count",
  "Next Attempt At",
  "Last Error",
  "Payload Version",
  "Locked At",
  "Locked By",
];

export async function POST(request: NextRequest) {
  const user = await verifySession(
    request.cookies.get(sessionCookieName())?.value,
  );
  if (!user)
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (!canControlLmsQueue(user))
    return NextResponse.json(
      { error: "Only Admin or Regional Manager can control the LMS queue." },
      { status: 403 },
    );
  try {
    const body = (await request.json()) as { leadId?: string };
    const leadId = String(body.leadId || "").trim();
    if (!leadId)
      return NextResponse.json(
        { error: "Lead ID is required." },
        { status: 400 },
      );
    const { sheetId, token } = await writableSheetContext();
    const [
      leadValues,
      assessmentValues,
      policyValues,
      queueValues,
      configValues,
      documentValues,
    ] =
      await Promise.all([
        readSheetValues(sheetId, token, "Leads!A1:CZ"),
        readSheetValues(sheetId, token, "Credit_Assessment!A1:AM"),
        readSheetValues(sheetId, token, "Product_Credit_Policy!A1:Z"),
        readSheetValues(sheetId, token, "LMS_Submission_Queue!A1:R"),
        readSheetValues(sheetId, token, "System_Config!A1:E"),
        readSheetValues(sheetId, token, "Document_Received_Log!A1:CZ"),
      ]);
    const leads = rowsToRecords(leadValues).map(({ record }) => record);
    const lead = leads.find((row) => row["Lead ID"] === leadId);
    if (!lead)
      return NextResponse.json(
        { error: "Lead was not found." },
        { status: 404 },
      );
    const leadContext = validateLmsQueueLeadContext(lead);
    if (!leadContext.valid)
      return NextResponse.json(
        {
          error:
            "LMS queue is locked because the lead routing or visibility is invalid.",
          reasons: leadContext.reasons,
        },
        { status: 409 },
      );
    const queueHeaders = queueValues[0] || [];
    if (QUEUE_HEADERS.some((header) => !queueHeaders.includes(header)))
      throw new Error("LMS_Submission_Queue headers are incomplete.");
    const assessmentRows = rowsToRecords(assessmentValues).map(
      ({ record }) => record,
    );
    const policyRows = rowsToRecords(policyValues).map(({ record }) => record);
    const existingQueueRows = rowsToRecords(queueValues).map(
      ({ record }) => record,
    );
    const engineConfig = readCreditPolicyEngineConfig(
      rowsToRecords(configValues).map(({ record }) => record),
    );
    const result = evaluateLmsQueueEligibility({
      leadId,
      assessmentRows,
      policyRows,
      existingQueueRows,
      documentRows: rowsToRecords(documentValues).map(
        ({ record }) => record,
      ),
      policyEngineEnabled: engineConfig.enabled,
    });
    if (!result.eligible || !result.assessment)
      return NextResponse.json(
        {
          error:
            "LMS queue is locked because the approved credit conditions were not met.",
          reasons: result.reasons,
        },
        { status: 409 },
      );
    const now = new Date().toISOString();
    const queueRecord: Record<string, string> = {
      "Queue ID": `LMSQ-${crypto.randomUUID()}`,
      "Idempotency Key": result.idempotencyKey,
      "Lead ID": leadId,
      "Assessment ID": result.assessment["Assessment ID"] || "",
      "Policy Code": result.assessment["Policy Code"] || "",
      "Policy Version": result.assessment["Policy Version"] || "",
      "Processing Route": leadContext.processingRoute,
      "Queue Status": "QUEUED",
      "Requested By": user.username,
      "Requested At": now,
      "Attempt Count": "0",
      "Payload Version": "V1-PRE-LMS",
    };
    const reservation = await claimSpreadsheetIdempotency(
      sheetId,
      token,
      "LOANBUDDY_LMS_QUEUE",
      result.idempotencyKey,
    );
    if (!reservation.claimed)
      return NextResponse.json(
        {
          error:
            "This assessment already has an internal LMS queue reservation.",
          reasons: ["DUPLICATE_LMS_QUEUE_REQUEST"],
        },
        { status: 409 },
      );
    try {
      await writeSheetValues(
        sheetId,
        token,
        "LMS_Submission_Queue!A:R",
        [queueHeaders.map((header) => queueRecord[header] || "")],
        true,
      );
    } catch (error) {
      try {
        await releaseSpreadsheetIdempotency(
          sheetId,
          token,
          reservation.metadataId,
        );
      } catch (releaseError) {
        console.error(
          "[lms-queue] Unable to release failed idempotency reservation.",
          releaseError,
        );
      }
      throw error;
    }
    try {
      await appendAudit(
        sheetId,
        token,
        "LMS_INTERNAL_QUEUE_CREATED",
        user.username,
        leadId,
        result.idempotencyKey,
      );
    } catch (auditError) {
      console.error(
        "[lms-queue] Queue created but audit append failed.",
        auditError,
      );
    }
    return NextResponse.json({
      ok: true,
      status: "QUEUED",
      queueId: queueRecord["Queue ID"],
      externalSubmission: false,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to create the LMS queue item.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
