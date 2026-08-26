import assert from "node:assert/strict";
import test from "node:test";
import { canContinueManualApplication, canControlLmsQueue, canEditExistingApplication, canReviewSaCase, filterCrmDataForUser, inferProcessingRoute, visibleLeadsForUser } from "../app/access-control.mjs";

const leads = [
  { "Lead ID": "AI-1", "Processing Route": "AI_DIRECT", "Case Visibility": "REGIONAL_ADMIN_ONLY" },
  { "Lead ID": "SA-1", "Processing Route": "SA_ASSIST", "Branch ID": "BR002", "Assigned Sales ID": "K1357" },
  { "Lead ID": "SA-2", "Processing Route": "SA_ASSIST", "Branch ID": "BR002", "Assigned Sales ID": "K2094" },
  { "Lead ID": "SA-3", "Processing Route": "SA_ASSIST", "Branch ID": "BR003", "Assigned Sales ID": "K0268" },
];

const user = (role, branchIds = [], salesId) => ({ username: `uat-${role}`, name: "UAT", role, branchIds, salesId });

test("route inference preserves explicit values and classifies legacy rows without treating location as staff assignment", () => {
  assert.equal(inferProcessingRoute({ "Processing Route": "AI_DIRECT", "Branch ID": "BR002" }), "AI_DIRECT");
  assert.equal(inferProcessingRoute({ "Assigned Sales ID": "K1357" }), "SA_ASSIST");
  assert.equal(inferProcessingRoute({ Source: "CRM_MANUAL", "Branch ID": "BR002" }), "SA_ASSIST");
  assert.equal(inferProcessingRoute({ "Case Visibility": "BRANCH_SA" }), "SA_ASSIST");
  assert.equal(inferProcessingRoute({ "Case Visibility": "REGIONAL_ADMIN_ONLY" }), "AI_DIRECT");
  assert.equal(inferProcessingRoute({ Source: "Website", "Branch ID": "BR002" }), "AI_DIRECT");
  assert.equal(inferProcessingRoute({}), "AI_DIRECT");
});

test("branch managers cannot see a branch-located AI case without an assisted-route signal", () => {
  const legacyWebsiteLead = {
    "Lead ID": "AI-BRANCH-ONLY",
    Source: "Website",
    "Branch ID": "BR002",
  };
  assert.deepEqual(
    visibleLeadsForUser(user("manager", ["BR002"]), [legacyWebsiteLead]),
    [],
  );
});

test("admin and regional manager can see AI-direct and SA-assisted leads", () => {
  assert.equal(visibleLeadsForUser(user("admin"), leads).length, 4);
  assert.equal(visibleLeadsForUser(user("regional_manager"), leads).length, 4);
});

test("branch manager sees only SA-assisted leads in an allowed branch", () => {
  assert.deepEqual(
    visibleLeadsForUser(user("manager", ["BR002"]), leads).map((row) => row["Lead ID"]),
    ["SA-1", "SA-2"]
  );
});

test("staff sees only SA-assisted leads assigned to the staff Sales ID", () => {
  assert.deepEqual(
    visibleLeadsForUser(user("staff", ["BR002"], "K1357"), leads).map((row) => row["Lead ID"]),
    ["SA-1"]
  );
  assert.deepEqual(visibleLeadsForUser(user("staff", ["BR002"]), leads), []);
  assert.deepEqual(visibleLeadsForUser(user("staff", ["BR003"], "K1357"), leads), []);
});

test("existing application edits use the same fail-closed case boundary", () => {
  assert.equal(canEditExistingApplication(user("admin"), leads[0]), true);
  assert.equal(canEditExistingApplication(user("regional_manager"), leads[0]), true);
  assert.equal(canEditExistingApplication(user("manager", ["BR002"]), leads[0]), false);
  assert.equal(canEditExistingApplication(user("manager", ["BR002"]), leads[1]), true);
  assert.equal(canEditExistingApplication(user("manager", ["BR003"]), leads[1]), false);
  assert.equal(canEditExistingApplication(user("staff", ["BR002"], "K1357"), leads[1]), true);
  assert.equal(canEditExistingApplication(user("staff", ["BR003"], "K1357"), leads[1]), false);
  assert.equal(canEditExistingApplication(user("staff", ["BR002"], "K2094"), leads[1]), false);
  assert.equal(canEditExistingApplication(user("readonly", ["BR002"]), leads[1]), false);
});

