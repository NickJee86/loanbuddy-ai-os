import assert from "node:assert/strict";
import test from "node:test";
import { buildBranchOptions, filterCrmDataByDate, mergeBranchRows, pipelineBucket, pipelineCounts, recentLeads } from "../app/crm-normalization.mjs";

test("current production stages map into the correct dashboard pipeline bucket", () => {
  assert.equal(pipelineBucket("Assigned"), "new");
  assert.equal(pipelineBucket("MANUAL_APPLICATION"), "new");
  assert.equal(pipelineBucket("QUALIFICATION_IN_PROGRESS"), "contacted");
  assert.equal(pipelineBucket("QUALIFIED"), "qualified");
  assert.equal(pipelineBucket("DOCUMENT_VERIFICATION"), "documents");
  assert.equal(pipelineBucket("SUBMITTED_FOR_VERIFICATION"), "documents");
  assert.equal(pipelineBucket("VERIFICATION_APPROVED"), "credit");
  assert.equal(pipelineBucket("SCORING_COMPLETED"), "credit");
  assert.equal(pipelineBucket("READY_FOR_LMS"), "lms");
  assert.equal(pipelineBucket("QUALIFIED", "SUBMITTED"), "lms");
  assert.equal(pipelineBucket("LMS_SUBMITTED", "APPROVED"), "approved");
  assert.equal(pipelineBucket("REJECTED"), "closed");
});

test("dashboard pipeline counts every visible lead exactly once", () => {
  const counts = pipelineCounts([
    { stage: "Assigned" },
    { stage: "DOCUMENT_REUPLOAD" },
    { stage: "DOCUMENT_VERIFICATION" },
    { stage: "CREDIT_ASSESSMENT" },
    { stage: "READY_FOR_LMS" },
    { stage: "LMS_SUBMITTED", lmsStatus: "APPROVED" },
    { stage: "REJECTED" },
  ]);
  assert.deepEqual(counts, {
    new: 1,
    contacted: 0,
    qualified: 0,
    documents: 2,
    credit: 1,
    lms: 1,
    approved: 1,
    closed: 1,
  });
});

test("recent leads are ordered by actual update time with stable fallback", () => {
  const rows = [
    { id: "NO-DATE" },
    { id: "OLDER", updated: "2026-08-09T00:00:00Z" },
    { id: "NEWER", raw: { "Updated At": "2026-08-11T00:00:00Z" } },
    { id: "MIDDLE", raw: { "Created Date": "2026-08-10T00:00:00Z" } },
  ];
  assert.deepEqual(
    recentLeads(rows, 3).map((row) => row.id),
    ["NEWER", "MIDDLE", "OLDER"],
  );
});

test("branch options use master and permitted branches without placeholders", () => {
  const branches = buildBranchOptions(
    [{ branch: "Not assigned" }, { branch: "BR001" }],
    [{ "Branch ID": "BR002", Active: "YES" }, { "Branch ID": "BR004", Active: "NO" }],
    ["BR003"],
  );
  assert.deepEqual(branches, ["BR001", "BR002", "BR003"]);
});

test("active account branches complete an incomplete Branch_Master without duplicates", () => {
  const rows = mergeBranchRows(
    [{ "Branch ID": "BR001", Active: "YES" }],
    [
      { active: true, branchIds: ["BR001", "BR002"] },
      { active: true, branchIds: ["BR003"] },
      { active: false, branchIds: ["BR004"] },
    ],
  );
  assert.deepEqual(rows.map((row) => row["Branch ID"]), ["BR001", "BR002", "BR003"]);
  assert.equal(rows[1].Source, "CRM_Users");
});

test("date ranges filter operational rows while preserving branch reference data", () => {
  const data = {
    Leads: [
      { "Lead ID": "OLD", "Created Date": "2026-07-01T00:00:00Z" },
      { "Lead ID": "CURRENT", "Created Date": "2026-08-05T00:00:00Z" },
    ],
    Branch_Master: [{ "Branch ID": "BR001" }],
  };
  const filtered = filterCrmDataByDate(data, "This Month", new Date("2026-08-08T00:00:00Z"));
  assert.deepEqual(filtered.Leads.map((row) => row["Lead ID"]), ["CURRENT"]);
  assert.equal(filtered.Branch_Master.length, 1);
  assert.equal(filterCrmDataByDate(data, "All Time"), data);
});
