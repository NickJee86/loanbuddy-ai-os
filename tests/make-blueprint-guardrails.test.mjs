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
