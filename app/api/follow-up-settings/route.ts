import { NextRequest, NextResponse } from "next/server";
import { sessionCookieName, verifySession } from "../../auth";
import {
  buildFollowUpConfigRecords,
  FOLLOW_UP_CONFIG,
  readFollowUpSettings,
  validateFollowUpSettings,
} from "../../follow-up-control.mjs";
import {
  appendAudit,
  readSheetValues,
  rowsToRecords,
  writableSheetContext,
  writeSheetValueRanges,
  writeSheetValues,
} from "../../google-sheets-write";

export const runtime = "nodejs";

type FollowUpBody = {
  settings?: Record<string, unknown>;
  confirmation?: string;
  expectedUpdatedAt?: string;
};

async function context() {
  const { sheetId, token } = await writableSheetContext();
  const values = await readSheetValues(sheetId, token, "System_Config!A1:E");
  const headers = values[0] || [];
  if (!["Config Key", "Config Value", "Description"].every((item) => headers.includes(item)))
    throw new Error("System_Config headers are incomplete.");
  return { sheetId, token, headers, rows: rowsToRecords(values) };
}

const canView = (role: string) =>
  ["admin", "regional_manager", "manager"].includes(role);
const canManage = (role: string) =>
  ["admin", "regional_manager"].includes(role);

export async function GET(request: NextRequest) {
  const user = await verifySession(request.cookies.get(sessionCookieName())?.value);
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (!canView(user.role))
    return NextResponse.json({ error: "Follow-up settings access denied." }, { status: 403 });
  try {
    const { rows } = await context();
    return NextResponse.json({
      settings: readFollowUpSettings(rows.map(({ record }) => record)),
      canManage: canManage(user.role),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load follow-up settings." },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest) {
  const user = await verifySession(request.cookies.get(sessionCookieName())?.value);
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (!canManage(user.role))
    return NextResponse.json({ error: "Only Admin or Regional Manager can change follow-up settings." }, { status: 403 });
  try {
    const body = (await request.json()) as FollowUpBody;
    const validation = validateFollowUpSettings(body.settings || {});
    if (!validation.valid)
      return NextResponse.json({ error: validation.errors.join(" "), errors: validation.errors }, { status: 400 });
    if (validation.settings.enabled && body.confirmation !== "ENABLE_FOLLOW_UP_ENGINE")
      return NextResponse.json({ error: "Explicit confirmation is required before enabling automatic follow-up." }, { status: 400 });

    const { sheetId, token, headers, rows } = await context();
    const current = readFollowUpSettings(rows.map(({ record }) => record));
    if ((body.expectedUpdatedAt || "") !== current.updatedAt)
      return NextResponse.json({ error: "Follow-up settings changed in another session. Reload and try again." }, { status: 409 });

    const managedKeys = new Set(Object.values(FOLLOW_UP_CONFIG));
    const duplicates = rows.filter(({ record }) => managedKeys.has(String(record["Config Key"] || "").trim().toUpperCase()))
      .reduce((counts, { record }) => {
        const key = String(record["Config Key"] || "").trim().toUpperCase();
        counts.set(key, (counts.get(key) || 0) + 1);
        return counts;
      }, new Map<string, number>());
    if ([...duplicates.values()].some((count) => count > 1))
      throw new Error("System_Config contains duplicate follow-up controls.");

    const now = new Date().toISOString();
    const records = buildFollowUpConfigRecords(validation.settings, now) as Record<string, string>[];
    const existingByKey = new Map(
      rows.map((row) => [String(row.record["Config Key"] || "").trim().toUpperCase(), row]),
    );
    const updates = records.flatMap((record) => {
      const existing = existingByKey.get(record["Config Key"]);
      return existing
        ? [{ range: `System_Config!A${existing.rowNumber}:E${existing.rowNumber}`, values: [headers.map((header) => record[header] || "")] }]
        : [];
    });
    const additions = records.filter((record) => !existingByKey.has(record["Config Key"]));
    if (updates.length) await writeSheetValueRanges(sheetId, token, updates);
    if (additions.length)
      await writeSheetValues(sheetId, token, "System_Config!A:E", additions.map((record) => headers.map((header) => record[header] || "")), true);

    try {
      await appendAudit(
        sheetId,
        token,
        validation.settings.enabled ? "FOLLOW_UP_SETTINGS_SAVED_ENGINE_ON" : "FOLLOW_UP_SETTINGS_SAVED_ENGINE_OFF",
        user.username,
        "",
        JSON.stringify({
          firstMinutes: validation.settings.firstMinutes,
          secondMinutes: validation.settings.secondMinutes,
          thirdMinutes: validation.settings.thirdMinutes,
          finalMinutes: validation.settings.finalMinutes,
          maxCount: validation.settings.maxCount,
          businessHoursOnly: validation.settings.businessHoursOnly,
          informationIncomplete: validation.settings.informationIncomplete,
          documentsIncomplete: validation.settings.documentsIncomplete,
        }),
      );
    } catch (auditError) {
      console.error("[follow-up-settings] Settings saved but audit append failed.", auditError);
    }
    return NextResponse.json({ ok: true, settings: { ...validation.settings, configured: true, updatedAt: now } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save follow-up settings." },
      { status: 502 },
    );
  }
}
