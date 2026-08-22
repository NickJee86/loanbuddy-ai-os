const GOOGLE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
import { idempotencyMetadataCandidates } from "./idempotency-metadata.mjs";
import {
  googleSheetsBatchWriteBody,
  googleSheetsWriteSuffix,
} from "./spreadsheet-write-policy.mjs";

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

async function safeFetch(input: string, init: RequestInit = {}) {
  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(input, {
      ...init,
      signal: AbortSignal.timeout(10000),
    });
    if (!RETRYABLE.has(response.status) || attempt === 2) return response;
    await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
  }
  if (!response) throw new Error("Google request did not return a response.");
  return response;
}

async function accessToken(account: ServiceAccount) {
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
  const response = await safeFetch(audience, {
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

export async function writableSheetContext() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!raw || !sheetId) throw new Error("CRM connection is not configured.");
  return {
    sheetId,
    token: await accessToken(JSON.parse(raw) as ServiceAccount),
  };
}

export async function readSheetValues(
  sheetId: string,
  token: string,
  range: string,
) {
  const response = await safeFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (response.status === 400) return [];
  if (!response.ok)
    throw new Error(`Unable to read ${range} (${response.status}).`);
  return ((await response.json()) as { values?: string[][] }).values || [];
}

export async function writeSheetValues(
  sheetId: string,
  token: string,
  range: string,
  values: string[][],
  append = false,
) {
  const suffix = googleSheetsWriteSuffix(append);
  const response = await safeFetch(
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

export async function writeSheetValueRanges(
  sheetId: string,
  token: string,
  data: Array<{ range: string; values: string[][] }>,
) {
  const response = await safeFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchUpdate`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(googleSheetsBatchWriteBody(data)),
    },
  );
  if (!response.ok)
    throw new Error(
      `Unable to update the required spreadsheet ranges (${response.status}).`,
    );
}

export async function claimSpreadsheetIdempotency(
  sheetId: string,
  token: string,
  namespace: string,
  key: string,
) {
  for (const metadataId of idempotencyMetadataCandidates(namespace, key)) {
    const response = await safeFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}:batchUpdate`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          requests: [
            {
              createDeveloperMetadata: {
                developerMetadata: {
                  metadataId,
                  metadataKey: namespace,
                  metadataValue: key,
                  location: { spreadsheet: true },
                  visibility: "DOCUMENT",
                },
              },
            },
          ],
        }),
      },
    );
    if (response.ok) return { claimed: true, metadataId };
    if (![400, 409].includes(response.status))
      throw new Error(
        `Unable to reserve the idempotency key (${response.status}).`,
      );

    const existing = await safeFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/developerMetadata/${metadataId}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!existing.ok)
      throw new Error(
        `Unable to verify the idempotency reservation (${existing.status}).`,
      );
    const metadata = (await existing.json()) as {
      metadataKey?: string;
      metadataValue?: string;
    };
    if (metadata.metadataKey === namespace && metadata.metadataValue === key)
      return { claimed: false, metadataId };
  }
  throw new Error(
    "Unable to allocate a collision-free idempotency reservation.",
  );
}

export async function releaseSpreadsheetIdempotency(
  sheetId: string,
  token: string,
  metadataId: number,
) {
  const response = await safeFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}:batchUpdate`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        requests: [
          {
            deleteDeveloperMetadata: {
              dataFilter: { developerMetadataLookup: { metadataId } },
            },
          },
        ],
      }),
    },
  );
  if (!response.ok && response.status !== 404)
    throw new Error(
      `Unable to release the idempotency reservation (${response.status}).`,
    );
}

export async function listSpreadsheetMetadata(
  sheetId: string,
  token: string,
  namespace: string,
) {
  const response = await safeFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/developerMetadata:search`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        dataFilters: [
          {
            developerMetadataLookup: {
              metadataKey: namespace,
              visibility: "DOCUMENT",
            },
          },
        ],
      }),
    },
  );
  if (!response.ok)
    throw new Error(
      `Unable to inspect security metadata (${response.status}).`,
    );
  const body = (await response.json()) as {
    matchedDeveloperMetadata?: Array<{
      developerMetadata?: { metadataId?: number; metadataValue?: string };
    }>;
  };
  return (body.matchedDeveloperMetadata || [])
    .map((item) => item.developerMetadata)
    .filter((item): item is { metadataId: number; metadataValue?: string } =>
      Boolean(item?.metadataId),
    );
}

export async function deleteSpreadsheetMetadata(
  sheetId: string,
  token: string,
  metadataIds: number[],
) {
  if (!metadataIds.length) return;
  const response = await safeFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}:batchUpdate`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        requests: metadataIds.map((metadataId) => ({
          deleteDeveloperMetadata: {
            dataFilter: { developerMetadataLookup: { metadataId } },
          },
        })),
      }),
    },
  );
  if (!response.ok)
    throw new Error(
      `Unable to clean expired security metadata (${response.status}).`,
    );
}

export function rowsToRecords(values: string[][]) {
  const headers = values[0] || [];
  return values
    .slice(1)
    .filter((row) => row.some(Boolean))
    .map((row, index) => ({
      rowNumber: index + 2,
      record: Object.fromEntries(
        headers.map((header, column) => [header, row[column] || ""]),
      ) as Record<string, string>,
    }));
}

export async function appendAudit(
  sheetId: string,
  token: string,
  action: string,
  actor: string,
  leadId = "",
  raw = "",
) {
  const headers =
    (await readSheetValues(sheetId, token, "Audit_Log!A1:Z1"))[0] || [];
  if (!headers.length) return;
  const record: Record<string, string> = {
    "Audit ID": `CRM-${crypto.randomUUID()}`,
    Timestamp: new Date().toISOString(),
    Scenario: "CRM",
    Module: actor,
    "Lead ID": leadId || "N/A",
    Action: action,
    Result: "SUCCESS",
    "Error Message": "",
    "Raw Data": raw,
  };
  await writeSheetValues(
    sheetId,
    token,
    "Audit_Log!A:Z",
    [headers.map((header) => record[header] || "")],
    true,
  );
}
