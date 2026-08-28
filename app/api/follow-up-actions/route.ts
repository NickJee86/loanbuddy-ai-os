import { NextRequest, NextResponse } from "next/server";
import { sessionCookieName, verifySession } from "../../auth";
import { filterCrmDataForUser } from "../../access-control.mjs";
import { followUpPatch, validateFollowUpAction } from "../../follow-up-operations.mjs";
import {
  appendAudit,
  readSheetValues,
  rowsToRecords,
  writableSheetContext,
  writeSheetValues,
} from "../../google-sheets-write";

export const runtime = "nodejs";
type RecordRow = { rowNumber: number; record: Record<string, string> };

const REQUIRED_HEADERS = [
  "Follow Up ID", "Lead ID", "Phone Number", "Follow Up Type", "Reminder Stage",
  "Last Reminder At", "Next Action", "Due At", "Scheduled At", "Status",
  "AI Status", "Assigned To", "Priority", "Outcome", "Delivery Status",
  "Last Error", "Last Action", "Last Action At", "Last Action Note", "Updated At",
];

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

function sameCustomer(row: Record<string, string>, leadId: string, phone: string) {
  return (leadId && row["Lead ID"] === leadId) || (phone && row["Phone Number"] === phone);
}

async function ensureHeaders(sheetId: string, token: string, values: string[][]) {
  const existing = values[0] || [];
  const headers = [...existing];
  for (const header of REQUIRED_HEADERS) if (!headers.includes(header)) headers.push(header);
  if (headers.length !== existing.length)
    await writeSheetValues(sheetId, token, "Follow_Up_Queue!A1:AZ1", [headers]);
  return headers;
}

export async function POST(request: NextRequest) {
  const user = await verifySession(request.cookies.get(sessionCookieName())?.value);
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (!["admin", "regional_manager", "manager", "staff"].includes(user.role))
    return NextResponse.json({ error: "Follow-up action access denied." }, { status: 403 });
  try {
    const validation = validateFollowUpAction(await request.json());
    if (!validation.valid)
      return NextResponse.json({ error: validation.errors.join(" ") }, { status: 400 });
    const action = validation.value;
    const { sheetId, token } = await writableSheetContext();
    const [leadValues, queueValues, stateValues] = await Promise.all([
      readSheetValues(sheetId, token, "Leads!A1:CZ"),
      readSheetValues(sheetId, token, "Follow_Up_Queue!A1:AZ"),
      readSheetValues(sheetId, token, "Conversation_State!A1:CZ"),
    ]);
    const leadRows = rowsToRecords(leadValues).map((item) => item.record);
    const visible = filterCrmDataForUser(user, { Leads: leadRows }).data.Leads || [];
    const management = ["admin", "regional_manager"].includes(user.role);
    if (!management && !visible.some((row: Record<string, string>) => sameCustomer(row, action.leadId, action.phone)))
      return NextResponse.json({ error: "This customer is outside your assigned access scope." }, { status: 403 });

    const headers = await ensureHeaders(sheetId, token, queueValues);
    const queueRows = rowsToRecords(queueValues) as RecordRow[];
    const existing = [...queueRows].reverse().find(({ record }) => sameCustomer(record, action.leadId, action.phone));
    const now = new Date().toISOString();
    const record: Record<string, string> = {
      ...(existing?.record || {}),
      "Follow Up ID": existing?.record["Follow Up ID"] || `FU-${crypto.randomUUID()}`,
      ...followUpPatch(action, existing?.record || {}, now),
    };
    if (existing)
      await writeSheetValues(sheetId, token, `Follow_Up_Queue!A${existing.rowNumber}:AZ${existing.rowNumber}`, [headers.map((header) => record[header] || "")]);
    else
      await writeSheetValues(sheetId, token, "Follow_Up_Queue!A:AZ", [headers.map((header) => record[header] || "")], true);

    if (["PAUSE", "RESUME"].includes(action.action)) {
      const stateHeaders = stateValues[0] || [];
      const stateRows = rowsToRecords(stateValues) as RecordRow[];
      const state = [...stateRows].reverse().find(({ record }) => sameCustomer(record, action.leadId, action.phone));
      const aiColumn = stateHeaders.indexOf("AI Status");
      if (state && aiColumn >= 0) {
        const column = columnName(aiColumn);
        await writeSheetValues(sheetId, token, `Conversation_State!${column}${state.rowNumber}`, [[action.action === "PAUSE" ? "PAUSED" : "ACTIVE"]]);
      }
    }
    await appendAudit(sheetId, token, `FOLLOW_UP_${action.action}`, user.username, action.leadId, JSON.stringify({ phone: action.phone, dueAt: action.dueAt, outcome: action.outcome, assignedTo: action.assignedTo, note: action.note }));
    return NextResponse.json({ ok: true, record });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save follow-up action." }, { status: 502 });
  }
}
