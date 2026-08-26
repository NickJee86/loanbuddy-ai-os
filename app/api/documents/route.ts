import { NextRequest, NextResponse } from "next/server";
import { sessionCookieName, verifySession } from "../../auth";
import { detectSupportedDocumentMime } from "../../file-signature.mjs";
import { appendAudit } from "../../google-sheets-write";
import {
  canContinueManualApplication,
  canEditExistingApplication,
} from "../../access-control.mjs";
import { googleSheetsWriteSuffix } from "../../spreadsheet-write-policy.mjs";
import {
  CREDIT_BUREAU_CONSENT_TYPE,
  CREDIT_BUREAU_CONSENT_VERSION,
} from "../../credit-bureau-consent.mjs";
import { shouldProgressDocumentCollection } from "../../document-upload-policy.mjs";

export const runtime = "nodejs";

const GOOGLE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const DOCUMENT_TYPES = new Set([
  "IC_FRONT",
  "IC_BACK",
  "PAYSLIP",
  "BANK_STATEMENT",
  "EPF_STATEMENT",
  "CUSTOMER_CCRIS_REPORT",
  CREDIT_BUREAU_CONSENT_TYPE,
]);
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
type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

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

async function googleAccessToken(account: ServiceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const audience = account.token_uri || "https://oauth2.googleapis.com/token";
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: GOOGLE_SCOPE,
      aud: audience,
      iat: now,
      exp: now + 3600,
    }),
  );
  const pem = account.private_key.replace(
    /-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,
    "",
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(atob(pem), (char) => char.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  const response = await fetch(audience, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${base64url(signature)}`,
    }),
  });
  if (!response.ok)
    throw new Error(`Google authentication failed (${response.status}).`);
  return ((await response.json()) as { access_token: string }).access_token;
}

async function sheetValues(sheetId: string, token: string, range: string) {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!response.ok)
    throw new Error(`Unable to read ${range} (${response.status}).`);
  return ((await response.json()) as { values?: string[][] }).values || [];
}

async function writeRange(
  sheetId: string,
  token: string,
  range: string,
  values: string[][],
  append = false,
) {
  const suffix = googleSheetsWriteSuffix(append);
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}${suffix}`,
    {
      method: append ? "POST" : "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ values }),
    },
  );
  if (!response.ok)
    throw new Error(`Unable to write ${range} (${response.status}).`);
}

function safeFileName(value: string) {
  return (
    value
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 100) || "document"
  );
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
    await writeRange(
      sheetId,
      token,
      `${sheet}!A1:${columnName(headers.length - 1)}1`,
      [headers],
    );
  return headers;
}

async function microsoftAccessToken(
  tenantId: string,
  clientId: string,
  clientSecret: string,
) {
  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    },
  );
  if (!response.ok)
    throw new Error(`Microsoft authentication failed (${response.status}).`);
  return ((await response.json()) as { access_token: string }).access_token;
}

async function graphJson<T>(
  url: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  });
  if (!response.ok)
    throw new Error(`SharePoint request failed (${response.status}).`);
  return (await response.json()) as T;
}

async function sharePointTarget(
  token: string,
  hostname: string,
  sitePath: string,
  libraryName: string,
  folderName: string,
) {
  const site = await graphJson<{ id: string }>(
    `https://graph.microsoft.com/v1.0/sites/${hostname}:${sitePath}?$select=id`,
    token,
  );
  const drives = await graphJson<{
    value: Array<{ id: string; name: string }>;
  }>(
    `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(site.id)}/drives?$select=id,name`,
    token,
  );
  const drive =
    drives.value.find(
      (candidate) => candidate.name.toLowerCase() === libraryName.toLowerCase(),
    ) || drives.value.find((candidate) => /documents/i.test(candidate.name));
  if (!drive)
    throw new Error(
      `SharePoint document library '${libraryName}' was not found.`,
    );
  const folderPath = folderName.split("/").map(encodeURIComponent).join("/");
  const lookup = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(drive.id)}/root:/${folderPath}?$select=id`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (lookup.status === 404) {
    if (folderName.includes("/"))
      throw new Error(
        "Nested SharePoint upload folders must be created before use.",
      );
    await graphJson(
      `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(drive.id)}/root/children`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          name: folderName,
          folder: {},
          "@microsoft.graph.conflictBehavior": "fail",
        }),
      },
    );
  } else if (!lookup.ok)
    throw new Error(
      `Unable to open the SharePoint upload folder (${lookup.status}).`,
    );
  return { driveId: drive.id, folderPath };
}

async function uploadToSharePoint(
  token: string,
  driveId: string,
  folderPath: string,
  leadId: string,
  documentType: string,
  file: File,
) {
  const name = `${leadId}_${documentType}_${Date.now()}_${safeFileName(file.name)}`;
  const encodedName = encodeURIComponent(name);
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/root:/${folderPath}/${encodedName}:/content?$select=id,name,size,webUrl,createdDateTime,file`,
    {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": file.type },
      body: file,
    },
  );
  if (!response.ok)
    throw new Error(`SharePoint upload failed (${response.status}).`);
  return (await response.json()) as {
    id: string;
    name: string;
    size?: number;
    webUrl?: string;
    createdDateTime?: string;
    file?: { mimeType?: string };
  };
}

