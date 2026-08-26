import assert from "node:assert/strict";
import test from "node:test";
import { detectSupportedDocumentMime } from "../app/file-signature.mjs";

test("document MIME is determined from file content", () => {
  assert.equal(detectSupportedDocumentMime(new TextEncoder().encode("%PDF-1.7")), "application/pdf");
  assert.equal(detectSupportedDocumentMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(detectSupportedDocumentMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(detectSupportedDocumentMime(new TextEncoder().encode("<html>not an image</html>")), "");
});
