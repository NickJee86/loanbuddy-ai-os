export function inferProcessingRoute(row) {
  const explicit = String(row["Processing Route"] || "").trim().toUpperCase();
  if (explicit === "AI_DIRECT" || explicit === "SA_ASSIST") return explicit;
  const visibility = String(row["Case Visibility"] || "")
    .trim()
    .toUpperCase();
  if (visibility === "REGIONAL_ADMIN_ONLY") return "AI_DIRECT";
  if (visibility === "BRANCH_SA") return "SA_ASSIST";

  const source = String(row.Source || "").trim().toUpperCase();
  const assignmentTrigger = String(row["Assignment Trigger"] || "")
    .trim()
    .toUpperCase();
  const isManualSource =
    source === "CRM_MANUAL" ||
    Boolean(String(row["Manual Source Detail"] || "").trim());
  const isAssistedTrigger = [
    "LEGACY_ASSIGNMENT",
    "MANUAL_ASSIGNMENT",
    "MANUAL_REASSIGNMENT",
    "SA_ASSIST",
    "EXCEPTION",
  ].includes(assignmentTrigger);

  return row["Assigned Sales ID"] ||
    row["Escalation Reason"] ||
    isManualSource ||
    isAssistedTrigger
    ? "SA_ASSIST"
    : "AI_DIRECT";
}

export function canReviewSaCase(user, route) {
  return String(route || "").trim().toUpperCase() === "SA_ASSIST" &&
    ["admin", "regional_manager", "manager"].includes(user?.role);
}

export function canControlLmsQueue(user) {
  return ["admin", "regional_manager"].includes(user?.role);
}

export function visibleLeadsForUser(user, allLeads) {
  if (user.role === "admin" || user.role === "regional_manager") return allLeads;

  if (user.role === "staff") {
    if (!user.salesId) return [];
    return allLeads.filter((row) =>
      inferProcessingRoute(row) === "SA_ASSIST" &&
      user.branchIds.includes(row["Branch ID"]) &&
      row["Assigned Sales ID"] === user.salesId
    );
  }

  if (user.role === "manager" || user.role === "readonly") {
    return allLeads.filter((row) =>
      inferProcessingRoute(row) === "SA_ASSIST" &&
      user.branchIds.includes(row["Branch ID"])
    );
  }

  return [];
}

export function canEditExistingApplication(user, lead) {
  if (!user || !lead) return false;
  if (user.role === "admin" || user.role === "regional_manager") return true;
  if (user.role === "readonly") return false;
  return visibleLeadsForUser(user, [lead]).length === 1;
}

export function canContinueManualApplication(user, lead) {
  if (!canEditExistingApplication(user, lead)) return false;
  if (inferProcessingRoute(lead) !== "SA_ASSIST") return false;
  const status = String(lead["Lead Status"] || "").trim().toUpperCase();
  const stage = String(lead["Current Stage"] || "").trim().toUpperCase();
  return (status === "DRAFT" && stage === "MANUAL_APPLICATION") ||
    (status === "RETURNED_FOR_DOCUMENTS" && stage === "DOCUMENT_COLLECTION");
}

export function filterCrmDataForUser(user, rawData) {
  const visibleLeads = visibleLeadsForUser(user, rawData.Leads || []);
  const visibleLeadIds = new Set(visibleLeads.map((row) => row["Lead ID"]).filter(Boolean));
  const normalizePhone = (value) => String(value || "")
    .replace(/\D/g, "")
    .replace(/^0/, "60");
  const visiblePhones = new Set(
    visibleLeads
      .map((row) => normalizePhone(row["Phone Number"]))
      .filter(Boolean),
  );
  const canSeeUnlinkedOperationalRows = user.role === "admin" || user.role === "regional_manager";
  const unlinkedCustomerActivityTabs = new Set([
    "Conversation_State",
    "Customer_Inbox",
    "Customer_Reply_Log",
    "Message_Outbox",
    "Document_Received_Log",
    "Document_Verification_Log",
    "Document_Request_Log",
  ]);
  const data = Object.fromEntries(
    Object.entries(rawData).map(([tab, rows]) => [
      tab,
      tab === "Leads"
        ? visibleLeads
        : tab === "Audit_Log" && canSeeUnlinkedOperationalRows
          ? rows
        : canSeeUnlinkedOperationalRows && unlinkedCustomerActivityTabs.has(tab)
          ? rows
        : rows.filter((row) => {
          if (row["Lead ID"] && visibleLeadIds.has(row["Lead ID"])) return true;
          const phone = normalizePhone(
            row["Phone Number"] || row.Phone || row.phone,
          );
          if (phone && visiblePhones.has(phone)) return true;
          if (!row["Lead ID"] && !phone && canSeeUnlinkedOperationalRows)
            return true;
          return false;
        }),
    ])
  );
  return { visibleLeads, data };
}
