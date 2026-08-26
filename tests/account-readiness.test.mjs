import assert from "node:assert/strict";
import test from "node:test";
import {
  accountReadiness,
  accountReadinessSummary,
} from "../app/account-readiness.mjs";

const manager = {
  username: "mgr.branch",
  name: "Branch Manager",
  role: "manager",
  branchIds: ["BR001"],
  active: true,
  hasPassword: true,
  passwordManagedInCrm: true,
};

test("active complete Manager account is sign-in ready", () => {
  const result = accountReadiness(manager);
  assert.equal(result.ready, true);
  assert.equal(result.label, "READY");
});

test("inactive SA remains blocked even when a password exists", () => {
  const result = accountReadiness({
    username: "k1001",
    name: "SA One",
    role: "staff",
    branchIds: ["BR001"],
    salesId: "K1001",
    active: false,
    hasPassword: true,
  });
  assert.equal(result.ready, false);
  assert.equal(result.label, "INACTIVE");
});

test("SA without a password cannot be described as ready", () => {
  const result = accountReadiness({
    username: "k1002",
    name: "SA Two",
    role: "staff",
    branchIds: ["BR001"],
    salesId: "K1002",
    active: false,
    hasPassword: false,
  });
  assert.equal(result.ready, false);
  assert.equal(result.label, "PASSWORD REQUIRED");
});

test("Manager and SA branch and Sales ID omissions fail closed", () => {
  assert.equal(
    accountReadiness({ ...manager, branchIds: [] }).label,
    "BRANCH REQUIRED",
  );
  assert.equal(
    accountReadiness({
      ...manager,
      role: "staff",
      branchIds: ["BR001"],
      salesId: "",
    }).label,
    "SA ID REQUIRED",
  );
});

test("account readiness summary separates usable and blocked roles", () => {
  const summary = accountReadinessSummary([
    manager,
    {
      username: "k1001",
      name: "SA One",
      role: "staff",
      branchIds: ["BR001"],
      salesId: "K1001",
      active: false,
      hasPassword: true,
    },
  ]);
  assert.deepEqual(summary, {
    ready: 1,
    blocked: 1,
    readyManagers: 1,
    blockedStaff: 1,
    readyRegionalManagers: 0,
  });
});
