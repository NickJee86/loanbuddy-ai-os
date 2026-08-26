import { NextRequest, NextResponse } from "next/server";
import { sessionCookieName, verifySession } from "../../../auth";
import { GOOGLE_SHEETS_VALUE_INPUT_OPTION } from "../../../spreadsheet-write-policy.mjs";

export const runtime = "nodejs";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const ROUTING_HEADERS = [
"Processing Route",
"Case Visibility",
"Escalation Reason",
"Detected Region",
"Assignment Trigger",
"Automation Updated At",
"LMS Submission ID",
"LMS Submitted At",
"LMS Error",
];
const CONVERSATION_HEADERS = ["Detected Region"];
type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

function base64url(input: string | ArrayBuffer) {
const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
let binary = ""; bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function accessToken(account: ServiceAccount) {
const now = Math.floor(Date.now() / 1000); const audience = account.token_uri || "https://oauth2.googleapis.com/token";
const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
const claims = base64url(JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: audience, iat: now, exp: now + 3600 }));
const pem = account.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), (char) => char.charCodeAt(0)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
const response = await fetch(audience, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${base64url(signature)}` }) });
if (!response.ok) throw new Error(`Google authentication failed (${response.status}).`);
return ((await response.json()) as { access_token: string }).access_token;
}

function columnName(index: number) {
let value = index + 1; let name = "";
while (value > 0) { const remainder = (value - 1) % 26; name = String.fromCharCode(65 + remainder) + name; value = Math.floor((value - 1) / 26); }
return name;
}

export async function POST(request: NextRequest) {
try {
const user = await verifySession(request.cookies.get(sessionCookieName())?.value);
if (!user || !["admin", "regional_manager"].includes(user.role)) return NextResponse.json({ error: "Regional Manager or Admin permission is required." }, { status: 403 });
const rawAccount = process.env.GOOGLE_SERVICE_ACCOUNT_JSON; const sheetId = process.env.GOOGLE_SHEET_ID;
if (!rawAccount || !sheetId) return NextResponse.json({ error: "CRM connection is not configured." }, { status: 503 });
const token = await accessToken(JSON.parse(rawAccount) as ServiceAccount);
const read = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent("Leads!A1:CZ")}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`, { headers: { authorization: `Bearer ${token}` } });
if (!read.ok) throw new Error(`Unable to read Leads (${read.status}).`);
const values = ((await read.json()) as { values?: string[][] }).values || [];
const headers = values[0] || [];
const missing = ROUTING_HEADERS.filter((header) => !headers.includes(header));
const now = new Date().toISOString();
let migrated = 0;
if (missing.length) {
const start = headers.length; const end = start + missing.length - 1;
const output: string[][] = [missing];
for (const row of values.slice(1)) {
const assignedSales = row[headers.indexOf("Assigned Sales ID")] || "";
const escalation = row[headers.indexOf("Escalation Reason")] || "";
const source = String(row[headers.indexOf("Source")] || "").trim().toUpperCase();
const manualSource = row[headers.indexOf("Manual Source Detail")] || "";
const route = assignedSales || escalation || source === "CRM_MANUAL" || manualSource
  ? "SA_ASSIST"
  : "AI_DIRECT";
const mapped: Record<string, string> = {
"Processing Route": route,
"Case Visibility": route === "AI_DIRECT" ? "REGIONAL_ADMIN_ONLY" : "BRANCH_SA",
"Escalation Reason": route === "SA_ASSIST" ? "LEGACY_ASSIGNED_CASE" : "",
"Detected Region": "",
"Assignment Trigger": route === "SA_ASSIST" ? "LEGACY_ASSIGNMENT" : "AI_AUTOMATION",
"Automation Updated At": now,
};
output.push(missing.map((header) => mapped[header] || ""));
}
const range = `Leads!${columnName(start)}1:${columnName(end)}${Math.max(output.length, 1)}`;
const write = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}?valueInputOption=${GOOGLE_SHEETS_VALUE_INPUT_OPTION}`, { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ values: output }) });
if (!write.ok) throw new Error(`Unable to add routing fields (${write.status}).`);
migrated = Math.max(output.length - 1, 0);
}

const conversationRead = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent("Conversation_State!A1:CZ1")}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`, { headers: { authorization: `Bearer ${token}` } });
if (!conversationRead.ok) throw new Error(`Unable to read Conversation_State (${conversationRead.status}).`);
const conversationValues = ((await conversationRead.json()) as { values?: string[][] }).values || [];
const conversationHeaders = conversationValues[0] || [];
const conversationMissing = CONVERSATION_HEADERS.filter((header) => !conversationHeaders.includes(header));
if (conversationMissing.length) {
const conversationStart = conversationHeaders.length;
const conversationEnd = conversationStart + conversationMissing.length - 1;
const conversationRange = `Conversation_State!${columnName(conversationStart)}1:${columnName(conversationEnd)}1`;
const conversationWrite = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(conversationRange)}?valueInputOption=${GOOGLE_SHEETS_VALUE_INPUT_OPTION}`, { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ values: [conversationMissing] }) });
if (!conversationWrite.ok) throw new Error(`Unable to add conversation routing fields (${conversationWrite.status}).`);
}
return NextResponse.json({ ok: true, added: { leads: missing, conversation: conversationMissing }, migrated });
} catch (error) {
const message = error instanceof Error ? error.message : "Unable to migrate routing fields.";
console.error(`[crm-routing-migration] ${message}`);
return NextResponse.json({ error: message }, { status: 502 });
}
}
