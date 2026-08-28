import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const blueprintPath = new URL(
  "../make/blueprints/s00-v4-unified-knowledge-ai-production.blueprint.json",
  import.meta.url,
);
const policeHotfixPath = new URL(
  "../make/runtime-hotfixes/2026-08-26-polis-eligibility.json",
  import.meta.url,
);
const branchAddressHotfixPath = new URL(
  "../make/runtime-hotfixes/2026-08-28-branch-address-knowledge.json",
  import.meta.url,
);

test("S00 production prompt rejects police applicants without requesting documents", () => {
  const blueprint = fs.readFileSync(blueprintPath, "utf8");

  assert.match(blueprint, /LoanBuddy tidak menerima permohonan daripada anggota polis/);
  assert.match(blueprint, /jangan minta IC atau dokumen/);
  assert.match(blueprint, /qualification_status=NOT_ELIGIBLE/);
  assert.doesNotThrow(() => JSON.parse(blueprint));
});

test("deployed police runtime hotfix uses the exact intent and fail-closed workflow", () => {
  const hotfix = JSON.parse(fs.readFileSync(policeHotfixPath, "utf8"));

  assert.equal(hotfix.status, "DEPLOYED");
  assert.equal(hotfix.changes.intent_extractor.knowledge_intent, "police_occupation_not_eligible");
  assert.equal(hotfix.changes.runtime_knowledge.intent, "police_occupation_not_eligible");
  assert.equal(hotfix.changes.runtime_knowledge.customer_facing, true);
  assert.equal(hotfix.changes.reply_guardrail.eligible, false);
  assert.equal(hotfix.changes.reply_guardrail.request_documents, false);
  assert.equal(hotfix.changes.reply_guardrail.continue_qualification, false);
  assert.equal(hotfix.changes.reply_guardrail.qualification_status, "NOT_ELIGIBLE");
});


test("deployed branch knowledge preserves every approved address and navigation link", () => {
  const hotfix = JSON.parse(fs.readFileSync(branchAddressHotfixPath, "utf8"));

  assert.equal(hotfix.status, "DEPLOYED");
  assert.equal(hotfix.knowledge_intent, "loanbuddy_branch_addresses");
  assert.equal(hotfix.customer_facing, true);
  assert.deepEqual(hotfix.branches.map((branch) => branch.branch_id), ["BR001", "BR002", "BR003"]);
  assert.match(hotfix.branches[0].address, /Jalan Medan Tuanku 1/);
  assert.match(hotfix.branches[1].address, /Bintulu Sentral/);
  assert.match(hotfix.branches[2].address, /Bandar Riyal/);
  for (const branch of hotfix.branches) {
    assert.match(branch.google_maps, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
    assert.match(branch.waze, /^https:\/\/www\.waze\.com\/ul\?q=.*&navigate=yes$/);
  }
});


test("S00 extractor routes every address and navigation question to branch knowledge", () => {
  const blueprint = fs.readFileSync(blueprintPath, "utf8");

  assert.match(blueprint, /INTENT LOKASI WAJIB/);
  assert.match(blueprint, /alamat, lokasi, cawangan, branch, Google Maps, map atau Waze/);
  assert.match(blueprint, /knowledge_intent=loanbuddy_branch_addresses/);
});
