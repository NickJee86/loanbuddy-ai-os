import {
  configuredUsers,
  type ConfiguredUser,
  type CrmRole,
  type CrmUser,
} from "./auth";
import { appendAudit } from "./google-sheets-write";
import { activeStateAfterPasswordReset } from "./account-policy.mjs";
import { googleSheetsWriteSuffix } from "./spreadsheet-write-policy.mjs";

const GOOGLE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const USERS_TAB = "CRM_Users";
const USER_HEADERS = [
  "Username",
  "Name",
  "Role",
  "Branch IDs",
  "Sales ID",
  "Password Hash",
  "Active",
  "Updated At",
  "Updated By",
];
const HASH_ITERATIONS = 210000;
const RETRYABLE_GOOGLE_STATUS = new Set([429, 500, 502, 503, 504]);

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};
type StoredUser = CrmUser & {
  passwordHash: string;
  active: boolean;
  rowNumber: number;
  updatedAt: string;
};
export type CrmUserInput = {
  username: string;
  name: string;
  role: CrmRole;
  branchIds?: string[];
  salesId?: string;
  active?: boolean;
  password?: string;
};

const ROLES: CrmRole[] = [
  "admin",
  "regional_manager",
  "manager",
  "staff",
  "readonly",
];
const ENV_PASSWORD = "ENV";

async function googleReadFetch(input: string, init: RequestInit = {}) {
  let response: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetch(input, {
        ...init,
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      if (attempt === 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      continue;
    }
    if (!RETRYABLE_GOOGLE_STATUS.has(response.status) || attempt === 1)
      return response;
    await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
  }
  if (!response)
    throw new Error("Google account store did not return a response.");
  return response;
}

function base64url(input: string | ArrayBuffer | Uint8Array) {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : input instanceof Uint8Array
        ? input
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
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function googleAccessToken(account: ServiceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const audience = account.token_uri || "https://oauth2.googleapis.com/token";
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: GOOGLE_SCOPE,
      aud: audience,
      iat: now,
      exp: now + 3600,
    }),
  );
  const pem = account.private_key.replace(
    /-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,
    "",
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(atob(pem), (char) => char.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  const response = await googleReadFetch(audience, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${base64url(signature)}`,
    }),
  });
  if (!response.ok)
    throw new Error(`Google authentication failed (${response.status}).`);
  return ((await response.json()) as { access_token: string }).access_token;
}

async function sheetContext() {
  const rawAccount = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!rawAccount || !sheetId)
    throw new Error("CRM account storage is not configured.");
  return {
    sheetId,
    token: await googleAccessToken(JSON.parse(rawAccount) as ServiceAccount),
  };
}

async function readValues(sheetId: string, token: string, range: string) {
  const response = await googleReadFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (response.status === 400) return [];
  if (!response.ok)
    throw new Error(`Unable to read account store (${response.status}).`);
  return ((await response.json()) as { values?: string[][] }).values || [];
}

async function writeValues(
  sheetId: string,
  token: string,
  range: string,
  values: string[][],
  append = false,
) {
  const suffix = googleSheetsWriteSuffix(append);
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}${suffix}`,
    {
      method: append ? "POST" : "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ values }),
    },
  );
  if (!response.ok)
    throw new Error(`Unable to update account store (${response.status}).`);
}

async function ensureUsersTab(sheetId: string, token: string) {
  const metadata = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}?fields=sheets.properties.title`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!metadata.ok)
    throw new Error(`Unable to inspect account store (${metadata.status}).`);
  const body = (await metadata.json()) as {
    sheets?: Array<{ properties?: { title?: string } }>;
  };
  const exists = (body.sheets || []).some(
    (sheet) => sheet.properties?.title === USERS_TAB,
  );
  if (!exists) {
    const created = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}:batchUpdate`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          requests: [
            {
              addSheet: {
                properties: {
                  title: USERS_TAB,
                  gridProperties: {
                    rowCount: 500,
                    columnCount: USER_HEADERS.length,
                  },
                },
              },
            },
          ],
        }),
      },
    );
    if (!created.ok)
      throw new Error(`Unable to create account store (${created.status}).`);
  }
  const existing = await readValues(sheetId, token, `${USERS_TAB}!A1:I1`);
  if (
    !existing.length ||
    USER_HEADERS.some((header, index) => existing[0]?.[index] !== header)
  )
    await writeValues(sheetId, token, `${USERS_TAB}!A1:I1`, [USER_HEADERS]);
}