test("manual editing is limited to SA drafts and returned document cases", () => {
  const manager = user("manager", ["BR002"]);
  assert.equal(
    canContinueManualApplication(manager, {
      ...leads[1],
      "Lead Status": "DRAFT",
      "Current Stage": "MANUAL_APPLICATION",
    }),
    true,
  );
  assert.equal(
    canContinueManualApplication(manager, {
      ...leads[1],
      "Lead Status": "RETURNED_FOR_DOCUMENTS",
      "Current Stage": "DOCUMENT_COLLECTION",
    }),
    true,
  );
  assert.equal(
    canContinueManualApplication(manager, {
      ...leads[1],
      "Lead Status": "VERIFICATION_APPROVED",
      "Current Stage": "CREDIT_ASSESSMENT",
    }),
    false,
  );
  assert.equal(
    canContinueManualApplication(manager, {
      ...leads[1],
      "Lead Status": "VERIFICATION_APPROVED",
      "Current Stage": "DOCUMENT_COLLECTION",
    }),
    false,
  );
  assert.equal(
    canContinueManualApplication(manager, {
      ...leads[1],
      "Lead Status": "DRAFT",
      "Current Stage": "CREDIT_ASSESSMENT",
    }),
    false,
  );
  assert.equal(
    canContinueManualApplication(user("admin"), {
      ...leads[0],
      "Lead Status": "DRAFT",
    }),
    false,
  );
});

test("read-only access remains branch-scoped and cannot expose AI-direct leads", () => {
  assert.deepEqual(
    visibleLeadsForUser(user("readonly", ["BR003"]), leads).map((row) => row["Lead ID"]),
    ["SA-3"]
  );
});

test("lead-linked logs are filtered with the same visibility boundary", () => {
  const rawData = {
    Leads: leads,
    Document_Received_Log: [
      { "Lead ID": "AI-1", "Document Type": "IC_FRONT" },
      { "Lead ID": "SA-1", "Document Type": "PAYSLIP" },
      { "Lead ID": "SA-3", "Document Type": "BANK_STATEMENT" },
      { "Lead ID": "", Status: "SYSTEM" },
    ],
  };
  const { data } = filterCrmDataForUser(user("staff", ["BR002"], "K1357"), rawData);
  assert.deepEqual(data.Leads.map((row) => row["Lead ID"]), ["SA-1"]);
  assert.deepEqual(data.Document_Received_Log.map((row) => row["Lead ID"]), ["SA-1"]);
});

test("only admin and regional manager can see unlinked operational messages", () => {
  const rawData = {
    Leads: leads,
    Customer_Inbox: [
      { "Lead ID": "AI-1", "Customer Message": "AI-direct" },
      { "Lead ID": "SA-1", "Customer Message": "Assigned" },
      { "Lead ID": "", "Customer Message": "Unlinked inbound" },
      {
        "Lead ID": "",
        "Phone Number": "60123456789",
        "Customer Message": "New WhatsApp customer before lead creation",
      },
    ],
  };
  const adminData = filterCrmDataForUser(user("admin"), rawData).data.Customer_Inbox;
  const staffData = filterCrmDataForUser(user("staff", ["BR002"], "K1357"), rawData).data.Customer_Inbox;
  assert.equal(adminData.length, 4);
  assert.deepEqual(staffData.map((row) => row["Customer Message"]), ["Assigned"]);
});

test("the full audit trail is restricted to admin and regional manager", () => {
  const rawData = {
    Leads: leads,
    Audit_Log: [
      { "Lead ID": "N/A", Action: "POLICY_CREATED" },
      { "Lead ID": "AI-1", Action: "QUEUE_REQUESTED" },
    ],
  };
  assert.equal(
    filterCrmDataForUser(user("admin"), rawData).data.Audit_Log.length,
    2,
  );
  assert.equal(
    filterCrmDataForUser(user("regional_manager"), rawData).data.Audit_Log.length,
    2,
  );
  assert.equal(
    filterCrmDataForUser(user("manager", ["BR002"]), rawData).data.Audit_Log.length,
    0,
  );
});

test("manual review controls are limited to SA-assisted cases", () => {
  assert.equal(canReviewSaCase({ role: "admin" }, "AI_DIRECT"), false);
  assert.equal(canReviewSaCase({ role: "regional_manager" }, "AI_DIRECT"), false);
  assert.equal(canReviewSaCase({ role: "manager" }, "SA_ASSIST"), true);
  assert.equal(canReviewSaCase({ role: "staff" }, "SA_ASSIST"), false);
});

test("only admin and regional manager can control the LMS queue", () => {
  assert.equal(canControlLmsQueue({ role: "admin" }), true);
  assert.equal(canControlLmsQueue({ role: "regional_manager" }), true);
  assert.equal(canControlLmsQueue({ role: "manager" }), false);
  assert.equal(canControlLmsQueue({ role: "staff" }), false);
  assert.equal(canControlLmsQueue({ role: "readonly" }), false);
});
