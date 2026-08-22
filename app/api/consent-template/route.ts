import { NextResponse } from "next/server";
export async function GET() { return NextResponse.json({ error: "Consent template asset is not included in this recovered source snapshot." }, { status: 503 }); }
