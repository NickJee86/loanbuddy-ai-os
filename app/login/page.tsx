"use client";


import Image from "next/image";
import { FormEvent, useState } from "react";


export default function LoginPage() {
const [error, setError] = useState("");
const [loading, setLoading] = useState(false);
async function submit(event: FormEvent<HTMLFormElement>) {
event.preventDefault();
setLoading(true);
setError("");
const form = new FormData(event.currentTarget);
const controller = new AbortController();
const timeout = window.setTimeout(() => controller.abort(), 15000);
try {
const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: form.get("username"), password: form.get("password") }), signal: controller.signal });
if (response.ok) { window.location.href = "/"; return; }
setError(((await response.json()) as { error?: string }).error || "Unable to sign in.");
} catch {
setError("The sign-in service is busy. Please try again in a moment.");
} finally {
window.clearTimeout(timeout);
setLoading(false);
}
}
return <main className="login-page"><form className="login-card" onSubmit={submit}><Image src="/loanbuddy-logo.png" alt="LoanBuddy Credit" width={414} height={188} priority /><p className="eyebrow">LOANBUDDY CRM</p><h1>Secure sign in</h1><p>Use your individual staff account.</p><label>Username<input name="username" autoComplete="username" required /></label><label>Password<input name="password" type="password" autoComplete="current-password" required /></label>{error && <div className="login-error">{error}</div>}<button type="submit" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</button></form></main>;
}
