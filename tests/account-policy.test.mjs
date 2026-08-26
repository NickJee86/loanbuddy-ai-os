import assert from "node:assert/strict";
import test from "node:test";
import { activeStateAfterPasswordReset } from "../app/account-policy.mjs";

test("password reset preserves an inactive stored account", () => {
  assert.equal(
    activeStateAfterPasswordReset({ active: false }, { active: true }),
    false,
  );
});

test("password reset preserves an active stored account", () => {
  assert.equal(activeStateAfterPasswordReset({ active: true }, null), true);
});

test("configured account state is used only when no stored override exists", () => {
  assert.equal(activeStateAfterPasswordReset(undefined, { active: false }), false);
  assert.equal(activeStateAfterPasswordReset(undefined, { active: true }), true);
});
