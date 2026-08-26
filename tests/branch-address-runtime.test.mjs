import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const hotfixPath = new URL(
  "../make/runtime-hotfixes/2026-08-26-branch-addresses.json",
  import.meta.url,
);

test("deployed branch-address runtime has three customer-facing branches and navigation links", () => {
  const hotfix = JSON.parse(fs.readFileSync(hotfixPath, "utf8"));
  const { intent_extractor: intent, reply_guardrail: reply, runtime_knowledge: kb } =
    hotfix.changes;

  assert.equal(hotfix.status, "DEPLOYED");
  assert.equal(intent.knowledge_intent, "branch_addresses");
  assert.equal(intent.preserve_requested_branch, true);
  assert.equal(kb.intent, "branch_addresses");
  assert.equal(kb.customer_facing, true);
  assert.deepEqual(
    kb.branches.map((branch) => branch.name),
    ["Kuala Lumpur", "Bintulu", "Kota Samarahan"],
  );
  for (const branch of kb.branches) {
    assert.ok(branch.address.length > 20);
    assert.match(branch.google_maps, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
    assert.match(branch.waze, /^https:\/\/www\.waze\.com\/ul\?q=.*&navigate=yes$/);
  }
  assert.equal(reply.specific_branch_only_when_named, true);
  assert.equal(reply.list_all_when_unspecified, true);
  assert.equal(reply.include_google_maps, true);
  assert.equal(reply.include_waze, true);
  assert.equal(reply.require_human_confirmation_for_approved_address, false);
  assert.equal(reply.invent_unlisted_branch, false);
});
