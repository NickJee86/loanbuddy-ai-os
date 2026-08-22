import { NextRequest, NextResponse } from "next/server";
import { sessionCookieName, verifySession } from "../../../auth";
export async function GET(request: NextRequest) { const user = await verifySession(request.cookies.get(sessionCookieName())?.value); return user ? NextResponse.json({ user }) : NextResponse.json({ error: "Unauthenticated" }, { status: 401 }); }