function parseBranchIds(value: string) {
  return value
    .split(/[|,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseStoredUsers(values: string[][]): StoredUser[] {
  if (values.length < 2) return [];
  const headers = values[0];
  const at = (row: string[], name: string) => row[headers.indexOf(name)] || "";
  return values
    .slice(1)
    .map((row, index) => ({
      username: at(row, "Username").trim(),
      name: at(row, "Name").trim(),
      role: at(row, "Role") as CrmUser["role"],
      branchIds: parseBranchIds(at(row, "Branch IDs")),
      salesId: at(row, "Sales ID").trim() || undefined,
      passwordHash: at(row, "Password Hash"),
      active: !["NO", "FALSE", "INACTIVE", "0"].includes(
        at(row, "Active").trim().toUpperCase(),
      ),
      rowNumber: index + 2,
      updatedAt: at(row, "Updated At").trim(),
    }))
    .filter(
      (user) =>
        user.username &&
        user.name &&
        ["admin", "regional_manager", "manager", "staff", "readonly"].includes(
          user.role,
        ),
    );
}

async function storedUsers() {
  const { sheetId, token } = await sheetContext();
  return parseStoredUsers(
    await readValues(sheetId, token, `${USERS_TAB}!A1:I`),
  );
}

async function passwordHash(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: HASH_ITERATIONS },
    key,
    256,
  );
  return `pbkdf2_sha256$${HASH_ITERATIONS}$${base64url(salt)}$${base64url(bits)}`;
}

async function verifyPassword(password: string, encoded: string) {
  const [algorithm, iterationsText, saltText, expectedText] =
    encoded.split("$");
  const iterations = Number(iterationsText);
  if (
    algorithm !== "pbkdf2_sha256" ||
    !iterations ||
    !saltText ||
    !expectedText
  )
    return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: decodeBase64url(saltText),
        iterations,
      },
      key,
      256,
    ),
  );
  const expected = decodeBase64url(expectedText);
  if (bits.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < bits.length; index += 1)
    difference |= bits[index] ^ expected[index];
  return difference === 0;
}

function safeUser(user: ConfiguredUser | StoredUser): CrmUser {
  return {
    username: user.username,
    name: user.name,
    role: user.role,
    branchIds: user.branchIds || [],
    salesId: user.salesId,
  };
}

function legacyAdmin(): ConfiguredUser | null {
  const password = process.env.CRM_ACCESS_PASSWORD;
  if (!password) return null;
  return {
    username: "nick",
    name: "Nick",
    role: "admin",
    branchIds: [],
    password,
    active: true,
  };
}

