import {
  canEditExistingApplication,
} from "./access-control.mjs";
import {
  derivePostApprovalCase,
  latestLmsResult,
} from "./post-approval.mjs";

export const FULFILMENT_ACTIONS = Object.freeze({
  agreement_signed: Object.freeze({
    eventType: "FULFILMENT_AGREEMENT_SIGNED",
    label: "Record signed agreement",
    status: "AGREEMENT_SIGNED",
  }),
  direct_debit_registered: Object.freeze({
    eventType: "FULFILMENT_DIRECT_DEBIT_REGISTERED",
    label: "Confirm Direct Debit",
    status: "DIRECT_DEBIT_REGISTERED",
  }),
  disbursed: Object.freeze({
    eventType: "FULFILMENT_DISBURSED",
    label: "Record disbursement",
    status: "DISBURSED",
  }),
});

/**
 * @returns {{allowed: false, code: string, message: string, status: number, item?: any}}
 */
function denied(code, message, status = 409, item) {
  return { allowed: false, code, message, status, item };
}

function actionDefinition(action) {
  return FULFILMENT_ACTIONS[String(action || "").trim()];
}

export function fulfilmentActionForCase(item, user) {
  if (!item?.officialApproval || item?.dataIssues?.length || item?.disbursed)
    return null;
  const raw = item?.lead?.raw || item?.lead;
  if (!canEditExistingApplication(user, raw)) return null;
  if (!item.agreementSigned) return "agreement_signed";
  if (!item.directDebitReady) return "direct_debit_registered";
  if (["admin", "regional_manager"].includes(user?.role)) return "disbursed";
  return null;
}

/**
 * @param {{
 *   user?: any,
 *   lead?: any,
 *   lmsResults?: Array<Record<string, string>>,
 *   activities?: Array<Record<string, string>>,
 *   action?: string
 * }} input
 */
export function evaluateFulfilmentAction(input = {}) {
  const {
    user,
    lead,
    lmsResults = [],
    activities = [],
    action,
  } = input;
  const definition = actionDefinition(action);
  if (!definition)
    return denied(
      "UNSUPPORTED_ACTION",
      "Unsupported post-approval action.",
      400,
    );
  if (!user)
    return denied("UNAUTHENTICATED", "Authentication is required.", 401);
  if (!lead)
    return denied("LEAD_NOT_FOUND", "The requested case was not found.", 404);

  const raw = lead?.raw || lead;
  if (!canEditExistingApplication(user, raw))
    return denied(
      "CASE_ACCESS_DENIED",
      "You do not have permission to update this case.",
      403,
    );

  const leadId = String(lead?.id || raw?.["Lead ID"] || "").trim();
  const item = derivePostApprovalCase(
    lead,
    latestLmsResult(lmsResults, leadId),
    activities,
  );
  if (!item.officialApproval)
    return denied(
      "OFFICIAL_LMS_APPROVAL_REQUIRED",
      "The latest official LMS result must be APPROVED.",
      409,
      item,
    );
  if (item.dataIssues.length)
    return denied(
      "FULFILMENT_DATA_EXCEPTION",
      "Inconsistent fulfilment evidence must be resolved before continuing.",
      409,
      item,
    );

  if (action === "agreement_signed" && item.agreementSigned)
    return denied(
      "ALREADY_RECORDED",
      "The signed agreement is already recorded.",
      409,
      item,
    );
  if (action === "direct_debit_registered") {
    if (item.directDebitReady)
      return denied(
        "ALREADY_RECORDED",
        "Direct Debit registration is already recorded.",
        409,
        item,
      );
    if (!item.agreementSigned)
      return denied(
        "AGREEMENT_REQUIRED",
        "A signed agreement must be recorded first.",
        409,
        item,
      );
  }
  if (action === "disbursed") {
    if (item.disbursed)
      return denied(
        "ALREADY_RECORDED",
        "Disbursement is already recorded.",
        409,
        item,
      );
    if (!item.directDebitReady)
      return denied(
        "DIRECT_DEBIT_REQUIRED",
        "Direct Debit registration must be confirmed first.",
        409,
        item,
      );
    if (!["admin", "regional_manager"].includes(user.role))
      return denied(
        "REGIONAL_DISBURSEMENT_CONTROL_REQUIRED",
        "Only Admin or Regional Manager can record disbursement.",
        403,
        item,
      );
  }

  return {
    allowed: true,
    definition,
    item,
    leadId,
  };
}
