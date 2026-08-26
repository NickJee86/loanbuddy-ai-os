import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  blankConsentTemplateCanSatisfyConsentGate,
  CONSENT_TEMPLATE,
  consentTemplateHeaders,
  consentTemplateMode,
} from "../app/consent-template.mjs";

test("the controlled walk-in template exposes the approved form identity", () => {
  assert.equal(CONSENT_TEMPLATE.formId, "Consent_BPH_V.40_01112020");
  assert.equal(CONSENT_TEMPLATE.version, "V4.0-01112020");
  assert.match(CONSENT_TEMPLATE.downloadFileName, /V4\.0-01112020\.pdf$/);
});

test("download and print modes receive safe PDF disposition headers", () => {
  assert.equal(consentTemplateMode("download"), "attachment");
  assert.equal(consentTemplateMode("inline"), "inline");
  assert.equal(consentTemplateMode("unexpected"), "inline");
  assert.match(
    consentTemplateHeaders("download")["content-disposition"],
    /^attachment;/,
  );
  assert.match(
    consentTemplateHeaders("inline")["content-disposition"],
    /^inline;/,
  );
  assert.equal(
    consentTemplateHeaders("inline")["cache-control"],
    "private, no-store, max-age=0, must-revalidate",
  );
});

test("a blank or printed template never satisfies the consent gate", () => {
  assert.equal(blankConsentTemplateCanSatisfyConsentGate(), false);
});

test("the private template asset is the exact approved PDF", async () => {
  const pdf = await readFile(
    new URL(
      "../assets/consent/Consent-Form-CCRIS-V4.0-01112020-ENG.pdf",
      import.meta.url,
    ),
  );
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.equal(pdf.length, 57254);
  assert.equal(
    createHash("sha256").update(pdf).digest("hex"),
    "7e3f0be6bc10ee4d2ad2d6f5912bd7d99e08606095fa7413e22aa53727161e50",
  );
});
