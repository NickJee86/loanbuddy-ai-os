import { NextRequest, NextResponse } from "next/server";
import { sessionCookieName, verifySession } from "../../../auth";


export async function GET(request: NextRequest) {
const user = await verifySession(request.cookies.get(sessionCookieName())?.value);
if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
return NextResponse.json({ user }, { headers: { "cache-control": "no-store" } });
}


