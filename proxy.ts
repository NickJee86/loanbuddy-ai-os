import { NextRequest, NextResponse } from "next/server";
import { sessionCookieName, verifySession } from "./app/auth";


export async function proxy(request: NextRequest) {
const path = request.nextUrl.pathname;
if (path === "/login" || path === "/api/auth/login") return NextResponse.next();
const user = await verifySession(request.cookies.get(sessionCookieName())?.value);
if (user) return NextResponse.next();
if (path.startsWith("/api/")) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
return NextResponse.redirect(new URL("/login", request.url));
}


export const config = {
matcher: ["/((?!_next/static|_next/image|favicon.svg|loanbuddy-logo.png).*)"],
};


