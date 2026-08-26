import { NextRequest, NextResponse } from "next/server";
import { createSession, sessionCookie } from "../../../auth";
import { authenticateUser } from "../../../user-store";
import {
  loginRateLimitAttemptKeys,
  loginRateLimitBucket,
  shouldReleaseLoginAttempt,
  validLoginCredentialShape,
} from "../../../auth-rate-limit.mjs";
import {
  claimSpreadsheetIdempotency,
  deleteSpreadsheetMetadata,
  listSpreadsheetMetadata,
  releaseSpreadsheetIdempotency,
  writableSheetContext,
} from "../../../google-sheets-write";

export const runtime = "nodejs";
const RATE_LIMIT_NAMESPACE = "LOANBUDDY_AUTH_RATE_LIMIT";
let lastCleanupAt = 0;

async function fingerprint(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function reserveLoginAttempt(request: NextRequest, username: string) {
  const { sheetId, token } = await writableSheetContext();
  const forwarded =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const identity = await fingerprint(
    `${forwarded}|${username.trim().toLowerCase() || "missing"}`,
  );
  const bucket = loginRateLimitBucket();
  let metadataId: number | null = null;
  for (const key of loginRateLimitAttemptKeys(identity, bucket)) {
    const reservation = await claimSpreadsheetIdempotency(
      sheetId,
      token,
      RATE_LIMIT_NAMESPACE,
      key,
    );
    if (reservation.claimed) {
      metadataId = reservation.metadataId;
      break;
    }
  }
  if (Date.now() - lastCleanupAt > 5 * 60 * 1000) {
    lastCleanupAt = Date.now();
    try {
      const metadata = await listSpreadsheetMetadata(
        sheetId,
        token,
        RATE_LIMIT_NAMESPACE,
      );
      const expired = metadata
        .filter(
          (item) =>
            Number(String(item.metadataValue || "").split(":")[0]) < bucket - 1,
        )
        .map((item) => item.metadataId);
      await deleteSpreadsheetMetadata(sheetId, token, expired);
    } catch (cleanupError) {
      console.error(
        "[crm-login] Expired rate-limit metadata cleanup failed.",
        cleanupError,
      );
    }
  }
  return { claimed: metadataId !== null, sheetId, token, metadataId };
}

export async function POST(request: NextRequest) {
  try {
    const { username, password } = (await request.json()) as {
      username?: string;
      password?: string;
    };
    const submittedUsername = String(username || "");
    const submittedPassword = String(password || "");
    if (!validLoginCredentialShape(submittedUsername, submittedPassword))
      return NextResponse.json(
        { error: "Invalid username or password." },
        { status: 401, headers: { "cache-control": "no-store" } },
      );
    const attempt = await reserveLoginAttempt(request, submittedUsername);
    if (!attempt.claimed)
      return NextResponse.json(
        { error: "Too many login attempts. Try again in 15 minutes." },
        {
          status: 429,
          headers: { "retry-after": "900", "cache-control": "no-store" },
        },
      );
    const user = await authenticateUser(submittedUsername, submittedPassword);
    if (!user)
      return NextResponse.json(
        { error: "Invalid username or password." },
        { status: 401 },
      );
    const token = await createSession(user);
    if (shouldReleaseLoginAttempt(true) && attempt.metadataId !== null) {
      try {
        await releaseSpreadsheetIdempotency(
          attempt.sheetId,
          attempt.token,
          attempt.metadataId,
        );
      } catch (releaseError) {
        console.error(
          "[crm-login] Successful-login rate-limit slot cleanup failed.",
          releaseError,
        );
      }
    }
    return NextResponse.json(
      { user },
      {
        headers: {
          "set-cookie": sessionCookie(token),
          "cache-control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error(
      "[crm-login] Login service unavailable.",
      error instanceof Error ? error.message : "Unknown error",
    );
    return NextResponse.json(
      { error: "Account login is not configured." },
      { status: 503 },
    );
  }
}