async function deleteSharePointUpload(
  token: string,
  driveId: string,
  itemId: string,
) {
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`,
    { method: "DELETE", headers: { authorization: `Bearer ${token}` } },
  );
  if (!response.ok && response.status !== 404)
    throw new Error(`SharePoint rollback failed (${response.status}).`);
}

export async function POST(request: NextRequest) {
  try {
    const user = await verifySession(
      request.cookies.get(sessionCookieName())?.value,
    );
    if (!user || user.role === "readonly")
      return NextResponse.json(
        { error: "Document upload permission is required." },
        { status: 403 },
      );
    const form = await request.formData();
    const leadId = String(form.get("leadId") || "").trim();
    const documentType = String(form.get("documentType") || "").trim();
    const file = form.get("file");
    if (!leadId || !DOCUMENT_TYPES.has(documentType))
      return NextResponse.json(
        { error: "Valid Lead ID and document type are required." },
        { status: 400 },
      );
    if (!(file instanceof File) || !file.size)
      return NextResponse.json(
        { error: "Select a document to upload." },
        { status: 400 },
      );
    if (file.size > MAX_FILE_SIZE)
      return NextResponse.json(
        { error: "Each document must be 10 MB or smaller." },
        { status: 413 },
      );
    if (!ALLOWED_TYPES.has(file.type))
      return NextResponse.json(
        { error: "Only PDF, JPG and PNG files are accepted." },
        { status: 415 },
      );
    const detectedMime = detectSupportedDocumentMime(
      await file.slice(0, 16).arrayBuffer(),
    );
    if (!detectedMime || detectedMime !== file.type)
      return NextResponse.json(
        {
          error:
            "The file content does not match a valid PDF, JPG or PNG document.",
        },
        { status: 415 },
      );

    const rawAccount = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const tenantId = process.env.MICROSOFT_TENANT_ID;
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    const siteHost =
      process.env.SHAREPOINT_SITE_HOST || "rexmgt.sharepoint.com";
    const sitePath = process.env.SHAREPOINT_SITE_PATH || "/sites/Loanbuddy";
    const libraryName = process.env.SHAREPOINT_LIBRARY || "Documents";
    const uploadFolder =
      process.env.SHAREPOINT_UPLOAD_FOLDER ||
      "LoanBuddy CRM Customer Documents";
    if (!rawAccount || !sheetId || !tenantId || !clientId || !clientSecret)
      return NextResponse.json(
        { error: "Secure SharePoint document storage is not configured." },
        { status: 503 },
      );
    const googleToken = await googleAccessToken(
      JSON.parse(rawAccount) as ServiceAccount,
    );
    const leads = await sheetValues(sheetId, googleToken, "Leads!A1:CZ");
    const isCreditBureauConsent =
      documentType === CREDIT_BUREAU_CONSENT_TYPE;
    const headers = isCreditBureauConsent
      ? await ensureHeaders(
          sheetId,
          googleToken,
          "Leads",
          leads[0] || [],
          CONSENT_LEAD_HEADERS,
        )
      : leads[0] || [];
    leads[0] = headers;
    const idIndex = headers.indexOf("Lead ID");
    const rowIndex = leads.slice(1).findIndex((row) => row[idIndex] === leadId);
    if (rowIndex < 0)
      return NextResponse.json(
        { error: "Save the application before uploading documents." },
        { status: 404 },
      );
    const existing = leads[rowIndex + 1];
    const leadRecord = Object.fromEntries(
      headers.map((header, index) => [header, existing[index] || ""]),
    ) as Record<string, string>;
    const canUpload = isCreditBureauConsent
      ? canEditExistingApplication(user, leadRecord)
      : canContinueManualApplication(user, leadRecord);
    if (!canUpload)
      return NextResponse.json(
        {
          error:
            isCreditBureauConsent
              ? "Consent upload is limited to an authorised user with access to this case."
              : "Document upload is limited to an authorized SA-assisted draft or a case returned for documents.",
        },
        { status: 403 },
      );

    const microsoftToken = await microsoftAccessToken(
      tenantId,
      clientId,
      clientSecret,
    );
    const target = await sharePointTarget(
      microsoftToken,
      siteHost,
      sitePath,
      libraryName,
      uploadFolder,
    );
    const uploaded = await uploadToSharePoint(
      microsoftToken,
      target.driveId,
      target.folderPath,
      leadId,
      documentType,
      file,
    );
    const now = new Date().toISOString();
    const fileUrl = uploaded.webUrl || "";
    try {
      const log = await sheetValues(
        sheetId,
        googleToken,
        "Document_Received_Log!A1:CZ1",
      );
      const logHeaders = isCreditBureauConsent
        ? await ensureHeaders(
            sheetId,
            googleToken,
            "Document_Received_Log",
            log[0] || [],
            CONSENT_LOG_HEADERS,
          )
        : log[0] || [];
      if (!logHeaders.length)
        throw new Error("Document_Received_Log header is unavailable.");
      const record: Record<string, string> = {
        "Lead ID": leadId,
        "Document Type": documentType,
        "File Name": uploaded.name,
        "Original File Name": file.name,
        "File URL": fileUrl,
        "SharePoint File ID": uploaded.id,
        "Drive File ID": uploaded.id,
        "MIME Type": file.type,
        "File Size": String(file.size),
        "Received Date": now,
        "Created Date": now,
        "Uploaded By": user.username,
        "Staff ID": user.salesId || user.username,
        Source: "CRM_MANUAL_UPLOAD",
        Status: "RECEIVED",
        "Verification Status": "PENDING",
        ...(isCreditBureauConsent
          ? {
              "Consent Version": CREDIT_BUREAU_CONSENT_VERSION,
              "Consent Purpose":
                "CREDIT_ACCOUNT_EVALUATION_AND_AUTHORISED_CCRIS_CHECK",
            }
          : {}),
      };
      await writeRange(
        sheetId,
        googleToken,
        "Document_Received_Log!A:CZ",
        [logHeaders.map((header) => record[header] || "")],
        true,
      );
    } catch (logError) {
      try {
        await deleteSharePointUpload(
          microsoftToken,
          target.driveId,
          uploaded.id,
        );
      } catch (rollbackError) {
        console.error(
          "[crm-document-upload] Unable to roll back an unlogged SharePoint upload.",
          rollbackError,
        );
      }
      throw logError;
    }

    const statusFields: Record<string, string[]> = {
      IC_FRONT: ["IC Front Status", "IC Status"],
      IC_BACK: ["IC Back Status", "IC Status"],
      PAYSLIP: ["Payslip Status"],
      BANK_STATEMENT: ["Bank Statement Status"],
      EPF_STATEMENT: ["EPF Status"],
      [CREDIT_BUREAU_CONSENT_TYPE]: ["Credit Bureau Consent Status"],
    };
    for (const field of statusFields[documentType] || [])
      if (headers.includes(field)) leadRecord[field] = "RECEIVED";
    if (isCreditBureauConsent) {
      leadRecord["Credit Bureau Consent Status"] = "RECEIVED";
      leadRecord["Credit Bureau Consent Version"] =
        CREDIT_BUREAU_CONSENT_VERSION;
      leadRecord["Credit Bureau Consent Received At"] = now;
      leadRecord["Credit Bureau Consent Verified At"] = "";
      leadRecord["Credit Bureau Consent Verified By"] = "";
      leadRecord["Credit Bureau Consent Revoked At"] = "";
    } else if (
      shouldProgressDocumentCollection(documentType) &&
      headers.includes("Document Status")
    )
      leadRecord["Document Status"] = "IN_PROGRESS";
    if (headers.includes("Last AI Update")) leadRecord["Last AI Update"] = now;
    let leadSync = true;
    try {
      await writeRange(
        sheetId,
        googleToken,
        `Leads!A${rowIndex + 2}:CZ${rowIndex + 2}`,
        [headers.map((header) => leadRecord[header] || "")],
      );
    } catch (leadError) {
      leadSync = false;
      console.error(
        "[crm-document-upload] Document logged but Lead summary sync failed.",
        leadError,
      );
    }
    try {
      await appendAudit(
        sheetId,
        googleToken,
        isCreditBureauConsent
          ? "CRM_CREDIT_BUREAU_CONSENT_UPLOADED"
          : "CRM_DOCUMENT_UPLOADED",
        user.username,
        leadId,
        documentType,
      );
    } catch (auditError) {
      console.error(
        "[crm-document-upload] Document stored but central audit append failed.",
        auditError,
      );
    }
    return NextResponse.json({
      ok: true,
      leadId,
      documentType,
      fileName: uploaded.name,
      fileUrl,
      status: "RECEIVED",
      leadSync,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to upload document.";
    console.error(`[crm-document-upload] ${message}`);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
