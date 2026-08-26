import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const blueprintPath = new URL(
  "../make/blueprints/s00-v4-unified-knowledge-ai-production.blueprint.json",
  import.meta.url,
);
const hotfixPath = new URL(
  "../make/runtime-hotfixes/2026-08-26-reply-latency.json",
  import.meta.url,
);

test("production reply composition uses the low-latency model and bounded WhatsApp output", () => {
  const blueprint = JSON.parse(fs.readFileSync(blueprintPath, "utf8"));
  const modules = [];

  function walk(value) {
    if (!value || typeof value !== "object") return;
    if (value.module) modules.push(value);
    for (const child of Object.values(value)) walk(child);
  }

  walk(blueprint);
  const reply = modules.find(
    (module) => module.metadata?.designer?.name === "AI — Compose Reply from State + Knowledge + Rules",
  );

  assert.ok(reply);
  assert.equal(reply.mapper.model, "gpt-5-mini");
  assert.equal(reply.mapper.max_tokens, "900");
  assert.equal(reply.mapper.response_format, "json_object");
  assert.equal(reply.mapper.parseJSONResponse, true);
});

test("deployed latency hotfix records the measured bottleneck and preserved controls", () => {
  const hotfix = JSON.parse(fs.readFileSync(hotfixPath, "utf8"));

  assert.equal(hotfix.status, "DEPLOYED");
  assert.equal(hotfix.diagnosis.total_duration_seconds, 24);
  assert.equal(hotfix.diagnosis.reply_composition_seconds, 19.2);
  assert.equal(hotfix.changes.reply_model.to, "gpt-5-mini");
  assert.equal(hotfix.changes.reply_max_tokens.to, 900);
  assert.equal(hotfix.changes.schedule, "Immediately as data arrives");
  assert.equal(hotfix.changes.scenario_active, true);
  assert.ok(hotfix.changes.preserved.includes("runtime knowledge"));
  assert.ok(hotfix.changes.preserved.includes("anti-repetition rules"));
});
