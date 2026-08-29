import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const blueprint = JSON.parse(
  await readFile(
    new URL(
      "../make/blueprints/s00-v4-unified-knowledge-ai-production.blueprint.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

function modules(flow = blueprint.flow) {
  return flow.flatMap((node) => [
    node,
    ...(node.routes || []).flatMap((route) => modules(route.flow || [])),
  ]);
}

test("production reply composer enforces concise human WhatsApp style", () => {
  const composer = modules().find((node) => node.id === 19);
  assert.ok(composer, "reply composer module 19 must exist");

  const systemPrompt = composer.mapper.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n");

  assert.match(systemPrompt, /1-2 ayat pendek/);
  assert.match(systemPrompt, /SATU soalan utama/);
  assert.match(systemPrompt, /Secara lalai JANGAN guna emoji/);
  assert.match(systemPrompt, /Minta dokumen secara berperingkat/);
  assert.match(systemPrompt, /Follow-up mesti merujuk tindakan tertunggak paling kecil sahaja/);
  assert.match(systemPrompt, /Jangan mengaku manusia/);
  assert.equal(composer.mapper.max_tokens, "1200");
  assert.equal(composer.mapper.temperature, "0.7");
});
