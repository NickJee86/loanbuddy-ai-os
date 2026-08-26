import { NextRequest, NextResponse } from "next/server";
import { sessionCookieName, verifySession } from "../../auth";
import { evaluateFulfilmentAction } from "../../fulfilment-control.mjs";
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

const IDEMPOTENCY_NAMESPACE = "LOANBUDDY_FULFILMENT";
const ACTIVITY_HEADERS = Object.freeze([
  "Lead ID",
  "Activity Type",
  "Activity Date",
  "Created Date",
  "Created By",
  "Staff ID",
  "Description",
]);

type FulfilmentBody = {
  leadId?: string;
  action?: string;
  note?: string;
};

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

async function ensureActivityHeaders(
  sheetId: string,
  token: string,
  existing: string[],
) {
  const headers = [...existing];
  for (const header of ACTIVITY_HEADERS) {
    if (!headers.includes(header)) headers.push(header);
  }
  if (!headers.length)
    throw new Error("Lead_Activities is unavailable.");
  if (headers.length !== existing.length) {
    await writeSheetValues(
      sheetId,
      token,
      `Lead_Activities!A1:${columnName(headers.length - 1)}1`,
      [headers],
    );
  }
  return headers;
}

export async function POST(request: NextRequest) {
  const user = await verifySession(
    request.cookies.get(sessionCookieName())?.value,
  );
  if (!user)
    return NextResponse.json(
      { error: "Authentication is required.", code: "UNAUTHENTICATED" },
      { status: 401 },
    );

  try {
    const body = (await request.json()) as FulfilmentBody;
    const leadId = String(body.leadId || "").trim();
    const action = String(body.action || "").trim();
    const note = String(body.note || "").trim();
    if (!leadId)
      return NextResponse.json(
        { error: "Lead ID is required.", code: "LEAD_ID_REQUIRED" },
        { status: 400 },
      );
    if (note.length > 500)
      return NextResponse.json(
        { error: "The note must not exceed 500 characters.", code: "NOTE_TOO_LONG" },
        { status: 400 },
      );

    const { sheetId, token } = await writableSheetContext();
    const [leadValues, lmsValues, activityValues] = await Promise.all([
      readSheetValues(sheetId, token, "Leads!A1:CZ"),
      readSheetValues(sheetId, token, "LMS_Credit_Result!A1:CZ"),
      readSheetValues(sheetId, token, "Lead_Activities!A1:CZ"),
    ]);
    const leads = rowsToRecords(leadValues).map((item) => item.record);
    const lmsResults = rowsToRecords(lmsValues).map((item) => item.record);
    const activities = rowsToRecords(activityValues).map((item) => item.record);
    const lead = leads.find((row) => String(row["Lead ID"] || "").trim() === leadId);
    const evaluation = evaluateFulfilmentAction({
      user,
      lead,
      lmsResults,
      activities,
      action,
    });
    if ("code" in evaluation)
      return NextResponse.json(
        { error: evaluation.message, code: evaluation.code },
        { status: evaluation.status },
      );
    const definition = evaluation.definition;

    const headers = await ensureActivityHeaders(
      sheetId,
      token,
      activityValues[0] || [],
    );
    const reservation = await claimSpreadsheetIdempotency(
      sheetId,
      token,
      IDEMPOTENCY_NAMESPACE,
      `${leadId}:${action}`,
    );
    if (!reservation.claimed)
      return NextResponse.json(
        {
          error: "This post-approval action has already been processed.",
          code: "DUPLICATE_ACTION",
        },
        { status: 409 },
      );

    const now = new Date().toISOString();
    const activity: Record<string, string> = {
      "Lead ID": leadId,
      "Activity Type": definition.eventType,
      "Activity Date": now,
      "Created Date": now,
      "Created By": user.name || user.username,
      "Staff ID": user.salesId || user.username,
      Description: note || definition.label,
    };
    try {
      await writeSheetValues(
        sheetId,
        token,
        `Lead_Activities!A:${columnName(headers.length - 1)}`,
        [headers.map((header) => activity[header] || "")],
        true,
      );
    } catch (error) {
      await releaseSpreadsheetIdempotency(
        sheetId,
        token,
        reservation.metadataId,
      );
      throw error;
    }

    let auditRecorded = true;
    try {
      await appendAudit(
        sheetId,
        token,
        `CRM_${definition.eventType}`,
        `${user.username} (${user.role})`,
        leadId,
        JSON.stringify({ action, status: definition.status }),
      );
    } catch (error) {
      auditRecorded = false;
      const message = error instanceof Error ? error.message : "audit append failed";
      console.error(`[fulfilment-audit] ${message}`);
    }

    return NextResponse.json(
      {
        ok: true,
        status: definition.status,
        auditRecorded,
        warning: auditRecorded
          ? undefined
          : "The immutable activity was recorded, but the central audit mirror needs review.",
      },
      { status: 201 },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to record the post-approval action.";
    console.error(`[fulfilment] ${message}`);
    return NextResponse.json(
      { error: message, code: "FULFILMENT_WRITE_FAILED" },
      { status: 502 },
    );
  }
}
