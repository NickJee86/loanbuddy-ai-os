import { NextRequest, NextResponse } from "next/server";
import { sessionCookieName, verifySession } from "../../../auth";
import { createCrmUser, listCrmUsers, resetCrmUserPassword, setCrmUserActive, updateCrmUser, type CrmUserInput } from "../../../user-store";

export const runtime = "nodejs";

async function admin(request: NextRequest) {
const user = await verifySession(request.cookies.get(sessionCookieName())?.value);
return user?.role === "admin" ? user : null;
}

export async function GET(request: NextRequest) {
try {
if (!await admin(request)) return NextResponse.json({ error: "Admin permission is required." }, { status: 403 });
return NextResponse.json({ users: await listCrmUsers() }, { headers: { "cache-control": "no-store" } });
} catch (error) {
return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load users." }, { status: 502 });
}
}

export async function POST(request: NextRequest) {
try {
const actor = await admin(request);
if (!actor) return NextResponse.json({ error: "Admin permission is required." }, { status: 403 });
const body = await request.json() as { operation?: "create" | "update" | "set_active" | "reset_password"; username?: string; password?: string; active?: boolean; user?: CrmUserInput };
const operation = body.operation || "reset_password";
if (operation === "reset_password") {
if (!body.username || !body.password) return NextResponse.json({ error: "Username and new password are required." }, { status: 400 });
return NextResponse.json({ ok: true, user: await resetCrmUserPassword(body.username, body.password, actor.username) });
}
if (operation === "create") {
if (!body.user) return NextResponse.json({ error: "User details are required." }, { status: 400 });
return NextResponse.json({ ok: true, user: await createCrmUser(body.user, actor.username) });
}
if (operation === "update") {
if (!body.username || !body.user) return NextResponse.json({ error: "Username and user details are required." }, { status: 400 });
return NextResponse.json({ ok: true, user: await updateCrmUser(body.username, body.user, actor.username) });
}
if (operation === "set_active") {
if (!body.username || typeof body.active !== "boolean") return NextResponse.json({ error: "Username and account status are required." }, { status: 400 });
return NextResponse.json({ ok: true, user: await setCrmUserActive(body.username, body.active, actor.username) });
}
return NextResponse.json({ error: "Unsupported account operation." }, { status: 400 });
} catch (error) {
return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to reset password." }, { status: 400 });
}
}
