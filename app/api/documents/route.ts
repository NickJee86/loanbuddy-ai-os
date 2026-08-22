import { NextResponse } from "next/server";
export async function POST() { return NextResponse.json({ error: "Document upload is temporarily unavailable in this build." }, { status: 503 }); }
