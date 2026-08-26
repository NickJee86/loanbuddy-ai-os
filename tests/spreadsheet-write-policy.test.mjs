import assert from "node:assert/strict";
import test from "node:test";
import {
  GOOGLE_SHEETS_VALUE_INPUT_OPTION,
  googleSheetsBatchWriteBody,
  googleSheetsWriteSuffix,
} from "../app/spreadsheet-write-policy.mjs";

test("CRM spreadsheet writes always preserve user text as literal RAW values", () => {
  assert.equal(GOOGLE_SHEETS_VALUE_INPUT_OPTION, "RAW");
  assert.equal(googleSheetsWriteSuffix(false), "?valueInputOption=RAW");
  assert.equal(
    googleSheetsWriteSuffix(true),
    ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
  );
  const data = [{ range: "Leads!A2", values: [["=IMPORTXML(\"https://invalid\")"]] }];
  assert.deepEqual(googleSheetsBatchWriteBody(data), {
    valueInputOption: "RAW",
    data,
  });
});
