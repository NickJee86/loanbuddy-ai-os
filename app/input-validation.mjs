export function normalizeMalaysianMobile(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (!/^\+?[0-9\s()-]+$/.test(raw)) return "";
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `60${digits.slice(1)}`;
  return /^601\d{8,9}$/.test(digits) ? digits : "";
}

/** @param {{salesId?: string, branchId?: string, users?: Array<Record<string, string>>}} input */
export function validReassignmentTarget({ salesId, branchId, users = [] } = {}) {
  const target = String(salesId || "").trim().toUpperCase();
  const branch = String(branchId || "").trim().toUpperCase();
  return users.find((user) => {
    const active = ["YES", "TRUE", "ACTIVE", "1"].includes(String(user?.Active || "").trim().toUpperCase());
    const branches = String(user?.["Branch IDs"] || "").split(/[|,]/).map((value) => value.trim().toUpperCase()).filter(Boolean);
    return active && String(user?.Role || "").trim().toLowerCase() === "staff" && String(user?.["Sales ID"] || "").trim().toUpperCase() === target && branches.includes(branch);
  }) || null;
}
