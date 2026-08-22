import { NextRequest, NextResponse } from "next/server";
import { sessionCookieName, verifySession } from "../../auth";
import { writableSheetContext } from "../../google-sheets-write";
export const runtime = "nodejs";

const clean = (value: unknown) => String(value || "").trim();
function records(values: string[][]) { const headers = values[0] || []; return values.slice(1).filter((row) => row.some(Boolean)).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])) as Record<string, string>); }
function visibleLead(user: NonNullable<Awaited<ReturnType<typeof verifySession>>>, row: Record<string, string>) { if (["admin", "regional_manager", "readonly"].includes(user.role)) return true; const branch = clean(row["Branch ID"] || row.Branch); if (user.role === "manager") return !user.branchIds.length || user.branchIds.includes(branch); return Boolean(user.salesId && clean(row["Assigned Sales ID"] || row["Sales ID"]) === user.salesId && (!user.branchIds.length || user.branchIds.includes(branch))); }
function scopedRows(rows: Record<string, string>[], leadIds: Set<string>, phones: Set<string>) { return rows.filter((row) => { const leadId = clean(row["Lead ID"] || row.LeadId || row.leadId); const phone = clean(row["Phone Number"] || row.Phone || row.phone).replace(/\D/g, "").replace(/^0/, "60"); if (!leadId && !phone) return true; return (leadId && leadIds.has(leadId)) || (phone && phones.has(phone)); }); }

export async function GET(request: NextRequest) {
  const user = await verifySession(request.cookies.get(sessionCookieName())?.value);
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  try {
    const { sheetId, token } = await writableSheetContext();
    const metadataResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}?fields=properties.title,sheets.properties.title`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    if (!metadataResponse.ok) throw new Error(`Unable to inspect CRM workbook (${metadataResponse.status}).`);
    const metadata = await metadataResponse.json() as { properties?: { title?: string }; sheets?: Array<{ properties?: { title?: string } }> };
    const tabs = (metadata.sheets || []).map((sheet) => sheet.properties?.title || "").filter(Boolean);
    const params = new URLSearchParams({ majorDimension: "ROWS", valueRenderOption: "FORMATTED_VALUE" });
    tabs.forEach((tab) => params.append("ranges", `'${tab.replaceAll("'", "''")}'!A1:AZ`));
    const valuesResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchGet?${params}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(25000) });
    if (!valuesResponse.ok) throw new Error(`Unable to read CRM workbook (${valuesResponse.status}).`);
    const payload = await valuesResponse.json() as { valueRanges?: Array<{ values?: string[][] }> };
    const rawData: Record<string, Record<string, string>[]> = {};
    tabs.forEach((tab, index) => { rawData[tab] = records(payload.valueRanges?.[index]?.values || []); });
    const leadsKey = rawData.Leads ? "Leads" : rawData.Lead_Master ? "Lead_Master" : tabs.find((tab) => /lead/i.test(tab) && rawData[tab]?.some((row) => row["Lead ID"])) || "Leads";
    const visible = (rawData[leadsKey] || []).filter((row) => visibleLead(user, row));
    const leadIds = new Set(visible.map((row) => clean(row["Lead ID"])).filter(Boolean));
    const phones = new Set(visible.map((row) => clean(row["Phone Number"]).replace(/\D/g, "").replace(/^0/, "60")).filter(Boolean));
    const data: Record<string, Record<string, string>[]> = {};
    for (const [tab, rows] of Object.entries(rawData)) data[tab] = tab === leadsKey ? visible : (["admin", "regional_manager", "readonly"].includes(user.role) ? rows : scopedRows(rows, leadIds, phones));
    if (leadsKey !== "Leads") data.Leads = visible;
    return NextResponse.json({ connected: true, stale: false, spreadsheet: metadata.properties?.title || sheetId, data, fetchedAt: new Date().toISOString(), user }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("CRM workbook read failed", error);
    return NextResponse.json({ connected: false, stale: false, error: error instanceof Error ? error.message : "CRM connection unavailable.", data: {}, fetchedAt: new Date().toISOString(), user }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
