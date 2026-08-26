import { NextRequest, NextResponse } from "next/server";
import { configuredUsers, sessionCookieName, verifySession } from "../../auth";
import { filterCrmDataForUser } from "../../access-control.mjs";
import { mergeBranchRows } from "../../crm-normalization.mjs";

export const runtime = "nodejs";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};
type SheetRow = Record<string, string>;
type GoogleSnapshot = {
  title: string;
  tabs: string[];
  rawData: Record<string, SheetRow[]>;
  expiresAt: number;
  loadedAt: number;
};

let snapshotCache: GoogleSnapshot | null = null;
const transientStatus = new Set([429, 500, 502, 503, 504]);

async function googleFetch(input: string, init: RequestInit = {}) {
  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await fetch(input, {
        ...init,
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      continue;
    }
    if (!transientStatus.has(response.status) || attempt === 2) return response;
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }
  if (!response) throw new Error("Google request did not return a response.");
  return response;
}

function base64url(input: string | ArrayBuffer) {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : new Uint8Array(input);
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function getAccessToken(account: ServiceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const audience = account.token_uri || "https://oauth2.googleapis.com/token";
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: SCOPE,
      aud: audience,
      iat: now,
      exp: now + 3600,
    }),
  );
  const pem = account.private_key.replace(
    /-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,
    "",
  );
  const keyBytes = Uint8Array.from(atob(pem), (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  const assertion = `${header}.${claims}.${base64url(signature)}`;
  const response = await googleFetch(audience, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok)
    throw new Error(`Google authentication failed (${response.status})`);
  return ((await response.json()) as { access_token: string }).access_token;
}

function rowsToObjects(values: string[][]) {
  if (values.length < 2) return [];
  const headers = values[0].map((header) => String(header || "").trim());
  return values
    .slice(1)
    .filter((row) => row.some(Boolean))
    .map((row) =>
      Object.fromEntries(
        headers.map((header, index) => [
          header || `Column ${index + 1}`,
          row[index] ?? "",
        ]),
      ),
    );
}

async function loadSnapshot(
  sheetId: string,
  account: ServiceAccount,
  forceRefresh = false,
) {
  if (!forceRefresh && snapshotCache && snapshotCache.expiresAt > Date.now())
    return snapshotCache;
  const token = await getAccessToken(account);
  const metadata = await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}?fields=properties.title,sheets.properties.title`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!metadata.ok)
    throw new Error(`Unable to open spreadsheet (${metadata.status})`);
  const meta = (await metadata.json()) as {
    properties?: { title?: string };
    sheets?: Array<{ properties?: { title?: string } }>;
  };
  const tabs = (meta.sheets || [])
    .map((sheet) => sheet.properties?.title || "")
    .filter(Boolean);
  const wanted = [
    "Branch_Master",
    "Leads",
    "Lead_Activities",
    "Conversation_State",
    "Customer_Inbox",
    "Customer_Reply_Log",
    "Message_Outbox",
    "Document_Received_Log",
    "Document_Verification_Log",
    "Document_Request_Log",
    "Lead_Scoring_Log",
    "Product_Credit_Policy",
    "System_Config",
    "Credit_Assessment",
    "Credit_Decision_Log",
    "LMS_Credit_Result",
    "LMS_Submission_Queue",
    "Follow_Up_Queue",
    "Escalation_Log",
    "Audit_Log",
  ];
  const available = wanted.filter((tab) => tabs.includes(tab));
  const query = new URLSearchParams({
    majorDimension: "ROWS",
    valueRenderOption: "FORMATTED_VALUE",
  });
  for (const tab of available) query.append("ranges", `${tab}!A1:CZ`);
  const batch = await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchGet?${query}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!batch.ok) throw new Error(`Unable to read CRM tables (${batch.status})`);
  const body = (await batch.json()) as {
    valueRanges?: Array<{ values?: string[][] }>;
  };
  const rawData = Object.fromEntries(
    available.map((tab, index) => [
      tab,
      rowsToObjects(body.valueRanges?.[index]?.values || []),
    ]),
  ) as Record<string, SheetRow[]>;
  const loadedAt = Date.now();
  snapshotCache = {
    title: meta.properties?.title || "LoanBuddy CRM",
    tabs,
    rawData,
    expiresAt: loadedAt + 30000,
    loadedAt,
  };
  return snapshotCache;
}

export async function GET(request: NextRequest) {
  const user = await verifySession(
    request.cookies.get(sessionCookieName())?.value,
  );
  if (!user)
    return NextResponse.json(
      { connected: false, error: "Unauthenticated" },
      { status: 401 },
    );
  try {
    const rawAccount = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const sheetId = process.env.GOOGLE_SHEET_ID;
    if (!rawAccount || !sheetId)
      return NextResponse.json(
        { connected: false, error: "CRM connection is not configured.", user },
        { status: 503 },
      );
    let snapshot: GoogleSnapshot;
    let stale = false;
    try {
      snapshot = await loadSnapshot(
        sheetId,
        JSON.parse(rawAccount) as ServiceAccount,
        request.nextUrl.searchParams.get("refresh") === "1",
      );
    } catch (error) {
      if (!snapshotCache || Date.now() - snapshotCache.loadedAt > 5 * 60 * 1000)
        throw error;
      snapshot = snapshotCache;
      stale = true;
    }
    const rawData = { ...snapshot.rawData };
    if (user.role === "admin" || user.role === "regional_manager") {
      rawData.Branch_Master = mergeBranchRows(
        rawData.Branch_Master || [],
        configuredUsers(),
      );
    }
    const { data } = filterCrmDataForUser(user, rawData);
    return NextResponse.json(
      {
        connected: true,
        spreadsheet: snapshot.title,
        tabs: snapshot.tabs,
        data,
        user,
        stale,
        fetchedAt: new Date().toISOString(),
        dataUpdatedAt: new Date(snapshot.loadedAt).toISOString(),
      },
      {
        headers: {
          "cache-control": "no-store, max-age=0, must-revalidate",
          vary: "Cookie",
        },
      },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to read CRM data.";
    // Log only the safe failure category/status. Credentials and response bodies are never logged.
    console.error(`[crm-readonly] ${message}`);
    return NextResponse.json(
      { connected: false, error: message, user },
      { status: 502 },
    );
  }
}
