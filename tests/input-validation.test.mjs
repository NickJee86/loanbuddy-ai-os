import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMalaysianMobile, validReassignmentTarget } from "../app/input-validation.mjs";

test("Malaysian mobile numbers are validated and normalized", () => {
  assert.equal(normalizeMalaysianMobile("012-345 6789"), "60123456789");
  assert.equal(normalizeMalaysianMobile("+60 12-345 6789"), "60123456789");
  assert.equal(normalizeMalaysianMobile("ascascasc"), "");
  assert.equal(normalizeMalaysianMobile("123"), "");
});

test("reassignment accepts only active same-branch Staff", () => {
  const users = [
    { "Sales ID": "K1001", Role: "staff", Active: "YES", "Branch IDs": "BR001" },
    { "Sales ID": "K1002", Role: "staff", Active: "NO", "Branch IDs": "BR001" },
    { "Sales ID": "K1003", Role: "manager", Active: "YES", "Branch IDs": "BR001" },
  ];
  assert.equal(validReassignmentTarget({ salesId: "k1001", branchId: "BR001", users })?.["Sales ID"], "K1001");
  assert.equal(validReassignmentTarget({ salesId: "K1002", branchId: "BR001", users }), null);
  assert.equal(validReassignmentTarget({ salesId: "K1001", branchId: "BR002", users }), null);
  assert.equal(validReassignmentTarget({ salesId: "K1003", branchId: "BR001", users }), null);
});
