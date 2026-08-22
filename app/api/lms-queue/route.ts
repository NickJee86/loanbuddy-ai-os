import { NextResponse } from "next/server";
export async function POST() { return NextResponse.json({ error: "LMS queue updates are temporarily unavailable in this build." }, { status: 503 }); }
