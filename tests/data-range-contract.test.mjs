import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const operationalReaders = [
  "app/api/applications/route.ts",
  "app/api/credit-policy/route.ts",
  "app/api/credit-bureau-consent/route.ts",
  "app/api/crm/route.ts",
  "app/api/documents/route.ts",
  "app/api/fulfilment/route.ts",
  "app/api/lms-queue/route.ts",
  "app/api/system/routing-migration/route.ts",
  "app/user-store.ts",
];

test("operational Google Sheet readers do not silently cap records", async () => {
  for (const path of operationalReaders) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /A1:[A-Z]+[1-9][0-9]+/,
      `${path} contains a fixed row cap`,
    );
  }
});
