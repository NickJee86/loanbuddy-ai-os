import test from "node:test";
import assert from "node:assert/strict";

import { countCompletedDocuments } from "../app/dashboard-metrics.mjs";

test("received documents are not counted as completed or verified", () => {
  const rows = [
    { Status: "RECEIVED" },
    { Status: "IN_PROGRESS" },
    { Status: "COMPLETE" },
    { Status: "COMPLETED" },
    { Status: "VERIFIED" },
  ];

  assert.equal(countCompletedDocuments(rows), 3);
});
