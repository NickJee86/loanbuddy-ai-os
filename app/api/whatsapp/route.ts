import { NextRequest, NextResponse } from "next/server";
import { sessionCookieName, verifySession } from "../../auth";
import { appendAudit, readSheetValues, rowsToRecords, writableSheetContext, writeSheetValues } from "../../google-sheets-write";
import { buildManualOutboxRecord, OUTBOX_HEADERS, validateManualWhatsApp } from "../../whatsapp-outbox.mjs";

export const runtime = "nodejs";
type Body = { operation?: "send" | "takeover" | "resume_ai"; leadId?: string; leadName?: string; phone?: string; branchId?: string; salesId?: string; message?: string; language?: string; idempotencyKey?: string };

function canAccess(user: Awaited<ReturnType<typeof verifySession>>, lead: Record<string, string>) {
  if (!user || user.role === "readonly") return false;
  if (["admin", "regional_manager"].includes(user.role)) return true;
  const branch = String(lead["Branch ID"] || lead.Branch || "").trim();
  if (user.role === "manager") return !user.branchIds.length || user.branchIds.includes(branch);
  const owner = String(lead["Assigned Sales ID"] || lead["Sales ID"] || "").trim();
  return Boolean(user.salesId && owner === user.salesId && (!user.branchIds.length || user.branchIds.includes(branch)));
}
function recordRow(headers: string[], record: Record<string, string>) { return headers.map((header) => record[header] || ""); }
function columnName(index: number) { let value = index + 1, name = ""; while (value > 0) { const remainder = (value - 1) % 26; name = String.fromCharCode(65 + remainder) + name; value = Math.floor((value - 1) / 26); } return name; }

export async function POST(request: NextRequest) {
  const user = await verifySession(request.cookies.get(sessionCookieName())?.value);
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (user.role === "readonly") return NextResponse.json({ error: "Read-only accounts cannot send messages." }, { status: 403 });
  let body: Body;
  try { body = (await request.json()) as Body; } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const operation = body.operation || "send";
  const leadId = String(body.leadId || "").trim();
  if (!leadId) return NextResponse.json({ error: "Lead ID is required." }, { status: 400 });
  try {
    const { sheetId, token } = await writableSheetContext();
    const leadValues = await readSheetValues(sheetId, token, "Leads!A1:AZ");
    const lead = rowsToRecords(leadValues).find(({ record }) => String(record["Lead ID"] || "").trim() === leadId)?.record;
    if (!lead) return NextResponse.json({ error: "Customer record not found." }, { status: 404 });
    if (!canAccess(user, lead)) return NextResponse.json({ error: "You do not have access to this customer." }, { status: 403 });
    if (operation === "send") {
      const checked = validateManualWhatsApp({ ...body, leadId, phone: body.phone || lead["Phone Number"] });
      if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
      const currentHeaders = (await readSheetValues(sheetId, token, "Message_Outbox!A1:Y1"))[0];
      const headers = currentHeaders?.length ? currentHeaders : [...OUTBOX_HEADERS];
      if (!currentHeaders?.length) await writeSheetValues(sheetId, token, "Message_Outbox!A1:Y1", [headers]);
      const phone = String(checked.phone || "");
      const record = buildManualOutboxRecord({ ...body, leadId, phone, leadName: body.leadName || lead["Lead Name"] || lead.Name, branchId: body.branchId || lead["Branch ID"] || lead.Branch, salesId: body.salesId || lead["Assigned Sales ID"] || lead["Sales ID"] }) as Record<string, string>;
      await writeSheetValues(sheetId, token, "Message_Outbox!A:Y", [recordRow(headers, record)], true);
      await appendAudit(sheetId, token, "WHATSAPP_MANUAL_QUEUED", user.username, leadId, JSON.stringify({ messageId: record["Message ID"], phone: `${phone.slice(0, 4)}***${phone.slice(-3)}` }));
      return NextResponse.json({ ok: true, messageId: record["Message ID"], status: "QUEUED" });
    }
    if (!["takeover", "resume_ai"].includes(operation)) return NextResponse.json({ error: "Unsupported operation." }, { status: 400 });
    const stateValues = await readSheetValues(sheetId, token, "Conversation_State!A1:AZ");
    const originalHeaders = stateValues[0] || [];
    if (!originalHeaders.length) return NextResponse.json({ error: "Conversation state is not configured." }, { status: 503 });
    const headers = [...originalHeaders, ...["AI Status", "AI Paused By", "AI Paused At"].filter((header) => !originalHeaders.includes(header))];
    if (headers.length !== originalHeaders.length) await writeSheetValues(sheetId, token, `Conversation_State!A1:${columnName(headers.length - 1)}1`, [headers]);
    const found = rowsToRecords([headers, ...stateValues.slice(1)]).find(({ record }) => String(record["Lead ID"] || "").trim() === leadId);
    const now = new Date().toISOString();
    const record = found?.record || Object.fromEntries(headers.map((header) => [header, ""]));
    record["Lead ID"] = leadId; record["Phone Number"] ||= body.phone || lead["Phone Number"] || ""; record["Lead Name"] ||= body.leadName || lead["Lead Name"] || lead.Name || "";
    record["AI Status"] = operation === "takeover" ? "PAUSED_MANUAL" : "ACTIVE"; record["AI Paused By"] = operation === "takeover" ? user.username : ""; record["AI Paused At"] = operation === "takeover" ? now : ""; record["Last Updated"] = now;
    if (found) await writeSheetValues(sheetId, token, `Conversation_State!A${found.rowNumber}:${columnName(headers.length - 1)}${found.rowNumber}`, [recordRow(headers, record)]);
    else await writeSheetValues(sheetId, token, `Conversation_State!A:${columnName(headers.length - 1)}`, [recordRow(headers, record)], true);
    await appendAudit(sheetId, token, operation === "takeover" ? "AI_MANUAL_TAKEOVER" : "AI_RESUMED", user.username, leadId);
    return NextResponse.json({ ok: true, aiStatus: record["AI Status"] });
  } catch (error) {
    console.error("WhatsApp CRM operation failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to complete the WhatsApp operation." }, { status: 500 });
  }
}
