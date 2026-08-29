import test from "node:test";
import assert from "node:assert/strict";
import { rowsToRecords } from "../app/google-sheets-write.ts";

test("sheet record row numbers preserve blank physical rows", () => {
  const records = rowsToRecords([
    ["Lead ID", "AI Status"],
    ["L1", "ACTIVE"],
    [],
    ["L2", "PAUSED_MANUAL"],
  ]);

  assert.deepEqual(records.map(({ rowNumber }) => rowNumber), [2, 4]);
  assert.equal(records[1].record["Lead ID"], "L2");
});
