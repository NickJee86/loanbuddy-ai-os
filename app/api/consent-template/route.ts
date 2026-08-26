import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { sessionCookieName, verifySession } from "../../auth";
import { consentTemplateHeaders } from "../../consent-template.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await verifySession(
    request.cookies.get(sessionCookieName())?.value,
  );
  if (!user) {
    return NextResponse.json(
      { error: "Unauthenticated" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const pdf = await readFile(
      join(
        process.cwd(),
        "assets",
        "consent",
        "Consent-Form-CCRIS-V4.0-01112020-ENG.pdf",
      ),
    );
    const mode = request.nextUrl.searchParams.get("mode");
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: consentTemplateHeaders(mode),
    });
  } catch (error) {
    console.error("[consent-template] Controlled PDF asset unavailable.", error);
    return NextResponse.json(
      { error: "The controlled consent template is temporarily unavailable." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