function validateInput(input: CrmUserInput) {
  const username = input.username.trim().toLowerCase();
  const name = input.name.trim();
  const role = input.role;
  const branchIds = Array.from(
    new Set(
      (input.branchIds || [])
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
  const salesId = input.salesId?.trim().toUpperCase() || undefined;
  if (!/^[a-z0-9._-]{3,64}$/.test(username))
    throw new Error(
      "Username must contain 3-64 letters, numbers, dots, underscores or hyphens.",
    );
  if (!name) throw new Error("User name is required.");
  if (!ROLES.includes(role)) throw new Error("A valid user role is required.");
  if ((role === "manager" || role === "staff") && !branchIds.length)
    throw new Error("Manager and staff accounts require at least one branch.");
  if (role === "staff" && !salesId)
    throw new Error("Staff accounts require a Sales ID.");
  return { username, name, role, branchIds, salesId };
}

function rowFor(
  user: CrmUser,
  passwordHashValue: string,
  active: boolean,
  actor: string,
) {
  return [
    user.username,
    user.name,
    user.role,
    user.branchIds.join("|"),
    user.salesId || "",
    passwordHashValue,
    active ? "YES" : "NO",
    new Date().toISOString(),
    actor,
  ];
}

async function accountContext() {
  const { sheetId, token } = await sheetContext();
  await ensureUsersTab(sheetId, token);
  const values = await readValues(sheetId, token, `${USERS_TAB}!A1:I`);
  return { sheetId, token, users: parseStoredUsers(values) };
}

async function saveStoredUser(
  sheetId: string,
  token: string,
  current: StoredUser | undefined,
  row: string[],
) {
  if (current)
    await writeValues(
      sheetId,
      token,
      `${USERS_TAB}!A${current.rowNumber}:I${current.rowNumber}`,
      [row],
    );
  else await writeValues(sheetId, token, `${USERS_TAB}!A:I`, [row], true);
}

async function auditAccount(
  sheetId: string,
  token: string,
  action: string,
  actor: string,
  username: string,
) {
  try {
    await appendAudit(sheetId, token, action, actor, "", username);
  } catch (auditError) {
    console.error(
      "[crm-users] Account updated but central audit append failed.",
      auditError,
    );
  }
}

export async function authenticateUser(
  username: string,
  password: string,
): Promise<CrmUser | null> {
  const normalized = username.trim().toLowerCase();
  try {
    const override = (await storedUsers()).find(
      (user) => user.username.toLowerCase() === normalized,
    );
    if (override) {
      if (!override.active) return null;
      if (override.passwordHash === ENV_PASSWORD) {
        const environmentUser =
          configuredUsers().find(
            (user) => user.username.toLowerCase() === normalized,
          ) || (legacyAdmin()?.username === normalized ? legacyAdmin() : null);
        return environmentUser?.password === password
          ? safeUser(override)
          : null;
      }
      return (await verifyPassword(password, override.passwordHash))
        ? safeUser(override)
        : null;
    }
  } catch {
    // Fail closed. Falling back to an environment password while the override store is
    // unavailable could make an old password valid again after an administrator reset.
    return null;
  }
  const fallback = configuredUsers().find(
    (user) =>
      user.username.toLowerCase() === normalized &&
      user.active !== false &&
      user.password === password,
  );
  if (fallback) return safeUser(fallback);
  const recovery = legacyAdmin();
  return recovery &&
    normalized === recovery.username &&
    recovery.password === password
    ? safeUser(recovery)
    : null;
}

export async function listCrmUsers(): Promise<
  Array<
    CrmUser & {
      active: boolean;
      passwordManagedInCrm: boolean;
      hasPassword: boolean;
    }
  >
> {
  const merged = new Map<
    string,
    CrmUser & {
      active: boolean;
      passwordManagedInCrm: boolean;
      hasPassword: boolean;
    }
  >();
  const recovery = legacyAdmin();
  if (recovery)
    merged.set(recovery.username, {
      ...safeUser(recovery),
      active: true,
      passwordManagedInCrm: false,
      hasPassword: true,
    });
  for (const user of configuredUsers())
    merged.set(user.username.toLowerCase(), {
      ...safeUser(user),
      active: user.active !== false,
      passwordManagedInCrm: false,
      hasPassword: true,
    });
  try {
    for (const user of await storedUsers())
      merged.set(user.username.toLowerCase(), {
        ...safeUser(user),
        active: user.active,
        passwordManagedInCrm: user.passwordHash !== ENV_PASSWORD,
        hasPassword: Boolean(user.passwordHash),
      });
  } catch {
    /* Return configured accounts when the sheet is unavailable. */
  }
  return Array.from(merged.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export async function resetCrmUserPassword(
  username: string,
  newPassword: string,
  actor: string,
) {
  if (newPassword.length < 12)
    throw new Error("Password must contain at least 12 characters.");
  const normalized = username.trim().toLowerCase();
  const envUser =
    configuredUsers().find(
      (user) => user.username.toLowerCase() === normalized,
    ) ||
    (legacyAdmin()?.username === normalized
      ? legacyAdmin() || undefined
      : undefined);
  const { sheetId, token, users } = await accountContext();
  const current = users.find(
    (user) => user.username.toLowerCase() === normalized,
  );
  const source = current || envUser;
  if (!source) throw new Error("User account was not found.");
  const row = rowFor(
    safeUser(source),
    await passwordHash(newPassword),
    activeStateAfterPasswordReset(current, envUser),
    actor,
  );
  await saveStoredUser(sheetId, token, current, row);
  await auditAccount(
    sheetId,
    token,
    "CRM_USER_PASSWORD_RESET",
    actor,
    normalized,
  );
  return safeUser(source);
}

export async function createCrmUser(input: CrmUserInput, actor: string) {
  const user = validateInput(input);
  const password = input.password || "";
  const active = input.active === true;
  if (password && password.length < 12)
    throw new Error("Password must contain at least 12 characters.");
  if (active && !password)
    throw new Error("Set a password before activating a new account.");
  const { sheetId, token, users } = await accountContext();
  if (
    users.some((item) => item.username.toLowerCase() === user.username) ||
    configuredUsers().some(
      (item) => item.username.toLowerCase() === user.username,
    ) ||
    legacyAdmin()?.username === user.username
  )
    throw new Error("Username already exists.");
  if (
    user.salesId &&
    [...users, ...configuredUsers()].some(
      (item) => item.salesId?.toUpperCase() === user.salesId,
    )
  )
    throw new Error("Sales ID already belongs to another account.");
  const hash = password ? await passwordHash(password) : "";
  await saveStoredUser(
    sheetId,
    token,
    undefined,
    rowFor(user, hash, active, actor),
  );
  await auditAccount(sheetId, token, "CRM_USER_CREATED", actor, user.username);
  return user;
}

export async function updateCrmUser(
  username: string,
  input: CrmUserInput,
  actor: string,
) {
  const normalized = username.trim().toLowerCase();
  const user = validateInput({ ...input, username: normalized });
  const { sheetId, token, users } = await accountContext();
  const current = users.find(
    (item) => item.username.toLowerCase() === normalized,
  );
  const environmentUser =
    configuredUsers().find(
      (item) => item.username.toLowerCase() === normalized,
    ) ||
    (legacyAdmin()?.username === normalized
      ? legacyAdmin() || undefined
      : undefined);
  if (!current && !environmentUser)
    throw new Error("User account was not found.");
  if (normalized === actor.trim().toLowerCase() && user.role !== "admin")
    throw new Error("An administrator cannot remove their own Admin role.");
  if (
    user.salesId &&
    [...users, ...configuredUsers()].some(
      (item) =>
        item.username.toLowerCase() !== normalized &&
        item.salesId?.toUpperCase() === user.salesId,
    )
  )
    throw new Error("Sales ID already belongs to another account.");
  const existingHash =
    current?.passwordHash || (environmentUser ? ENV_PASSWORD : "");
  const active =
    input.active ?? current?.active ?? environmentUser?.active !== false;
  if (active && !existingHash)
    throw new Error("Reset the password before activating this account.");
  await saveStoredUser(
    sheetId,
    token,
    current,
    rowFor(user, existingHash, active, actor),
  );
  await auditAccount(sheetId, token, "CRM_USER_UPDATED", actor, normalized);
  return user;
}

export async function setCrmUserActive(
  username: string,
  active: boolean,
  actor: string,
) {
  const normalized = username.trim().toLowerCase();
  const { sheetId, token, users } = await accountContext();
  const current = users.find(
    (item) => item.username.toLowerCase() === normalized,
  );
  const environmentUser =
    configuredUsers().find(
      (item) => item.username.toLowerCase() === normalized,
    ) ||
    (legacyAdmin()?.username === normalized
      ? legacyAdmin() || undefined
      : undefined);
  const source = current || environmentUser;
  if (!source) throw new Error("User account was not found.");
  if (!active && normalized === actor.trim().toLowerCase())
    throw new Error("An administrator cannot deactivate their own account.");
  const existingHash =
    current?.passwordHash || (environmentUser ? ENV_PASSWORD : "");
  if (active && !existingHash)
    throw new Error("Reset the password before activating this account.");
  await saveStoredUser(
    sheetId,
    token,
    current,
    rowFor(safeUser(source), existingHash, active, actor),
  );
  await auditAccount(
    sheetId,
    token,
    active ? "CRM_USER_ACTIVATED" : "CRM_USER_DEACTIVATED",
    actor,
    normalized,
  );
  return safeUser(source);
}

export async function sessionAccountState(username: string) {
  const normalized = username.trim().toLowerCase();
  const override = (await storedUsers()).find(
    (user) => user.username.toLowerCase() === normalized,
  );
  if (override)
    return {
      active: override.active,
      user: safeUser(override),
      version: `STORED:${override.updatedAt || "UNKNOWN"}`,
    };
  const environmentUser = configuredUsers().find(
    (user) => user.username.toLowerCase() === normalized,
  );
  if (environmentUser)
    return {
      active: environmentUser.active !== false,
      user: safeUser(environmentUser),
      version: "ENV",
    };
  const recovery = legacyAdmin();
  if (recovery && recovery.username === normalized)
    return { active: true, user: safeUser(recovery), version: "LEGACY" };
  return { active: false, user: null, version: "MISSING" };
}
