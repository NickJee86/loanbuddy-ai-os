export const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5;
export const LOGIN_USERNAME_MAX_LENGTH = 64;
export const LOGIN_PASSWORD_MAX_LENGTH = 256;

export function loginRateLimitBucket(now = Date.now()) {
  return Math.floor(now / LOGIN_RATE_LIMIT_WINDOW_MS);
}

export function loginRateLimitAttemptKeys(fingerprint, bucket = loginRateLimitBucket()) {
  return Array.from({ length: LOGIN_RATE_LIMIT_MAX_ATTEMPTS }, (_, index) => `${bucket}:${fingerprint}:${index + 1}`);
}

export function validLoginCredentialShape(username, password) {
  return typeof username === "string" && typeof password === "string" &&
    username.length > 0 && username.length <= LOGIN_USERNAME_MAX_LENGTH &&
    password.length > 0 && password.length <= LOGIN_PASSWORD_MAX_LENGTH;
}

export function shouldReleaseLoginAttempt(authenticated) {
  return authenticated === true;
}
