import { NextResponse } from "next/server";
import { clearSessionCookie } from "../../../auth";


export async function POST() {
return NextResponse.json({ ok: true }, { headers: { "set-cookie": clearSessionCookie(), "cache-control": "no-store" } });
}


