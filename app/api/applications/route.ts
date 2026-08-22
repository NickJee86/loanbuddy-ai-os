import { NextRequest, NextResponse } from "next/server";
import { sessionCookieName, verifySession } from "../../auth";
import {
  evaluateVerificationApproval,
  missingRequiredDocuments,
} from "../../application-guard.mjs";
import {
  normalizeMalaysianMobile,
  validReassignmentTarget,
} from "../../input-validation.mjs";
import { buildManualApplicationRecord } from "../../manual-application.mjs";
import {
  canContinueManualApplication,
  canEditExistingApplication,
  inferProcessingRoute,
} from "../../access-control.mjs";
import {
  appendMissingHeaders,
  buildConversationStateRecord,
  CONVERSATION_STATE_HEADERS,
  creditDataGaps,
  MANUAL_LEAD_HEADERS,
} from "../../manual-qualification.mjs";
import {
  appendAudit,
  claimSpreadsheetIdempotency,
  releaseSpreadsheetIdempotency,
} from "../../google-sheets-write";
import { googleSheetsWriteSuffix } from "../../spreadsheet-write-policy.mjs";

export const runtime = "nodejs";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};
type Intake = Record<string, string> & {
  action?: "draft" | "submit";
  leadId?: string;
  operation?: "approve" | "return" | "reassign" | "note";
};

const ACTIVITY_HEADERS = Object.freeze([
  "Lead ID",
  "Activity Type",
  "Activity Date",
  "Created Date",
  "Created By",
  "Staff ID",
  "Description",
]);

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
async function accessToken(account: ServiceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const audience = account.token_uri || "https://oauth2.googleapis.com/token";
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
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
  if (!response.ok) throw new Error("Google authentication failed.");
  return ((await response.json()) as { access_token: string }).access_token;
}
async function sheetValues(sheetId: string, token: string, range: string) {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!response.ok) throw new Error(`Unable to read ${range}.`);
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
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}${suffix}`,
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
function normalizePhone(value: string) {
  return value.replace(/\D/g, "").replace(/^0/, "60");
}
function normalizeIc(value: string) {
  return String(value || "")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase();
}
function records(values: string[][]) {
  const headers = values[0] || [];
  return values
    .slice(1)
    .filter((row) => row.some(Boolean))
    .map(
      (row) =>
        Object.fromEntries(
          headers.map((header, index) => [header, row[index] || ""]),
        ) as Record<string, string>,
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

async function ensureColumnCapacity(
  spreadsheetId: string,
  token: string,
  sheet: string,
  requiredColumns: number,
) {
  const metadata = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(sheetId,title,gridProperties(columnCount))`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!metadata.ok)
    throw new Error(`Unable to inspect ${sheet} column capacity.`);
  const body = (await metadata.json()) as {
    sheets?: Array<{
      properties?: {
        sheetId?: number;
        title?: string;
        gridProperties?: { columnCount?: number };
      };
    }>;
  };
  const target = (body.sheets || []).find(
    (item) => item.properties?.title === sheet,
  )?.properties;
  if (typeof target?.sheetId !== "number")
    throw new Error(`${sheet} metadata is unavailable.`);
  const currentColumns = target.gridProperties?.columnCount || 0;
  if (currentColumns >= requiredColumns) return;
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        requests: [
          {
            appendDimension: {
              sheetId: target.sheetId,
              dimension: "COLUMNS",
              length: requiredColumns - currentColumns,
            },
          },
        ],
      }),
    },
  );
  if (!response.ok)
    throw new Error(`Unable to expand ${sheet} for CRM intake fields.`);
}

async function ensureSheetHeaders(
  sheetId: string,
  token: string,
  sheet: string,
  current: string[],
  required: readonly string[],
) {
  const next = appendMissingHeaders(current, [...required]);
  if (next.length !== current.length) {
    await ensureColumnCapacity(sheetId, token, sheet, next.length);
    await writeRange(
      sheetId,
      token,
      `${sheet}!A1:${columnName(next.length - 1)}1`,
      [next],
    );
  }
  return next;
}

