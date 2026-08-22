import { NextRequest, NextResponse } from "next/server";
import { sessionCookieName, verifySession } from "../../auth";
import {
  applyManagementApproval,
  buildDraftPolicy,
  POLICY_HEADERS,
  policyKey,
  policyStateIdempotencyKey,
  policyStatus,
  validateManagementApproval,
  validatePolicyForActivation,
} from "../../credit-policy.mjs";
import {
  buildCreditPolicyEngineConfig,
  CREDIT_POLICY_ENGINE_KEY,
  evaluateCreditPolicyEngineReadiness,
  readCreditPolicyEngineConfig,
  SYSTEM_CONFIG_HEADERS,
} from "../../credit-policy-control.mjs";
import {
  appendAudit,
  claimSpreadsheetIdempotency,
  readSheetValues,
  releaseSpreadsheetIdempotency,
  rowsToRecords,
  writableSheetContext,
  writeSheetValueRanges,
  writeSheetValues,
} from "../../google-sheets-write";

export const runtime = "nodejs";

type PolicyBody = {
  action?: "create" | "activate" | "retire" | "set-engine";
  policy?: Record<string, string>;
  policyCode?: string;
  policyVersion?: string;
  enabled?: boolean;
  confirmation?: string;
  approvedBy?: string;
  approvalDate?: string;
  approvalReference?: string;
};

async function policyContext() {
  const { sheetId, token } = await writableSheetContext();
  const [values, configValues] = await Promise.all([
    readSheetValues(sheetId, token, "Product_Credit_Policy!A1:Z"),
    readSheetValues(sheetId, token, "System_Config!A1:E"),
  ]);
  const headers = values[0] || [];
  const configHeaders = configValues[0] || [];
  if (POLICY_HEADERS.some((header) => !headers.includes(header)))
    throw new Error("Product_Credit_Policy headers are incomplete.");
  if (SYSTEM_CONFIG_HEADERS.some((header) => !configHeaders.includes(header)))
    throw new Error("System_Config headers are incomplete.");
  return {
    sheetId,
    token,
    headers,
    rows: rowsToRecords(values),
    configHeaders,
    configRows: rowsToRecords(configValues),
  };
}

