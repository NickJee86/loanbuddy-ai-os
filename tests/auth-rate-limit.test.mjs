import assert from "node:assert/strict";
import test from "node:test";
import {
  LOGIN_PASSWORD_MAX_LENGTH,
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  LOGIN_USERNAME_MAX_LENGTH,
  loginRateLimitAttemptKeys,
  loginRateLimitBucket,
  shouldReleaseLoginAttempt,
  validLoginCredentialShape,
} from "../app/auth-rate-limit.mjs";

test("login rate-limit windows and slots are deterministic", () => {
  const bucket = loginRateLimitBucket(30 * 60 * 1000);
  assert.equal(bucket, 2);
  const keys = loginRateLimitAttemptKeys("abc", bucket);
  assert.equal(keys.length, LOGIN_RATE_LIMIT_MAX_ATTEMPTS);
  assert.equal(new Set(keys).size, LOGIN_RATE_LIMIT_MAX_ATTEMPTS);
  assert.equal(keys[0], "2:abc:1");
});

test("login input is bounded before spreadsheet and password-hash work", () => {
  assert.equal(validLoginCredentialShape("nick", "correct-password"), true);
  assert.equal(validLoginCredentialShape("", "correct-password"), false);
  assert.equal(validLoginCredentialShape("nick", ""), false);
  assert.equal(validLoginCredentialShape("x".repeat(LOGIN_USERNAME_MAX_LENGTH + 1), "password"), false);
  assert.equal(validLoginCredentialShape("nick", "x".repeat(LOGIN_PASSWORD_MAX_LENGTH + 1)), false);
});

test("successful authentication does not consume a failed-login slot", () => {
  assert.equal(shouldReleaseLoginAttempt(true), true);
  assert.equal(shouldReleaseLoginAttempt(false), false);
});