async function appendLeadActivity(
  sheetId: string,
  token: string,
  activity: Record<string, string>,
) {
  const values = await sheetValues(sheetId, token, "Lead_Activities!A1:CZ1");
  const headers = await ensureSheetHeaders(
    sheetId,
    token,
    "Lead_Activities",
    values[0] || [],
    ACTIVITY_HEADERS,
  );
  await writeRange(
    sheetId,
    token,
    `Lead_Activities!A:${columnName(headers.length - 1)}`,
    [headers.map((header) => activity[header] || "")],
    true,
  );
}

export async function POST(request: NextRequest) {
  try {
    const user = await verifySession(
      request.cookies.get(sessionCookieName())?.value,
    );
    if (!user || user.role === "readonly")
      return NextResponse.json(
        { error: "You do not have permission to create applications." },
        { status: 403 },
      );
    const body = (await request.json()) as Intake;
    if (
      body.operation &&
      !["approve", "return", "reassign", "note"].includes(body.operation)
    )
      return NextResponse.json(
        { error: "Unsupported application operation." },
        { status: 400 },
      );
    if (!body.operation && !["draft", "submit"].includes(body.action || ""))
      return NextResponse.json(
        { error: "Application action must be draft or submit." },
        { status: 400 },
      );
    const required = body.operation
      ? []
      : ["Lead Name", "Phone Number", "Branch ID", "Monthly Income"];
    if (body.action === "submit")
      required.push("IC Number", "Employment Status", "Salary Bank In");
    const missing = required.filter(
      (field) => !String(body[field] || "").trim(),
    );
    if (missing.length)
      return NextResponse.json(
        { error: `Missing required fields: ${missing.join(", ")}` },
        { status: 400 },
      );
    if (!body.operation) {
      const normalizedPhone = normalizeMalaysianMobile(body["Phone Number"]);
      if (!normalizedPhone)
        return NextResponse.json(
          {
            error:
              "Enter a valid Malaysian mobile number, for example 60123456789.",
          },
          { status: 400 },
        );
      body["Phone Number"] = normalizedPhone;
    }
    const rawAccount = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const sheetId = process.env.GOOGLE_SHEET_ID;
    if (!rawAccount || !sheetId)
      return NextResponse.json(
        { error: "CRM connection is not configured." },
        { status: 503 },
      );
    const token = await accessToken(JSON.parse(rawAccount) as ServiceAccount);
    const [values, conversationValues, documentValues, verificationValues, userValues] =
      await Promise.all([
        sheetValues(sheetId, token, "Leads!A1:CZ"),
        sheetValues(sheetId, token, "Conversation_State!A1:CZ"),
        sheetValues(sheetId, token, "Document_Received_Log!A1:CZ"),
        sheetValues(sheetId, token, "Document_Verification_Log!A1:CZ"),
        sheetValues(sheetId, token, "CRM_Users!A1:I"),
      ]);
    const documentRows = records(documentValues);
    const verificationRows = records(verificationValues);
    const crmUsers = records(userValues);
    let headers = values[0] || [];
    if (!headers.includes("Lead ID"))
      throw new Error("Leads header is invalid.");
    if (!body.operation) {
      headers = await ensureSheetHeaders(
        sheetId,
        token,
        "Leads",
        headers,
        MANUAL_LEAD_HEADERS,
      );
      values[0] = headers;
    }
    const phoneIndex = headers.indexOf("Phone Number");
    const icIndex = headers.indexOf("IC Number");
    const idIndex = headers.indexOf("Lead ID");
    if (body.operation) {
      if (!body.leadId)
        return NextResponse.json(
          { error: "Lead ID is required." },
          { status: 400 },
        );
      const rowIndex = values
        .slice(1)
        .findIndex((row) => row[idIndex] === body.leadId);
      if (rowIndex < 0)
        return NextResponse.json({ error: "Lead not found." }, { status: 404 });
      const existing = values[rowIndex + 1];
      const branchIndex = headers.indexOf("Branch ID");
      const record = Object.fromEntries(
        headers.map((header, index) => [header, existing[index] || ""]),
      ) as Record<string, string>;
      const now = new Date().toISOString();
      const processingRoute = inferProcessingRoute(record);
      if (body.operation === "note") {
        const note = String(body.note || body.reason || "").trim();
        if (!canEditExistingApplication(user, record))
          return NextResponse.json(
            { error: "Case access denied." },
            { status: 403 },
          );
        if (!note || note.length > 2000)
          return NextResponse.json(
            { error: "Enter a case note between 1 and 2,000 characters." },
            { status: 400 },
          );
        await appendLeadActivity(sheetId, token, {
          "Lead ID": body.leadId,
          "Activity Type": "CASE_NOTE",
          "Activity Date": now,
          "Created Date": now,
          "Created By": user.username,
          "Staff ID": user.salesId || user.username,
          Description: note,
        });
        try {
          await appendAudit(
            sheetId,
            token,
            "CRM_CASE_NOTE_ADDED",
            user.username,
            body.leadId,
          );
        } catch (auditError) {
          console.error(
            "[crm-application] Case note saved but central audit append failed.",
            auditError,
          );
        }
        return NextResponse.json({
          ok: true,
          leadId: body.leadId,
          status: "NOTE_ADDED",
        });
      }
      if (!["admin", "regional_manager", "manager"].includes(user.role))
        return NextResponse.json(
          { error: "Manager permission is required." },
          { status: 403 },
        );
      if (
        user.role === "manager" &&
        (processingRoute !== "SA_ASSIST" ||
          !user.branchIds.includes(existing[branchIndex] || ""))
      )
        return NextResponse.json(
          { error: "Branch access denied." },
          { status: 403 },
        );
      if (body.operation === "approve") {
        const approval = evaluateVerificationApproval({
          lead: record,
          receivedRows: documentRows,
          verificationRows,
        });
        if (!approval.eligible)
          return NextResponse.json(
            {
              error:
                "Verification approval is locked until all required documents and AI verification checks have passed.",
              reasons: approval.reasons,
            },
            { status: 409 },
          );
        record["Lead Status"] = "VERIFICATION_APPROVED";
        record["Current Stage"] = "CREDIT_ASSESSMENT";
      }
      if (body.operation === "return") {
        if (!body.reason?.trim())
          return NextResponse.json(
            { error: "Return reason is required." },
            { status: 400 },
          );
        record["Lead Status"] = "RETURNED_FOR_DOCUMENTS";
        record["Current Stage"] = "DOCUMENT_COLLECTION";
        record["AI Assessment"] = body.reason;
      }
      if (body.operation === "reassign") {
        if (!body["Assigned Sales ID"]?.trim())
          return NextResponse.json(
            { error: "Sales ID is required." },
            { status: 400 },
          );
        const target = validReassignmentTarget({
          salesId: body["Assigned Sales ID"],
          branchId: record["Branch ID"],
          users: crmUsers,
        });
        if (!target)
          return NextResponse.json(
            {
              error:
                "Reassignment requires an active Staff account in the same branch.",
            },
            { status: 409 },
          );
        record["Assigned Sales ID"] = String(target["Sales ID"] || "")
          .trim()
          .toUpperCase();
        record["Processing Route"] = "SA_ASSIST";
        record["Case Visibility"] = "BRANCH_SA";
        record["Escalation Reason"] = body.reason || "MANUAL_REASSIGNMENT";
      }
      record["Last AI Update"] = now;
      await writeRange(
        sheetId,
        token,
        `Leads!A${rowIndex + 2}:CZ${rowIndex + 2}`,
        [headers.map((header) => record[header] || "")],
      );
      try {
        await appendLeadActivity(sheetId, token, {
          "Lead ID": body.leadId,
          "Activity Type": `MANAGER_${body.operation.toUpperCase()}`,
          "Activity Date": now,
          "Created Date": now,
          "Created By": user.username,
          "Staff ID": user.username,
          Description:
            body.reason || `${user.name} performed ${body.operation}.`,
        });
      } catch {
        /* Preserve the lead action if optional audit logging is unavailable. */
      }
      try {
        await appendAudit(
          sheetId,
          token,
          `CRM_MANAGER_${body.operation.toUpperCase()}`,
          user.username,
          body.leadId,
        );
      } catch (auditError) {
        console.error(
          "[crm-application] Manager action completed but central audit append failed.",
          auditError,
        );
      }
      return NextResponse.json({
        ok: true,
        leadId: body.leadId,
        status: record["Lead Status"],
      });
    }
    const existingIndex = values
      .slice(1)
      .findIndex((candidate) => candidate[idIndex] === body.leadId);
    if (body.leadId && existingIndex < 0)
      return NextResponse.json({ error: "Lead not found." }, { status: 404 });
    const existingRecord =
      existingIndex >= 0
        ? Object.fromEntries(
            headers.map((header, index) => [
              header,
              values[existingIndex + 1]?.[index] || "",
            ]),
          )
        : {};
    if (
      existingIndex >= 0 &&
      !canContinueManualApplication(user, existingRecord)
    )
      return NextResponse.json(
        {
          error:
            "This application is outside your permitted case scope or is no longer editable.",
        },
        { status: 403 },
      );
    const duplicate = values
      .slice(1)
      .find(
        (row) =>
          (!body.leadId || row[idIndex] !== body.leadId) &&
          ((phoneIndex >= 0 &&
            normalizePhone(row[phoneIndex] || "") ===
              normalizePhone(body["Phone Number"])) ||
            (icIndex >= 0 &&
              body["IC Number"] &&
              normalizeIc(row[icIndex] || "") ===
                normalizeIc(body["IC Number"]))),
      );
    if (duplicate)
      return NextResponse.json(
        { error: "A possible duplicate application already exists." },
        { status: 409 },
      );
    const leadId =
      body.leadId ||
      `LB-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    if (body.action === "submit") {
      const missingDocuments = missingRequiredDocuments(leadId, documentRows);
      if (missingDocuments.length)
        return NextResponse.json(
          {
            error: `Upload required documents before submission: ${missingDocuments.join(", ")}.`,
            reasons: missingDocuments.map((type) => `MISSING_${type}`),
          },
          { status: 409 },
        );
    }
    const enforcedBranch =
      user.role === "staff"
        ? user.branchIds[0]
        : body["Branch ID"] || existingRecord["Branch ID"];
    if (user.role === "manager" && !user.branchIds.includes(enforcedBranch))
      return NextResponse.json(
        { error: "Branch access denied." },
        { status: 403 },
      );
    const now = new Date().toISOString();
    const conversationHeaders = await ensureSheetHeaders(
      sheetId,
      token,
      "Conversation_State",
      conversationValues[0] || [],
      CONVERSATION_STATE_HEADERS,
    );
    conversationValues[0] = conversationHeaders;
    const conversationLeadIndex = conversationHeaders.indexOf("Lead ID");
    if (conversationLeadIndex < 0)
      throw new Error("Conversation_State header is invalid.");
    const conversationIndex = conversationValues
      .slice(1)
      .findIndex((candidate) => candidate[conversationLeadIndex] === leadId);
    const existingConversation =
      conversationIndex >= 0
        ? Object.fromEntries(
            conversationHeaders.map((header, index) => [
              header,
              conversationValues[conversationIndex + 1]?.[index] || "",
            ]),
          )
        : {};
    const conversationRecord = buildConversationStateRecord({
      body,
      existing: existingConversation,
      leadId,
      now,
      documentStatus: existingRecord["Document Status"] || "IN_PROGRESS",
    }) as Record<string, string>;
    if (body.action === "submit") {
      const creditGaps = creditDataGaps(conversationRecord);
      if (creditGaps.length)
        return NextResponse.json(
          {
            error: `Complete required qualification and credit data: ${creditGaps.join(", ")}.`,
            reasons: creditGaps.map((field) =>
              `MISSING_${field.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`,
            ),
          },
          { status: 400 },
        );
    }
    const record = buildManualApplicationRecord({
      body,
      user,
      existing: existingRecord,
      leadId,
      now,
    }) as Record<string, string>;
    const row = headers.map((header) => record[header] ?? "");
    const reservations: number[] = [];
    const releaseReservations = async () => {
      const results = await Promise.allSettled(
        reservations.map((metadataId) =>
          releaseSpreadsheetIdempotency(sheetId, token, metadataId),
        ),
      );
      for (const result of results)
        if (result.status === "rejected")
          console.error(
            "[crm-application] Unable to release failed duplicate reservation.",
            result.reason,
          );
    };
    const currentPhone = normalizePhone(existingRecord["Phone Number"] || "");
    const requestedPhone = normalizePhone(body["Phone Number"]);
    const currentIc = normalizeIc(existingRecord["IC Number"] || "");
    const requestedIc = normalizeIc(body["IC Number"] || "");
    const keys = [
      ["LOANBUDDY_MANUAL_APPLICATION_PHONE", requestedPhone, currentPhone],
      ["LOANBUDDY_MANUAL_APPLICATION_IC", requestedIc, currentIc],
    ].filter(([, key, current]) => key && key !== current);
    try {
      for (const [namespace, key] of keys) {
        const reservation = await claimSpreadsheetIdempotency(
          sheetId,
          token,
          namespace,
          key,
        );
        if (!reservation.claimed) {
          await releaseReservations();
          return NextResponse.json(
            {
              error:
                "A possible duplicate application already exists or is being created.",
            },
            { status: 409 },
          );
        }
        reservations.push(reservation.metadataId);
      }
    } catch (reservationError) {
      await releaseReservations();
      throw reservationError;
    }
    try {
      if (existingIndex >= 0)
        await writeRange(
          sheetId,
          token,
          `Leads!A${existingIndex + 2}:CZ${existingIndex + 2}`,
          [row],
        );
      else await writeRange(sheetId, token, "Leads!A:CZ", [row], true);
      const conversationRow = conversationHeaders.map(
        (header) => conversationRecord[header] ?? "",
      );
      if (conversationIndex >= 0)
        await writeRange(
          sheetId,
          token,
          `Conversation_State!A${conversationIndex + 2}:${columnName(conversationHeaders.length - 1)}${conversationIndex + 2}`,
          [conversationRow],
        );
      else
        await writeRange(
          sheetId,
          token,
          `Conversation_State!A:${columnName(conversationHeaders.length - 1)}`,
          [conversationRow],
          true,
        );
    } catch (writeError) {
      await releaseReservations();
      throw writeError;
    }
    try {
      await appendLeadActivity(sheetId, token, {
          "Lead ID": leadId,
          "Activity Type":
            body.action === "submit"
              ? "MANUAL_APPLICATION_SUBMITTED"
              : "MANUAL_APPLICATION_SAVED",
          "Activity Date": now,
          "Created Date": now,
          "Created By": user.username,
          "Staff ID": user.salesId || user.username,
          Description: `${user.name} ${body.action === "submit" ? "submitted" : "saved"} a manual CRM application.`,
      });
    } catch {
      /* The application remains valid if the optional audit tab is unavailable. */
    }
    try {
      await appendAudit(
        sheetId,
        token,
        body.action === "submit"
          ? "CRM_MANUAL_APPLICATION_SUBMITTED"
          : "CRM_MANUAL_APPLICATION_SAVED",
        user.username,
        leadId,
      );
    } catch (auditError) {
      console.error(
        "[crm-application] Application saved but central audit append failed.",
        auditError,
      );
    }
    return NextResponse.json({
      ok: true,
      leadId,
      status: record["Lead Status"],
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to save application.";
    console.error(`[crm-application] ${message}`);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