export async function GET(request: NextRequest) {
  const user = await verifySession(
    request.cookies.get(sessionCookieName())?.value,
  );
  if (!user)
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (!["admin", "regional_manager"].includes(user.role))
    return NextResponse.json(
      { error: "Credit policy access denied." },
      { status: 403 },
    );
  try {
    const { rows, configRows } = await policyContext();
    const policyRecords = rows.map(({ record }) => record);
    const config = readCreditPolicyEngineConfig(
      configRows.map(({ record }) => record),
    );
    const readiness = evaluateCreditPolicyEngineReadiness(policyRecords);
    return NextResponse.json({
      policies: rows.map(({ record }) => ({
        ...record,
        activation: validatePolicyForActivation(record),
      })),
      engine: {
        ...config,
        ...readiness,
        operational: config.enabled && readiness.canEnable,
        activePolicy: readiness.activePolicy
          ? {
              code: readiness.activePolicy["Policy Code"] || "",
              version: readiness.activePolicy["Policy Version"] || "",
            }
          : null,
      },
      canManage: user.role === "admin",
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to load credit policies.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const user = await verifySession(
    request.cookies.get(sessionCookieName())?.value,
  );
  if (!user)
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (user.role !== "admin")
    return NextResponse.json(
      { error: "Only an administrator can change credit policy." },
      { status: 403 },
    );
  try {
    const body = (await request.json()) as PolicyBody;
    if (
      !body.action ||
      !["create", "activate", "retire", "set-engine"].includes(body.action)
    )
      return NextResponse.json(
        { error: "Unsupported policy action." },
        { status: 400 },
      );
    const {
      sheetId,
      token,
      headers,
      rows,
      configHeaders,
      configRows,
    } = await policyContext();
    const policyRecords = rows.map(({ record }) => record);
    const configRecords = configRows.map(({ record }) => record);
    const engineConfig = readCreditPolicyEngineConfig(configRecords);

    if (body.action === "set-engine") {
      if (typeof body.enabled !== "boolean")
        return NextResponse.json(
          { error: "A true or false engine state is required." },
          { status: 400 },
        );
      const expectedConfirmation = body.enabled
        ? "ENABLE_POLICY_ENGINE"
        : "DISABLE_POLICY_ENGINE";
      if (body.confirmation !== expectedConfirmation)
        return NextResponse.json(
          { error: "Credit Policy Engine confirmation is required." },
          { status: 400 },
        );
      const readiness = evaluateCreditPolicyEngineReadiness(policyRecords);
      if (body.enabled && !readiness.canEnable)
        return NextResponse.json(
          {
            error:
              "Credit Policy Engine cannot be enabled until exactly one complete, approved and effective ACTIVE policy exists.",
            reasons: readiness.reasons,
          },
          { status: 409 },
        );
      if (engineConfig.configured && engineConfig.enabled === body.enabled)
        return NextResponse.json({
          ok: true,
          status: body.enabled ? "POLICY_ENGINE_ON" : "POLICY_ENGINE_OFF",
          unchanged: true,
        });

      const matchingRows = configRows.filter(
        ({ record }) =>
          String(record["Config Key"] || "").trim().toUpperCase() ===
          CREDIT_POLICY_ENGINE_KEY,
      );
      if (matchingRows.length > 1)
        throw new Error(
          "System_Config contains duplicate Credit Policy Engine controls.",
        );
      const existingRow = matchingRows[0] || null;
      const reservation = await claimSpreadsheetIdempotency(
        sheetId,
        token,
        "LOANBUDDY_CREDIT_POLICY_ENGINE_MUTATION",
        `${engineConfig.rawValue || "MISSING"}:${engineConfig.updatedAt || "INITIAL"}->${body.enabled ? "ON" : "OFF"}`,
      );
      if (!reservation.claimed)
        return NextResponse.json(
          {
            error:
              "Credit Policy Engine changed in another request. Reload and try again.",
          },
          { status: 409 },
        );
      const now = new Date().toISOString();
      const configRecord = buildCreditPolicyEngineConfig(
        body.enabled,
        now,
      ) as Record<string, string>;
      try {
        await writeSheetValues(
          sheetId,
          token,
          existingRow
            ? `System_Config!A${existingRow.rowNumber}:E${existingRow.rowNumber}`
            : "System_Config!A:E",
          [configHeaders.map((header) => configRecord[header] || "")],
          !existingRow,
        );
      } catch (writeError) {
        try {
          await releaseSpreadsheetIdempotency(
            sheetId,
            token,
            reservation.metadataId,
          );
        } catch (releaseError) {
          console.error(
            "[credit-policy] Unable to release failed engine reservation.",
            releaseError,
          );
        }
        throw writeError;
      }
      try {
        await appendAudit(
          sheetId,
          token,
          body.enabled
            ? "CREDIT_POLICY_ENGINE_ENABLED"
            : "CREDIT_POLICY_ENGINE_DISABLED",
          user.username,
          "",
          body.enabled && readiness.activePolicy
            ? `${readiness.activePolicy["Policy Code"]}/${readiness.activePolicy["Policy Version"]}`
            : "POLICY_AND_THRESHOLDS_LOCKED",
        );
      } catch (auditError) {
        console.error(
          "[credit-policy] Engine changed but audit append failed.",
          auditError,
        );
      }
      return NextResponse.json({
        ok: true,
        status: body.enabled ? "POLICY_ENGINE_ON" : "POLICY_ENGINE_OFF",
      });
    }

    if (body.action === "create") {
      const policy = buildDraftPolicy(body.policy) as Record<string, string>;
      if (!policy["Policy Code"] || !policy["Policy Version"])
        return NextResponse.json(
          { error: "Policy Code and Policy Version are required." },
          { status: 400 },
        );
      if (rows.some(({ record }) => policyKey(record) === policyKey(policy)))
        return NextResponse.json(
          {
            error:
              "This policy version already exists and cannot be overwritten.",
          },
          { status: 409 },
        );
      const reservation = await claimSpreadsheetIdempotency(
        sheetId,
        token,
        "LOANBUDDY_CREDIT_POLICY_VERSION",
        policyKey(policy),
      );
      if (!reservation.claimed)
        return NextResponse.json(
          {
            error:
              "This policy version already exists or is being created and cannot be overwritten.",
          },
          { status: 409 },
        );
      try {
        await writeSheetValues(
          sheetId,
          token,
          "Product_Credit_Policy!A:Z",
          [headers.map((header) => policy[header] || "")],
          true,
        );
      } catch (writeError) {
        try {
          await releaseSpreadsheetIdempotency(
            sheetId,
            token,
            reservation.metadataId,
          );
        } catch (releaseError) {
          console.error(
            "[credit-policy] Unable to release failed version reservation.",
            releaseError,
          );
        }
        throw writeError;
      }
      try {
        await appendAudit(
          sheetId,
          token,
          "CREDIT_POLICY_VERSION_CREATED",
          user.username,
          "",
          `${policy["Policy Code"]}/${policy["Policy Version"]}`,
        );
      } catch (auditError) {
        console.error(
          "[credit-policy] Version created but audit append failed.",
          auditError,
        );
      }
      return NextResponse.json({ ok: true, status: "DRAFT_CREATED" });
    }

    const selected = rows.find(
      ({ record }) =>
        policyKey(record) ===
        `${String(body.policyCode || "")
          .trim()
          .toUpperCase()}::${String(body.policyVersion || "")
          .trim()
          .toUpperCase()}`,
    );
    if (!selected)
      return NextResponse.json(
        { error: "Policy version was not found." },
        { status: 404 },
      );
    if (policyStatus(selected.record) === "SHADOW")
      return NextResponse.json(
        {
          error:
            "The V1 shadow baseline is immutable. Create a new policy version.",
        },
        { status: 409 },
      );

    const claimMutation = async () => {
      const policyCode = String(selected.record["Policy Code"] || "")
        .trim()
        .toUpperCase();
      const reservation = await claimSpreadsheetIdempotency(
        sheetId,
        token,
        "LOANBUDDY_CREDIT_POLICY_MUTATION",
        policyStateIdempotencyKey(
          rows.map(({ record }) => record),
          policyCode,
        ),
      );
      if (!reservation.claimed)
        return NextResponse.json(
          {
            error:
              "Credit policy changed in another request. Reload the policy list and try again.",
          },
          { status: 409 },
        );
      return reservation;
    };

    if (body.action === "activate") {
      if (engineConfig.enabled)
        return NextResponse.json(
          {
            error:
              "Disable the Credit Policy Engine before changing the ACTIVE policy.",
          },
          { status: 409 },
        );
      if (policyStatus(selected.record) !== "DRAFT")
        return NextResponse.json(
          {
            error:
              "Only a DRAFT policy version can be activated. Retired versions are terminal.",
          },
          { status: 409 },
        );
      if (body.confirmation !== "ACTIVATE")
        return NextResponse.json(
          { error: "Activation confirmation is required." },
          { status: 400 },
        );
      const validation = validatePolicyForActivation(selected.record);
      if (!validation.valid)
        return NextResponse.json(
          {
            error: `Policy cannot be activated: ${validation.errors.join(", ")}`,
            reasons: validation.errors,
          },
          { status: 409 },
        );
      const managementApproval = validateManagementApproval({
        approvedBy: body.approvedBy,
        approvalDate: body.approvalDate,
        approvalReference: body.approvalReference,
      });
      if (!managementApproval.valid)
        return NextResponse.json(
          {
            error:
              "Policy activation requires the real management approver, approval date and approval reference.",
            reasons: managementApproval.errors,
          },
          { status: 409 },
        );
      const reservation = await claimMutation();
      if (reservation instanceof NextResponse) return reservation;
      const updates: Array<{ range: string; values: string[][] }> = [];
      for (const row of rows) {
        const sameProduct =
          String(row.record["Policy Code"] || "")
            .trim()
            .toUpperCase() ===
          String(selected.record["Policy Code"] || "")
            .trim()
            .toUpperCase();
        if (
          sameProduct &&
          policyStatus(row.record) === "ACTIVE" &&
          row.rowNumber !== selected.rowNumber
        ) {
          const retired: Record<string, string> = {
            ...row.record,
            Status: "RETIRED",
          };
          updates.push({
            range: `Product_Credit_Policy!A${row.rowNumber}:Z${row.rowNumber}`,
            values: [headers.map((header) => retired[header] || "")],
          });
        }
      }
      const activated = applyManagementApproval(
        selected.record,
        managementApproval,
      ) as Record<string, string>;
      updates.push({
        range: `Product_Credit_Policy!A${selected.rowNumber}:Z${selected.rowNumber}`,
        values: [headers.map((header) => activated[header] || "")],
      });
      try {
        await writeSheetValueRanges(sheetId, token, updates);
      } catch (writeError) {
        try {
          await releaseSpreadsheetIdempotency(
            sheetId,
            token,
            reservation.metadataId,
          );
        } catch (releaseError) {
          console.error(
            "[credit-policy] Unable to release failed activation reservation.",
            releaseError,
          );
        }
        throw writeError;
      }
      try {
        await appendAudit(
          sheetId,
          token,
          "CREDIT_POLICY_ACTIVATED",
          user.username,
          "",
          `${activated["Policy Code"]}/${activated["Policy Version"]} | APPROVED_BY=${managementApproval.approvedBy} | APPROVAL_REF=${managementApproval.approvalReference}`,
        );
      } catch (auditError) {
        console.error(
          "[credit-policy] Policy activated but audit append failed.",
          auditError,
        );
      }
      return NextResponse.json({ ok: true, status: "ACTIVE" });
    }

    if (body.action === "retire") {
      if (!["DRAFT", "ACTIVE"].includes(policyStatus(selected.record)))
        return NextResponse.json(
          { error: "Only a DRAFT or ACTIVE policy version can be retired." },
          { status: 409 },
        );
      if (body.confirmation !== "RETIRE")
        return NextResponse.json(
          { error: "Retirement confirmation is required." },
          { status: 400 },
        );
      if (
        policyStatus(selected.record) === "ACTIVE" &&
        engineConfig.enabled
      )
        return NextResponse.json(
          {
            error:
              "Disable the Credit Policy Engine before retiring the ACTIVE policy.",
          },
          { status: 409 },
        );
      const reservation = await claimMutation();
      if (reservation instanceof NextResponse) return reservation;
      const retired: Record<string, string> = {
        ...selected.record,
        Status: "RETIRED",
      };
      try {
        await writeSheetValues(
          sheetId,
          token,
          `Product_Credit_Policy!A${selected.rowNumber}:Z${selected.rowNumber}`,
          [headers.map((header) => retired[header] || "")],
        );
      } catch (writeError) {
        try {
          await releaseSpreadsheetIdempotency(
            sheetId,
            token,
            reservation.metadataId,
          );
        } catch (releaseError) {
          console.error(
            "[credit-policy] Unable to release failed retirement reservation.",
            releaseError,
          );
        }
        throw writeError;
      }
      try {
        await appendAudit(
          sheetId,
          token,
          "CREDIT_POLICY_RETIRED",
          user.username,
          "",
          `${retired["Policy Code"]}/${retired["Policy Version"]}`,
        );
      } catch (auditError) {
        console.error(
          "[credit-policy] Policy retired but audit append failed.",
          auditError,
        );
      }
      return NextResponse.json({ ok: true, status: "RETIRED" });
    }

    return NextResponse.json(
      { error: "Unsupported policy action." },
      { status: 400 },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to change credit policy.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
