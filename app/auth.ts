export type CrmRole =
  | "admin"
  | "regional_manager"
  | "manager"
  | "staff"
  | "readonly";

export type CrmUser = {
  username: string;
  name: string;
  role: CrmRole;
  branchIds: string[];
  salesId?: string;
};

export type ConfiguredUser = CrmUser & { password: string; active?: boolean };

const COOKIE_NAME = "loanbuddy_crm_session";

function base64url(input: string | ArrayBuffer) {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : new Uint8Array(input);
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeBase64url(value: string) {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded);
}

async function signingKey() {
  const secret = process.env.CRM_SESSION_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("CRM_SESSION_SECRET must contain at least 32 characters.");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export function configuredUsers(): ConfiguredUser[] {
  const raw = process.env.CRM_USERS_JSON;
  if (!raw) return [];
  const parsed = JSON.parse(raw) as ConfiguredUser[];
  return parsed.filter(
    (user) =>
      user.active !== false &&
      user.username &&
      user.password &&
      user.name &&
      ["admin", "regional_manager", "manager", "staff", "readonly"].includes(
        user.role,
      ),
  );
}

export async function createSession(user: CrmUser) {
  const { sessionAccountState } = await import("./user-store");
  const account = await sessionAccountState(user.username);
  if (!account.active || !account.user)
    throw new Error("User account is inactive.");
  const payload = base64url(
    JSON.stringify({
      ...account.user,
      sessionVersion: account.version,
      exp: Date.now() + 12 * 60 * 60 * 1000,
    }),
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(),
    new TextEncoder().encode(payload),
  );
  return `${payload}.${base64url(signature)}`;
}

export async function verifySession(
  token: string | undefined,
): Promise<CrmUser | null> {
  if (!token) return null;
  try {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return null;
    const signatureBytes = Uint8Array.from(decodeBase64url(signature), (char) =>
      char.charCodeAt(0),
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(),
      signatureBytes,
      new TextEncoder().encode(payload),
    );
    if (!valid) return null;
    const decoded = JSON.parse(decodeBase64url(payload)) as CrmUser & {
      exp: number;
      sessionVersion?: string;
    };
    if (!decoded.exp || decoded.exp < Date.now()) return null;
    const { sessionAccountState } = await import("./user-store");
    const account = await sessionAccountState(decoded.username);
    const versionMatches = decoded.sessionVersion
      ? decoded.sessionVersion === account.version
      : ["ENV", "LEGACY"].includes(account.version);
    if (!account.active || !account.user || !versionMatches) return null;
    return account.user;
  } catch {
    return null;
  }
}

export function sessionCookie(token: string) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function sessionCookieName() {
  return COOKIE_NAME;
}
