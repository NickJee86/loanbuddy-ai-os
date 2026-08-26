import { createHmac } from "node:crypto";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const baseUrl = process.env.LOANBUDDY_TEST_BASE_URL || "http://127.0.0.1:3100";
const secret = process.env.CRM_SESSION_SECRET || "";

if (secret.length < 32) throw new Error("CRM_SESSION_SECRET is missing or too short.");

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function sessionFor(user) {
  const payload = base64url(JSON.stringify({ ...user, exp: Date.now() + 10 * 60 * 1000 }));
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `loanbuddy_crm_session=${payload}.${signature}`;
}

async function get(path, cookie = "") {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: cookie ? { cookie } : {},
    cache: "no-store",
  });
  let body = {};
  try { body = await response.json(); } catch { /* Status is sufficient for non-JSON responses. */ }
  return { status: response.status, body };
}

async function loginAdmin() {
  let users = [];
  try { users = JSON.parse(process.env.CRM_USERS_JSON || "[]"); } catch { /* Legacy admin may still be configured. */ }
  const configured = users.find((user) => user?.role === "admin" && user?.active !== false && user?.username && user?.password);
  const credentials = configured
    ? { username: configured.username, password: configured.password }
    : process.env.CRM_ACCESS_PASSWORD
      ? { username: "nick", password: process.env.CRM_ACCESS_PASSWORD }
      : null;
  if (!credentials) throw new Error("No configured admin credential is available for the read-only verification.");
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(credentials),
  });
  if (!response.ok) throw new Error(`Configured admin login failed (${response.status}).`);
  return response.headers.get("set-cookie")?.split(";")[0] || "";
}

function inferredRoute(row) {
  const explicit = String(row["Processing Route"] || "").trim().toUpperCase();
  if (explicit === "AI_DIRECT" || explicit === "SA_ASSIST") return explicit;
  return row["Assigned Sales ID"] || row["Escalation Reason"] || row["Branch ID"] ? "SA_ASSIST" : "AI_DIRECT";
}

function visibilityResult(name, response, predicate) {
  const leads = response.body?.data?.Leads || [];
  const violations = leads.filter((lead) => !predicate(lead)).length;
  return { name, status: response.status, connected: response.body?.connected === true, leadCount: leads.length, violations };
}

const roles = {
  regional: { username: "uat-regional", name: "UAT Regional", role: "regional_manager", branchIds: [] },
  manager: { username: "uat-manager", name: "UAT Manager", role: "manager", branchIds: ["BR002"] },
  staff: { username: "uat-staff", name: "UAT Staff", role: "staff", branchIds: ["BR002"], salesId: "K1357" },
};

const unauthenticated = await Promise.all([get("/api/auth/me"), get("/api/crm"), get("/api/admin/users")]);
const adminCookie = await loginAdmin();
const adminUsers = await get("/api/admin/users", adminCookie);
const inactiveLogin = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "k2015", password: "deliberately-invalid-uat-password" }),
});

const regionalCookie = sessionFor(roles.regional);
const managerCookie = sessionFor(roles.manager);
const staffCookie = sessionFor(roles.staff);
const [regionalCrm, managerCrm, staffCrm] = await Promise.all([
  get("/api/crm", regionalCookie),
  get("/api/crm", managerCookie),
  get("/api/crm", staffCookie),
]);
const deniedAdminRoutes = await Promise.all([
  get("/api/admin/users", regionalCookie),
  get("/api/admin/users", managerCookie),
  get("/api/admin/users", staffCookie),
]);

const report = {
  unauthenticatedStatuses: unauthenticated.map((item) => item.status),
  adminUserManagement: {
    status: adminUsers.status,
    accountCount: Array.isArray(adminUsers.body?.users) ? adminUsers.body.users.length : 0,
  },
  inactiveAccountLoginStatus: inactiveLogin.status,
  adminRouteDeniedStatuses: deniedAdminRoutes.map((item) => item.status),
  visibility: [
    visibilityResult("regional_manager", regionalCrm, () => true),
    visibilityResult("manager_BR002", managerCrm, (row) => inferredRoute(row) === "SA_ASSIST" && row["Branch ID"] === "BR002"),
    visibilityResult("staff_K1357", staffCrm, (row) => inferredRoute(row) === "SA_ASSIST" && row["Assigned Sales ID"] === "K1357"),
  ],
};

console.log(JSON.stringify(report, null, 2));

const failed =
  report.unauthenticatedStatuses.some((status) => status !== 401) ||
  report.adminUserManagement.status !== 200 ||
  report.adminUserManagement.accountCount < 17 ||
  report.inactiveAccountLoginStatus !== 401 ||
  report.adminRouteDeniedStatuses.some((status) => status !== 403) ||
  report.visibility.some((item) => item.status !== 200 || !item.connected || item.violations !== 0);

if (failed) process.exitCode = 1;
