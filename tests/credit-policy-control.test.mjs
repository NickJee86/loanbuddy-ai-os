import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCreditPolicyEngineConfig,
  evaluateCreditPolicyEngineReadiness,
  readCreditPolicyEngineConfig,
} from "../app/credit-policy-control.mjs";

const validActivePolicy = {
  "Policy Code": "LB_PERSONAL_LOAN",
  "Policy Version": "V2",
  Status: "ACTIVE",
  "Effective From": "2026-08-10",
  "Product Name": "Personal Loan",
  Currency: "MYR",
  "Minimum Age": "21",
  "Maximum Age At Maturity": "65",
  "Minimum Employment Tenure Months": "3",
  "Minimum Verified Net Income": "1700",
  "Maximum Preliminary DSR": "60",
  "Minimum Net Disposable Income": "1500",
  "Minimum Loan Amount": "1000",
  "Maximum Loan Amount": "100000",
  "Minimum Tenure Months": "6",
  "Maximum Tenure Months": "66",
  "Variable Income Recognition Percent": "100",
  "Minimum Auto LMS Score": "80",
  "Manual Review Score": "65",
  "Required Documents": "IC_FRONT,IC_BACK,PAYSLIP,BANK_STATEMENT",
  "Optional Documents": "EPF_STATEMENT",
  "Approved By": "management-approver",
  "Approved At": "2026-08-10T00:30:00Z",
};

test("a missing or unrecognized config is OFF by default", () => {
  assert.deepEqual(readCreditPolicyEngineConfig([]), {
    configured: false,
    enabled: false,
    rawValue: "",
    updatedAt: "",
  });
  assert.equal(
    readCreditPolicyEngineConfig([
      { "Config Key": "CREDIT_POLICY_ENGINE_ENABLED", "Config Value": "maybe" },
    ]).enabled,
    false,
  );
});

test("only explicit enabled config values turn the engine ON", () => {
  assert.equal(
    readCreditPolicyEngineConfig([
      {
        "Config Key": " credit-policy-engine-enabled ",
        "Config Value": "yes",
        "Last Updated": "2026-08-11T00:00:00.000Z",
      },
    ]).enabled,
    true,
  );
});

test("engine enablement requires exactly one complete approved effective ACTIVE policy", () => {
  const ready = evaluateCreditPolicyEngineReadiness(
    [validActivePolicy],
    "2026-08-10T02:00:00Z",
  );
  assert.equal(ready.canEnable, true);
  assert.equal(ready.activePolicyCount, 1);

  const none = evaluateCreditPolicyEngineReadiness([], "2026-08-10T02:00:00Z");
  assert.equal(none.canEnable, false);
  assert.ok(none.reasons.includes("ACTIVE_POLICY_NOT_FOUND"));

  const multiple = evaluateCreditPolicyEngineReadiness(
    [validActivePolicy, { ...validActivePolicy, "Policy Version": "V3" }],
    "2026-08-10T02:00:00Z",
  );
  assert.equal(multiple.canEnable, false);
  assert.ok(multiple.reasons.includes("MULTIPLE_ACTIVE_POLICIES"));
});

test("invalid, unapproved or future policies cannot enable the engine", () => {
  const invalid = evaluateCreditPolicyEngineReadiness(
    [{ ...validActivePolicy, "Minimum Verified Net Income": "" }],
    "2026-08-10T02:00:00Z",
  );
  assert.ok(invalid.reasons.includes("ACTIVE_POLICY_INVALID"));

  const unapproved = evaluateCreditPolicyEngineReadiness(
    [{ ...validActivePolicy, "Approved By": "", "Approved At": "" }],
    "2026-08-10T02:00:00Z",
  );
  assert.ok(unapproved.reasons.includes("POLICY_APPROVAL_MISSING"));

  const future = evaluateCreditPolicyEngineReadiness(
    [{ ...validActivePolicy, "Effective From": "2026-08-11" }],
    "2026-08-10T02:00:00Z",
  );
  assert.ok(future.reasons.includes("POLICY_NOT_EFFECTIVE"));
});

test("the config record stores one Admin-controlled ON/OFF value without thresholds", () => {
  const record = buildCreditPolicyEngineConfig(
    false,
    "2026-08-11T00:00:00.000Z",
  );
  assert.equal(record["Config Value"], "OFF");
  assert.equal(record["Config Key"], "CREDIT_POLICY_ENGINE_ENABLED");
  assert.equal("Minimum Verified Net Income" in record, false);
});
