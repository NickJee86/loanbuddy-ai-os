const SUPPORTED_ROLES = new Set([
  "admin",
  "regional_manager",
  "manager",
  "staff",
  "readonly",
]);

function clean(value) {
  return String(value ?? "").trim();
}

export function accountReadiness(user = {}) {
  const role = clean(user.role).toLowerCase();
  const branches = Array.isArray(user.branchIds)
    ? user.branchIds.map(clean).filter(Boolean)
    : [];
  if (!clean(user.username) || !clean(user.name) || !SUPPORTED_ROLES.has(role))
    return {
      ready: false,
      label: "IDENTITY INCOMPLETE",
      tone: "red",
      detail: "Complete the username, name and supported role.",
    };
  if (["manager", "staff"].includes(role) && !branches.length)
    return {
      ready: false,
      label: "BRANCH REQUIRED",
      tone: "red",
      detail: "Assign at least one authorised branch.",
    };
  if (role === "staff" && !clean(user.salesId))
    return {
      ready: false,
      label: "SA ID REQUIRED",
      tone: "red",
      detail: "Assign the Staff / SA Sales ID.",
    };
  if (user.hasPassword !== true)
    return {
      ready: false,
      label: "PASSWORD REQUIRED",
      tone: "red",
      detail: "Set a password before activation.",
    };
  if (user.active !== true)
    return {
      ready: false,
      label: "INACTIVE",
      tone: "amber",
      detail: "Password ready; Admin activation is still required.",
    };
  return {
    ready: true,
    label: "READY",
    tone: "teal",
    detail: user.passwordManagedInCrm
      ? "Active with a CRM-managed password."
      : "Active with an environment-managed password.",
  };
}

export function accountReadinessSummary(users = []) {
  const results = users.map((user) => ({
    user,
    readiness: accountReadiness(user),
  }));
  return {
    ready: results.filter((item) => item.readiness.ready).length,
    blocked: results.filter((item) => !item.readiness.ready).length,
    readyManagers: results.filter(
      (item) => item.user.role === "manager" && item.readiness.ready,
    ).length,
    blockedStaff: results.filter(
      (item) => item.user.role === "staff" && !item.readiness.ready,
    ).length,
    readyRegionalManagers: results.filter(
      (item) =>
        item.user.role === "regional_manager" && item.readiness.ready,
    ).length,
  };
}
