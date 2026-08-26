import assert from "node:assert/strict";
import test from "node:test";
import { isSyntheticLead } from "../app/crm-normalization.mjs";

test("explicit and clearly named UAT leads are excluded from production KPIs", () => {
  assert.equal(isSyntheticLead({ "Lead ID": "TEST-PROD-001", "Lead Name": "Customer" }), true);
  assert.equal(isSyntheticLead({ "Lead ID": "LB-001", "Lead Name": "CRM Final Test" }), true);
  assert.equal(isSyntheticLead({ "Lead ID": "LB-002", "Lead Name": "Customer", "Is Test Data": "YES" }), true);
  assert.equal(isSyntheticLead({ "Lead ID": "LB-003", "Lead Name": "Ahmad Bin Ali" }), false);
});
