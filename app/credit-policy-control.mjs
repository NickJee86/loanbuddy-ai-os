import { validatePolicyForActivation } from "./credit-policy.mjs";

export const CREDIT_POLICY_ENGINE_KEY = "CREDIT_POLICY_ENGINE_ENABLED";
export const SYSTEM_CONFIG_HEADERS = Object.freeze([
  "Config Key",
  "Config Value",
  "Description",
  "Status",
  "Last Updated",
]);

const ENABLED_VALUES = new Set(["ON", "TRUE", "YES", "ENABLED", "1"]);

function normalized(value) {
  return String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function effectiveTime(policy) {
  const value = String(policy?.["Effective From"] || "").trim();
  return Date.parse(`${value}T00:00:00+08:00`);
}

/** @param {Array<Record<string, string>>} configRows */
export function readCreditPolicyEngineConfig(configRows = []) {
  const row =
    configRows.find(
      (record) => normalized(record?.["Config Key"]) === CREDIT_POLICY_ENGINE_KEY,
    ) || null;
  const rawValue = String(row?.["Config Value"] || "").trim();
  return {
    configured: Boolean(row),
    enabled: Boolean(row) && ENABLED_VALUES.has(normalized(rawValue)),
    rawValue,
    updatedAt: String(row?.["Last Updated"] || "").trim(),
  };
}

/**
 * @param {Array<Record<string, string>>} policyRows
 * @param {string | number | Date} referenceTime
 */
export function evaluateCreditPolicyEngineReadiness(
  policyRows = [],
  referenceTime = new Date(),
) {
  const activePolicies = policyRows.filter(
    (policy) => normalized(policy?.Status) === "ACTIVE",
  );
  const reasons = [];
  if (activePolicies.length === 0) reasons.push("ACTIVE_POLICY_NOT_FOUND");
  if (activePolicies.length > 1) reasons.push("MULTIPLE_ACTIVE_POLICIES");

  const activePolicy = activePolicies.length === 1 ? activePolicies[0] : null;
  if (activePolicy) {
    const validation = validatePolicyForActivation(activePolicy);
    if (!validation.valid) {
      reasons.push("ACTIVE_POLICY_INVALID", ...validation.errors);
    }

    const approvedBy = String(activePolicy["Approved By"] || "").trim();
    const approvedAtValue = String(activePolicy["Approved At"] || "").trim();
    const approvedAt = Date.parse(approvedAtValue);
    if (!approvedBy || !approvedAtValue) reasons.push("POLICY_APPROVAL_MISSING");
    else if (!Number.isFinite(approvedAt))
      reasons.push("POLICY_APPROVAL_TIMESTAMP_INVALID");

    const now =
      referenceTime instanceof Date
        ? referenceTime.getTime()
        : typeof referenceTime === "number"
          ? referenceTime
          : Date.parse(referenceTime);
    const effectiveAt = effectiveTime(activePolicy);
    if (!Number.isFinite(now)) reasons.push("REFERENCE_TIME_INVALID");
    if (!Number.isFinite(effectiveAt)) reasons.push("POLICY_EFFECTIVE_DATE_INVALID");
    else if (Number.isFinite(now) && effectiveAt > now)
      reasons.push("POLICY_NOT_EFFECTIVE");
  }

  return {
    canEnable: reasons.length === 0,
    reasons: [...new Set(reasons)],
    activePolicy,
    activePolicyCount: activePolicies.length,
  };
}

export function buildCreditPolicyEngineConfig(enabled, updatedAt) {
  return {
    "Config Key": CREDIT_POLICY_ENGINE_KEY,
    "Config Value": enabled ? "ON" : "OFF",
    Description:
      "Admin-only master switch for ACTIVE credit-policy thresholds and automatic LMS queue eligibility.",
    Status: "Active",
    "Last Updated": updatedAt,
  };
}

export function cloneCreditPolicyDraft(policy = {}, template = {}) {
  const draft = { ...template };
  for (const key of Object.keys(template)) {
    if (["Policy Version", "Effective From"].includes(key)) continue;
    if (policy[key] !== undefined && policy[key] !== null)
      draft[key] = String(policy[key]);
  }
  draft["Policy Version"] = "";
  draft["Effective From"] = "";
  return draft;
}
