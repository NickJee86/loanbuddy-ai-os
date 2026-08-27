"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { countCompletedDocuments } from "./dashboard-metrics.mjs";
import {
  accountReadiness,
  accountReadinessSummary,
} from "./account-readiness.mjs";
import {
  buildConversationRows,
  buildConversationSummaries,
  DOCUMENT_DEFINITIONS,
} from "./customer-360.mjs";
import { assessAutomationDecision } from "./workflow-policy.mjs";
import {
  buildBranchOptions,
  filterCrmDataByDate,
  isSyntheticLead,
  pipelineCounts,
  recentLeads,
} from "./crm-normalization.mjs";
import {
  canContinueManualApplication,
  canReviewSaCase,
  inferProcessingRoute,
} from "./access-control.mjs";
import { buildActionCenter } from "./action-center.mjs";
import {
  buildApplicationRegister,
  formatConfidence,
  latestRow,
  mergedFollowUpRows,
  mergedQualificationRows,
  qualificationSnapshot,
  rowsForVisibleLeads,
} from "./case-workspace.mjs";
import ManagementReports from "./reports";
import { evaluateLmsQueueEligibility } from "./lms-queue.mjs";
import {
  cloneCreditPolicyDraft,
  readCreditPolicyEngineConfig,
} from "./credit-policy-control.mjs";
import { validateManagementApproval } from "./credit-policy.mjs";
import { buildLmsStatus } from "./lms-status.mjs";
import {
  buildPostApprovalCases,
  derivePostApprovalCase,
  latestLmsResult,
} from "./post-approval.mjs";
import {
  FULFILMENT_ACTIONS,
  fulfilmentActionForCase,
} from "./fulfilment-control.mjs";
import { CONSENT_TEMPLATE } from "./consent-template.mjs";
import WhatsAppConsole from "./whatsapp-console";
import { DEFAULT_FOLLOW_UP_SETTINGS } from "./follow-up-control.mjs";

type NavKey =
  | "New Application"
  | "Dashboard"
  | "Action Center"
  | "Reports"
  | "Applications"
  | "Customers"
  | "Work Queue"
  | "Leads"
  | "Qualification"
  | "Documents"
  | "Verification"
  | "Credit Assessment"
  | "Follow-up"
  | "Conversations"
  | "Escalations"
  | "LMS Status"
  | "Post-Approval"
  | "Follow-up Settings"
  | "Credit Policy"
  | "Audit Log"
  | "User Management";

type DateRange = "All Time" | "This Month" | "Last 30 Days" | "This Quarter";

type Lead = {
  id: string;
  name: string;
  phone: string;
  branch: string;
  owner: string;
  stage: string;
  score: number;
  amount: string;
  updated: string;
  documentStatus: string;
  risk: string;
  aiAssessment: string;
  lmsStatus: string;
  processingRoute: "AI_DIRECT" | "SA_ASSIST";
  caseVisibility: string;
  escalationReason: string;
  raw: Record<string, string>;
};

type SheetRow = Record<string, string>;
type PostApprovalCase = {
  lead: Lead;
  leadId: string;
  lmsDecision: string;
  officialApproval: boolean;
  dataIssues: string[];
  stage: string;
  tone: "teal" | "blue" | "amber" | "red" | "gray";
  nextAction: string;
  approvedAt: string;
  agreementStatus: string;
  agreementSigned: boolean;
  directDebitStatus: string;
  directDebitReady: boolean;
  disbursementStatus: string;
  disbursed: boolean;
  disbursedAt: string;
};
type CrmResponse = {
  connected: boolean;
  stale?: boolean;
  spreadsheet?: string;
  error?: string;
  data?: Record<string, SheetRow[]>;
  fetchedAt?: string;
  dataUpdatedAt?: string;
  user?: CrmUser;
};

type CrmUser = {
  username: string;
  name: string;
  role: "admin" | "regional_manager" | "manager" | "staff" | "readonly";
  branchIds: string[];
  salesId?: string;
};

function ConsentTemplateActions({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`consent-template-card ${compact ? "compact" : ""}`}>
      <div>
        <span className="consent-template-label">WALK-IN CONSENT TEMPLATE</span>
        <strong>CTOS / CCRIS Consent Authorisation</strong>
        <small>
          {CONSENT_TEMPLATE.formId} · {CONSENT_TEMPLATE.version}. Print the
          blank form for the customer to complete and sign. A blank form is not
          proof of consent.
        </small>
      </div>
      <div className="consent-template-actions">
        <a href="/api/consent-template?mode=download">Download PDF</a>
        <a
          href="/api/consent-template?mode=inline"
          target="_blank"
          rel="noreferrer"
        >
          Open / Print
        </a>
      </div>
    </div>
  );
}

function mapSheetLead(row: Record<string, string>): Lead {
  const processingRoute = inferProcessingRoute(row) as
    | "AI_DIRECT"
    | "SA_ASSIST";
  return {
    id: row["Lead ID"] || "—",
    name: row["Lead Name"] || "Unnamed lead",
    phone: row["Phone Number"] || "—",
    branch: row["Branch ID"] || "Not assigned",
    owner:
      row["Assigned Sales ID"] ||
      (processingRoute === "AI_DIRECT" ? "AI managed" : "Unassigned"),
    stage: row["Current Stage"] || row["Lead Status"] || "New",
    score: Number(row["Lead Score"] || 0),
    amount: row["Loan Amount Requested"]
      ? `RM ${row["Loan Amount Requested"]}`
      : "—",
    updated: row["Last AI Update"] || row["Created Date"] || "—",
    documentStatus: row["Document Status"] || "Not Started",
    risk: row["Risk Level"] || "Unknown",
    aiAssessment: row["AI Assessment"] || "No AI assessment recorded.",
    lmsStatus: row["LMS Status"] || "Not Submitted",
    processingRoute,
    caseVisibility:
      row["Case Visibility"] ||
      (processingRoute === "AI_DIRECT" ? "REGIONAL_ADMIN_ONLY" : "BRANCH_SA"),
    escalationReason: row["Escalation Reason"] || "—",
    raw: row,
  };
}

const navigationSections: Array<{
  label: string;
  items: Array<{ label: NavKey; title?: string; icon: string }>;
}> = [
  {
    label: "Daily Work",
    items: [
      { label: "Dashboard", title: "Home", icon: "▦" },
      { label: "Action Center", title: "Today", icon: "!" },
      { label: "Customers", title: "Customer Records", icon: "◎" },
      { label: "Work Queue", title: "Work Queue", icon: "◇" },
      { label: "New Application", title: "New Application", icon: "+" },
    ],
  },
  {
    label: "Management",
    items: [
      { label: "Reports", icon: "▥" },
    ],
  },
  {
    label: "LMS & Disbursement",
    items: [
      { label: "LMS Status", icon: "⬡" },
      { label: "Post-Approval", icon: "→" },
    ],
  },
  {
    label: "Administration",
    items: [
      { label: "Follow-up Settings", icon: "⏱" },
      { label: "Credit Policy", icon: "▧" },
      { label: "Audit Log", icon: "≡" },
      { label: "User Management", icon: "⚙" },
    ],
  },
];

function navigationTitle(active: NavKey) {
  const item = navigationSections
    .flatMap((section) => section.items)
    .find((entry) => entry.label === active);
  return item?.title || active;
}

const pageDescriptions: Record<NavKey, string> = {
  "New Application":
    "Create, save and submit a manual customer application securely.",
  Dashboard: "Live operational overview across the LoanBuddy customer journey.",
  "Action Center":
    "One role-scoped list of cases, exceptions, data gaps and system gates that need attention.",
  Reports:
    "Executive KPI, conversion, branch, staff, source, AI and risk reporting calculated from production data.",
  Customers:
    "One customer workspace for conversations, documents, qualification, verification and LMS status.",
  "Work Queue": "Prioritised operational queues for cases that need attention.",
  Leads:
    "Search and review every captured lead without changing source records.",
  Applications:
    "Manage every visible case by qualification, document, verification, credit and LMS readiness.",
  Qualification:
    "Monitor qualification progress and the next question required.",
  Documents: "Track mandatory document collection and outstanding requests.",
  Verification:
    "Review AI document checks, confidence and manual-review queues.",
  "Credit Assessment":
    "Review deterministic DSR, NDI, policy rules and LMS eligibility. LMS remains the final credit decision.",
  "Follow-up": "See scheduled customer follow-ups and overdue actions.",
  Conversations: "Read the latest customer and system message history.",
  Escalations: "Monitor open manual reviews and operational exceptions.",
  "LMS Status":
    "Track cases waiting for LMS, submitted cases and processing status.",
  "Post-Approval":
    "Track officially approved cases through agreement, Direct Debit registration and disbursement.",
  "Follow-up Settings":
    "Control automatic reminders for incomplete information and documents without editing Make scenarios.",
  "Credit Policy":
    "Version, validate and approve the deterministic Pre-LMS credit policy without overwriting history.",
  "Audit Log":
    "Review the append-only control trail for CRM policy, queue and administrative actions.",
  "User Management":
    "Administer staff access and reset individual account passwords.",
};

function Chip({
  children,
  tone = "teal",
}: {
  children: React.ReactNode;
  tone?: "teal" | "blue" | "amber" | "red" | "gray";
}) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

function StageChip({ stage }: { stage: string }) {
  const tone =
    stage === "Qualified" || stage === "Documents"
      ? "teal"
      : stage === "Manual Review"
        ? "red"
        : stage === "Contacted"
          ? "blue"
          : "gray";
  return <Chip tone={tone}>{stage}</Chip>;
}

function Sidebar({
  active,
  onChange,
  connected,
  stale,
  role,
}: {
  active: NavKey;
  onChange: (value: NavKey) => void;
  connected: boolean;
  stale?: boolean;
  role?: CrmUser["role"];
}) {
  const canShow = (label: NavKey) => {
    if (label === "User Management") return role === "admin";
    if (label === "Reports")
      return ["admin", "regional_manager", "manager", "readonly"].includes(
        role || "",
      );
    if (label === "Credit Policy")
      return role === "admin" || role === "regional_manager";
    if (label === "Follow-up Settings")
      return ["admin", "regional_manager", "manager"].includes(role || "");
    if (label === "Audit Log")
      return role === "admin" || role === "regional_manager";
    return true;
  };
  return (
    <aside className="sidebar">
      <div className="brand-panel">
        <Image
          src="/loanbuddy-logo.png"
          alt="LoanBuddy Credit"
          className="brand-logo"
          width={414}
          height={188}
          priority
        />
        <span className="readonly-badge">
          {role ? role.toUpperCase() : "SECURE"}
        </span>
      </div>
      <nav className="sidebar-navigation" aria-label="Primary navigation">
        {navigationSections.map((section) => {
          const items = section.items.filter((item) => canShow(item.label));
          if (!items.length) return null;
          return (
            <div className="nav-section" key={section.label}>
              <span className="nav-section-title">{section.label}</span>
              {items.map((item) => (
                <button
                  key={item.label}
                  className={`nav-item ${active === item.label ? "active" : ""}`}
                  onClick={() => onChange(item.label)}
                >
                  <span className="nav-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span>{item.title || item.label}</span>
                </button>
              ))}
            </div>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        <div className="status-dot" />
        <div>
          <strong>
            {connected
              ? stale
                ? "Production cache only"
                : "Production connected"
              : "Connection unavailable"}
          </strong>
          <span>
            {connected
              ? stale
                ? "Google Sheets unavailable · stale data"
                : "Google Sheets · live access"
              : "No customer data shown"}
          </span>
        </div>
      </div>
    </aside>
  );
}

function Topbar({
  active,
  branch,
  setBranch,
  branches,
  dateRange,
  setDateRange,
  user,
  notificationCount,
  onNotifications,
  leads,
  onCustomer,
}: {
  active: NavKey;
  branch: string;
  setBranch: (value: string) => void;
  branches: string[];
  dateRange: DateRange;
  setDateRange: (value: DateRange) => void;
  user?: CrmUser;
  notificationCount: number;
  onNotifications: () => void;
  leads: Lead[];
  onCustomer: (lead: Lead) => void;
}) {
  const [customerQuery, setCustomerQuery] = useState("");
  const normalizedQuery = customerQuery.trim().toLowerCase();
  const customerMatches = normalizedQuery
    ? leads
        .filter((lead) =>
          `${lead.name} ${lead.phone} ${lead.id} ${Object.values(lead.raw).join(" ")}`
            .toLowerCase()
            .includes(normalizedQuery),
        )
        .slice(0, 6)
    : [];
  const initials =
    user?.name
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "—";
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">LOANBUDDY CRM</p>
        <h1>{navigationTitle(active)}</h1>
      </div>
      <div className="topbar-actions">
        <div className="global-customer-search">
          <label>
            <span>⌕</span>
            <input
              aria-label="Search all customers"
              value={customerQuery}
              onChange={(event) => setCustomerQuery(event.target.value)}
              placeholder="Search name, phone, IC or Lead ID"
            />
          </label>
          {normalizedQuery && (
            <div className="global-search-results">
              {customerMatches.length ? (
                customerMatches.map((lead) => (
                  <button
                    key={lead.id}
                    onClick={() => {
                      onCustomer(lead);
                      setCustomerQuery("");
                    }}
                  >
                    <span className="global-search-avatar">
                      {lead.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span>
                      <strong>{lead.name}</strong>
                      <small>{customerReference(lead)}</small>
                    </span>
                    <StageChip stage={lead.stage} />
                  </button>
                ))
              ) : (
                <div className="global-search-empty">No customer found</div>
              )}
            </div>
          )}
        </div>
        <label className="select-shell">
          <span>▦</span>
          <select
            aria-label="Branch"
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
          >
            <option>All Branches</option>
            {branches.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="select-shell">
          <span>▣</span>
          <select
            aria-label="Date range"
            value={dateRange}
            onChange={(event) => setDateRange(event.target.value as DateRange)}
          >
            <option>All Time</option>
            <option>This Month</option>
            <option>Last 30 Days</option>
            <option>This Quarter</option>
          </select>
        </label>
        <button
          className="icon-button"
          aria-label={`${notificationCount} open notifications`}
          onClick={onNotifications}
          title="Open Action Center"
        >
          ♢
          {notificationCount > 0 && (
            <span className="notification-count">
              {notificationCount > 99 ? "99+" : notificationCount}
            </span>
          )}
        </button>
        <button
          className="profile profile-button"
          onClick={logout}
          title="Sign out"
        >
          <span className="avatar">{initials}</span>
          <div>
            <strong>{user?.name || "Loading account"}</strong>
            <span>
              {user?.role
                ? user.role[0].toUpperCase() + user.role.slice(1)
                : "Secure account"}
            </span>
          </div>
        </button>
      </div>
    </header>
  );
}

type ActionAlert = {
  id: string;
  severity: "critical" | "warning" | "info";
  count: number;
  title: string;
  description: string;
  target: NavKey;
};

type ActionCenterResult = {
  alerts: ActionAlert[];
  totalActions: number;
  summary: { critical: number; warning: number; info: number };
  readiness: {
    connection: "LIVE" | "STALE" | "UNAVAILABLE";
    activePolicies: number | null;
    lmsIntegration: "CONTRACT_REQUIRED";
    whatsapp: "AUTOMATION_LIVE";
  };
};

function ActionCenter({
  result,
  onNavigate,
}: {
  result: ActionCenterResult;
  onNavigate: (value: NavKey) => void;
}) {
  const connectionTone =
    result.readiness.connection === "LIVE" ? "teal" : "red";
  return (
    <div className="content-stack">
      <SummaryStrip
        items={[
          { label: "Critical", value: result.summary.critical },
          { label: "Needs attention", value: result.summary.warning },
          { label: "Information", value: result.summary.info },
        ]}
      />
      <section className="panel readiness-panel">
        <div className="section-heading">
          <div>
            <h2>System readiness</h2>
            <p>Live controls and external integration gates</p>
          </div>
        </div>
        <div className="readiness-grid">
          <article>
            <span>CRM data</span>
            <Chip tone={connectionTone}>{result.readiness.connection}</Chip>
            <small>Google Sheets production connection</small>
          </article>
          <article>
            <span>Credit policy</span>
            <Chip
              tone={
                result.readiness.activePolicies === null
                  ? "blue"
                  : result.readiness.activePolicies > 0
                    ? "teal"
                    : "red"
              }
            >
              {result.readiness.activePolicies === null
                ? "MANAGED CENTRALLY"
                : `${result.readiness.activePolicies} ACTIVE`}
            </Chip>
            <small>SHADOW policies can calculate but cannot submit</small>
          </article>
          <article>
            <span>External LMS</span>
            <Chip tone="amber">CONTRACT REQUIRED</Chip>
            <small>Submit, retry and callback remain safely locked</small>
          </article>
          <article>
            <span>WhatsApp Cloud API</span>
            <Chip tone="teal">AUTOMATION LIVE</Chip>
            <small>S00 replies are live; CRM manual sending remains locked</small>
          </article>
        </div>
      </section>
      <section className="panel action-panel">
        <div className="table-toolbar">
          <div>
            <h2>Open actions</h2>
            <p>{result.totalActions} role-scoped items need attention</p>
          </div>
        </div>
        <div className="action-list">
          {result.alerts.length ? (
            result.alerts.map((alert) => (
              <button
                key={alert.id}
                className={`action-item action-${alert.severity}`}
                onClick={() => onNavigate(alert.target)}
              >
                <span className="action-count">{alert.count}</span>
                <span className="action-copy">
                  <strong>{alert.title}</strong>
                  <small>{alert.description}</small>
                </span>
                <span className="action-open">Open →</span>
              </button>
            ))
          ) : (
            <div className="action-empty">
              <strong>No open actions for this view</strong>
              <span>Change the branch or date filter to inspect another scope.</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function MetricCard({
  icon,
  title,
  value,
  tone,
}: {
  icon: string;
  title: string;
  value: string;
  tone: string;
}) {
  return (
    <article className="metric-card">
      <div className={`metric-icon ${tone}`}>{icon}</div>
      <div className="metric-copy">
        <span>{title}</span>
        <strong>{value}</strong>
        <small>
          <b>Live</b> from Google Sheets
        </small>
      </div>
      <div className={`sparkline ${tone}`}>
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
    </article>
  );
}

function stageShare(count: number, total: number) {
  return total > 0 ? `${((count / total) * 100).toFixed(1)}%` : "0.0%";
}

function Dashboard({
  filteredLeads,
  onLead,
  connected,
}: {
  filteredLeads: Lead[];
  onLead: (lead: Lead) => void;
  connected: boolean;
}) {
  const {
    new: newCount,
    contacted: contactedCount,
    qualified: qualifiedCount,
    documents: documentsCount,
    credit: creditCount,
    lms: lmsCount,
    approved: approvedCount,
  } = pipelineCounts(filteredLeads);
  const waitingDocuments = filteredLeads.filter((lead) => {
    const status = lead.documentStatus.trim().toLowerCase();
    return (
      status !== "" && !["complete", "completed", "verified"].includes(status)
    );
  }).length;
  const manualReview = filteredLeads.filter(
    (lead) =>
      lead.stage.trim().toLowerCase() === "manual review" ||
      lead.documentStatus.trim().toLowerCase().includes("review"),
  ).length;
  const activePipelineTotal =
    newCount +
    contactedCount +
    qualifiedCount +
    documentsCount +
    creditCount +
    lmsCount +
    approvedCount;
  return (
    <div className="content-stack">
      <div className="metrics-grid">
        <MetricCard
          icon="◎"
          title="New Leads"
          value={String(newCount)}
          tone="teal"
        />
        <MetricCard
          icon="◉"
          title="Qualified"
          value={String(qualifiedCount)}
          tone="teal"
        />
        <MetricCard
          icon="▤"
          title="Waiting Documents"
          value={String(waitingDocuments)}
          tone="amber"
        />
        <MetricCard
          icon="◇"
          title="Manual Review"
          value={String(manualReview)}
          tone="coral"
        />
      </div>
      <section className="panel pipeline-panel">
        <div className="section-heading">
          <div>
            <h2>Lead Pipeline</h2>
            <p>Current visible cases by lifecycle stage</p>
          </div>
          <Chip tone="gray">
            {connected ? "Google Sheets · live" : "No data connection"}
          </Chip>
        </div>
        <div className="pipeline">
          <div className="pipe pipe-1">
            <span>New</span>
            <strong>{newCount}</strong>
          </div>
          <div className="pipe pipe-2">
            <span>Contacted</span>
            <strong>{contactedCount}</strong>
          </div>
          <div className="pipe pipe-3">
            <span>Qualified</span>
            <strong>{qualifiedCount}</strong>
          </div>
          <div className="pipe pipe-4">
            <span>Documents</span>
            <strong>{documentsCount}</strong>
          </div>
          <div className="pipe pipe-5">
            <span>Credit</span>
            <strong>{creditCount}</strong>
          </div>
          <div className="pipe pipe-6">
            <span>LMS</span>
            <strong>{lmsCount}</strong>
          </div>
          <div className="pipe pipe-7">
            <span>Approved</span>
            <strong>{approvedCount}</strong>
          </div>
        </div>
        <div className="stage-share-row" aria-label="Share of active pipeline">
          <span>{stageShare(newCount, activePipelineTotal)}</span>
          <span>{stageShare(contactedCount, activePipelineTotal)}</span>
          <span>{stageShare(qualifiedCount, activePipelineTotal)}</span>
          <span>{stageShare(documentsCount, activePipelineTotal)}</span>
          <span>{stageShare(creditCount, activePipelineTotal)}</span>
          <span>{stageShare(lmsCount, activePipelineTotal)}</span>
          <span>{stageShare(approvedCount, activePipelineTotal)}</span>
        </div>
      </section>
      <LeadTable
        title="Recent Leads"
        leads={recentLeads(filteredLeads, 10)}
        onLead={onLead}
        connected={connected}
      />
    </div>
  );
}

function ApplicationsWorkspace({
  leads,
  data,
  onLead,
}: {
  leads: Lead[];
  data: Record<string, SheetRow[]>;
  onLead: (lead: Lead) => void;
}) {
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState("ALL");
  const [dataScope, setDataScope] = useState<"PRODUCTION" | "ALL">(
    "PRODUCTION",
  );
  const scopedLeads = useMemo(
    () =>
      dataScope === "ALL"
        ? leads
        : leads.filter((lead) => !isSyntheticLead(lead.raw)),
    [dataScope, leads],
  );
  const applications = useMemo(
    () => buildApplicationRegister(scopedLeads, data),
    [scopedLeads, data],
  );
  const phases = [...new Set(applications.map((item) => item.phase))];
  const shown = applications.filter((item) => {
    const search = `${item.lead.id} ${item.lead.name} ${item.lead.phone} ${item.lead.owner} ${item.phase} ${item.blocker}`.toLowerCase();
    return (
      (phase === "ALL" || item.phase === phase) &&
      search.includes(query.trim().toLowerCase())
    );
  });
  const qualificationComplete = applications.filter(
    (item) => item.qualification.completed === item.qualification.total,
  ).length;
  const documentsComplete = applications.filter(
    (item) => item.documents.completed === item.documents.total,
  ).length;
  const lmsReady = applications.filter((item) =>
    ["READY FOR LMS", "LMS QUEUE", "COMPLETED"].includes(item.phase),
  ).length;
  return (
    <div className="content-stack">
      <SummaryStrip
        items={[
          {
            label:
              dataScope === "ALL"
                ? "Visible applications"
                : "Production applications",
            value: applications.length,
          },
          { label: "Credit data complete", value: qualificationComplete },
          { label: "Required documents complete", value: documentsComplete },
          { label: "LMS ready / queued", value: lmsReady },
        ]}
      />
      <section className="panel table-panel application-register">
        <div className="table-toolbar application-toolbar">
          <div>
            <h2>Application Register</h2>
            <p>
              Every case with its present gate, owner and exact missing work
            </p>
          </div>
          <div className="register-filters">
            <select
              aria-label="Application data scope"
              value={dataScope}
              onChange={(event) =>
                setDataScope(event.target.value as "PRODUCTION" | "ALL")
              }
            >
              <option value="PRODUCTION">Production only</option>
              <option value="ALL">Include test / UAT</option>
            </select>
            <select
              aria-label="Application phase"
              value={phase}
              onChange={(event) => setPhase(event.target.value)}
            >
              <option value="ALL">All phases</option>
              {phases.map((value) => (
                <option value={value} key={value}>
                  {value}
                </option>
              ))}
            </select>
            <label className="search-box">
              <span>⌕</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search applications…"
              />
            </label>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Applicant</th>
                <th>Route / owner</th>
                <th>Credit inputs</th>
                <th>Documents</th>
                <th>Current gate</th>
                <th>What is blocking progress</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.length ? (
                shown.map((item) => (
                  <tr key={item.lead.id} onClick={() => onLead(item.lead)}>
                    <td>
                      <strong>{item.lead.name}</strong>
                      <span>
                        {item.lead.id} · {item.lead.branch}
                      </span>
                    </td>
                    <td>
                      <strong>{item.lead.processingRoute}</strong>
                      <span>{item.lead.owner}</span>
                    </td>
                    <td>
                      <strong>
                        {item.qualification.completed}/
                        {item.qualification.total}
                      </strong>
                      <span>
                        {item.qualification.missing.length
                          ? "Incomplete"
                          : "Complete"}
                      </span>
                    </td>
                    <td>
                      <strong>
                        {item.documents.completed}/{item.documents.total}
                      </strong>
                      <span>required received</span>
                    </td>
                    <td>
                      <Chip
                        tone={
                          item.tone as
                            | "teal"
                            | "blue"
                            | "amber"
                            | "red"
                            | "gray"
                        }
                      >
                        {item.phase}
                      </Chip>
                    </td>
                    <td className="blocker-cell">{item.blocker}</td>
                    <td>
                      <button
                        className="row-action"
                        aria-label={`Open application ${item.lead.id}`}
                      >
                        →
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>
                    <strong>No matching applications</strong>
                    <span>Change the phase or search filter.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function LeadTable({
  title,
  leads: tableLeads,
  onLead,
  connected,
}: {
  title: string;
  leads: Lead[];
  onLead: (lead: Lead) => void;
  connected: boolean;
}) {
  const [query, setQuery] = useState("");
  const shown = tableLeads.filter((lead) =>
    `${lead.name} ${lead.id} ${lead.phone}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <section className="panel table-panel">
      <div className="table-toolbar">
        <div>
          <h2>{title}</h2>
          <p>
            {shown.length} Google Sheet{" "}
            {shown.length === 1 ? "record" : "records"} shown
          </p>
        </div>
        <label className="search-box">
          <span>⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search leads..."
          />
        </label>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Lead</th>
              <th>Branch</th>
              <th>Stage</th>
              <th>Score</th>
              <th>Updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <strong>No records</strong>
                  <span>
                    The Leads sheet is currently empty or unavailable.
                  </span>
                </td>
              </tr>
            ) : (
              shown.map((lead) => (
                <tr key={lead.id} onClick={() => onLead(lead)}>
                  <td>
                    <strong>{lead.name}</strong>
                    <span>{lead.id}</span>
                  </td>
                  <td>{lead.branch}</td>
                  <td>
                    <StageChip stage={lead.stage} />
                  </td>
                  <td>
                    <b className="score">{lead.score}</b>
                  </td>
                  <td>{lead.updated}</td>
                  <td>
                    <button
                      className="row-action"
                      aria-label={`View ${lead.name}`}
                    >
                      →
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function pick(row: SheetRow | undefined | null, keys: string[]) {
  if (!row) return "—";
  for (const key of keys) if (row[key]) return row[key];
  return "—";
}

type Column = { label: string; keys: string[] };

const moduleConfig: Partial<
  Record<NavKey, { tab: string; title: string; columns: Column[] }>
> = {
  Qualification: {
    tab: "Conversation_State",
    title: "Qualification Status",
    columns: [
      { label: "Lead", keys: ["Lead Name", "Lead ID"] },
      { label: "Phone", keys: ["Phone Number"] },
      { label: "Current Step", keys: ["Current Step"] },
      { label: "Qualification", keys: ["Qualification Status"] },
      { label: "Last Customer Reply", keys: ["Last Customer Reply"] },
      { label: "Next Action", keys: ["Next Action"] },
      { label: "Last Updated", keys: ["Last Updated"] },
    ],
  },
  Documents: {
    tab: "Document_Received_Log",
    title: "Received Documents",
    columns: [
      { label: "Lead ID", keys: ["Lead ID"] },
      { label: "Phone", keys: ["Phone Number"] },
      { label: "Document", keys: ["Document Type"] },
      { label: "Received", keys: ["Received Date", "Created Date"] },
      { label: "Status", keys: ["Status"] },
    ],
  },
  Verification: {
    tab: "Document_Verification_Log",
    title: "Document Verification",
    columns: [
      { label: "Lead ID", keys: ["Lead ID"] },
      { label: "Overall Status", keys: ["Overall Verification Status"] },
      {
        label: "Missing / Unreadable",
        keys: ["Missing or Unreadable Documents"],
      },
      { label: "Confidence", keys: ["AI Confidence"] },
      { label: "Next Action", keys: ["Next Action"] },
      { label: "Manual Review", keys: ["Manual Review Required"] },
    ],
  },
  "Credit Assessment": {
    tab: "Credit_Assessment",
    title: "Pre-LMS Credit Assessment",
    columns: [
      { label: "Lead", keys: ["Lead ID"] },
      { label: "Pre-Screen Score", keys: ["Pre-Screen Score"] },
      { label: "Preliminary DSR", keys: ["Preliminary DSR"] },
      { label: "NDI", keys: ["Net Disposable Income"] },
      { label: "Risk Grade", keys: ["Preliminary Risk Grade"] },
      { label: "Hard Rules", keys: ["Hard Rule Status"] },
      { label: "LMS Eligible", keys: ["LMS Submission Eligibility"] },
      { label: "Policy", keys: ["Policy Version"] },
      { label: "Assessment Status", keys: ["Assessment Status"] },
    ],
  },
  "Follow-up": {
    tab: "Follow_Up_Queue",
    title: "Follow-up Actions",
    columns: [
      { label: "Lead", keys: ["Lead Name", "Lead ID"] },
      { label: "Phone", keys: ["Phone Number"] },
      { label: "Type", keys: ["Follow Up Type", "Reason"] },
      { label: "Reminder", keys: ["Reminder Stage", "Last AI Message Type"] },
      { label: "Last Reminder", keys: ["Last Reminder At", "Last AI Message At"] },
      { label: "Next Action", keys: ["Next Action", "Required Action"] },
      { label: "Due", keys: ["Due At", "Scheduled At", "Follow Up Date"] },
      { label: "Status", keys: ["Status", "Qualification Status"] },
      { label: "AI Control", keys: ["AI Status"] },
      { label: "Assigned", keys: ["Assigned To", "Staff ID"] },
    ],
  },
  Conversations: {
    tab: "Customer_Reply_Log",
    title: "Combined Conversation History",
    columns: [
      { label: "Lead ID", keys: ["Lead ID"] },
      { label: "Customer", keys: ["Lead Name"] },
      { label: "Phone", keys: ["Phone Number"] },
      { label: "Direction", keys: ["Direction"] },
      { label: "Message", keys: ["Message"] },
      { label: "Source", keys: ["Source"] },
      { label: "Timestamp", keys: ["Timestamp"] },
      { label: "Status", keys: ["Status"] },
    ],
  },
  Escalations: {
    tab: "Escalation_Log",
    title: "Escalations",
    columns: [
      { label: "Lead", keys: ["Lead Name", "Lead ID"] },
      { label: "Type", keys: ["Escalation Type"] },
      { label: "Reason", keys: ["Escalation Reason"] },
      { label: "Priority", keys: ["Priority"] },
      { label: "Status", keys: ["Status"] },
      { label: "Required Action", keys: ["Required Action"] },
      { label: "Assigned To", keys: ["Assigned To"] },
      { label: "Created", keys: ["Created Date"] },
    ],
  },
  "LMS Status": {
    tab: "LMS_Submission_Queue",
    title: "Internal LMS Submission Queue",
    columns: [
      { label: "Lead", keys: ["Lead ID"] },
      { label: "Assessment", keys: ["Assessment ID"] },
      { label: "Policy", keys: ["Policy Version"] },
      { label: "Route", keys: ["Processing Route"] },
      { label: "Queue Status", keys: ["Queue Status"] },
      { label: "Requested By", keys: ["Requested By"] },
      { label: "Requested At", keys: ["Requested At"] },
      { label: "LMS Submission", keys: ["LMS Submission ID"] },
    ],
  },
  "Audit Log": {
    tab: "Audit_Log",
    title: "CRM Audit Trail",
    columns: [
      { label: "Timestamp", keys: ["Timestamp", "Created At"] },
      { label: "Action", keys: ["Action"] },
      { label: "Actor / Module", keys: ["Module", "Actor", "User"] },
      { label: "Lead", keys: ["Lead ID"] },
      { label: "Result", keys: ["Result", "Status"] },
      { label: "Scenario", keys: ["Scenario"] },
      { label: "Details", keys: ["Error Message", "Raw Data"] },
    ],
  },
};

function RecordTable({
  title,
  rows,
  columns,
  onOpenLead,
}: {
  title: string;
  rows: SheetRow[];
  columns: Column[];
  onOpenLead?: (leadId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const shown = rows.filter((row) =>
    Object.values(row).join(" ").toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="panel table-panel">
      <div className="table-toolbar">
        <div>
          <h2>{title}</h2>
          <p>
            {shown.length} Google Sheet{" "}
            {shown.length === 1 ? "record" : "records"} shown
          </p>
        </div>
        <label className="search-box">
          <span>⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search records..."
          />
        </label>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.label}>{column.label}</th>
              ))}
              {onOpenLead && <th>Open</th>}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (onOpenLead ? 1 : 0)}>
                  <strong>No records</strong>
                  <span>This Google Sheet log is currently empty.</span>
                </td>
              </tr>
            ) : (
              shown.map((row, index) => {
                const leadId = pick(row, ["Lead ID"]);
                return (
                  <tr
                    className={
                      onOpenLead && leadId !== "—" ? "clickable-row" : ""
                    }
                    key={`${pick(row, ["Lead ID", "Verification ID", "Scoring ID", "Received ID", "Escalation ID"])}-${index}`}
                    onClick={() => {
                      if (onOpenLead && leadId !== "—") onOpenLead(leadId);
                    }}
                  >
                    {columns.map((column, columnIndex) => (
                      <td key={column.label}>
                        {columnIndex === 0 ? (
                          <strong>{pick(row, column.keys)}</strong>
                        ) : (
                          pick(row, column.keys)
                        )}
                      </td>
                    ))}
                    {onOpenLead && (
                      <td>
                        {leadId !== "—" && (
                          <button
                            className="row-action"
                            aria-label={`Open customer ${leadId}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpenLead(leadId);
                            }}
                          >
                            →
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function normalized(value: string | undefined) {
  return (value || "").trim().toLowerCase().replace(/[_-]+/g, " ");
}

function uniqueLeadCount(rows: SheetRow[]) {
  return new Set(rows.map((row) => row["Lead ID"]).filter(Boolean)).size;
}

function SummaryStrip({
  items,
}: {
  items: Array<{ label: string; value: string | number }>;
}) {
  return (
    <div className="summary-strip">
      {items.map((item) => (
        <article key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </article>
      ))}
    </div>
  );
}

function displayTime(value: string) {
  if (!value) return "No activity";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function customerReference(lead: Pick<Lead, "phone" | "id">) {
  const phone = String(lead.phone || "").trim();
  const id = String(lead.id || "").trim();
  if (!phone) return id || "—";
  if (!id || phone === id) return phone;
  return `${phone} · ${id}`;
}

function safeSharePointUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname.toLowerCase() === "rexmgt.sharepoint.com"
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

function maskedIdentity(value: string) {
  const clean = String(value || "").replace(/[^A-Z0-9]/gi, "");
  if (!clean) return "—";
  return clean.length <= 4 ? clean : `••••••${clean.slice(-4)}`;
}

function statusTone(value: string): "teal" | "blue" | "amber" | "red" | "gray" {
  const status = normalized(value);
  if (["verified", "complete", "completed", "received"].includes(status))
    return "teal";
  if (
    status.includes("review") ||
    status.includes("reupload") ||
    status.includes("failed")
  )
    return "red";
  if (
    status.includes("progress") ||
    status.includes("pending") ||
    status.includes("waiting")
  )
    return "amber";
  return "gray";
}

type CustomerTimelineEvent = {
  id: string;
  type: string;
  documentType?: string;
  fileName?: string;
  fileUrl?: string;
  text?: string;
  status?: string;
  verificationStatus?: string;
  at?: string;
};
const knownDocumentTypes = new Set(
  DOCUMENT_DEFINITIONS.map((item) => item.type),
);

function OtherDocuments({ timeline }: { timeline: CustomerTimelineEvent[] }) {
  const otherDocuments = timeline.filter(
    (event) =>
      event.type === "document" &&
      !knownDocumentTypes.has(event.documentType || ""),
  );
  if (!otherDocuments.length) return null;
  return (
    <div className="other-documents">
      <p>Other / unclassified documents</p>
      {otherDocuments.map((event) => {
        const url = safeSharePointUrl(event.fileUrl || "");
        return (
          <div className="other-document-row" key={event.id}>
            <span className="document-symbol">?</span>
            <span>
              <strong>{event.documentType || "UNKNOWN"}</strong>
              <small>
                {event.fileName || event.text || "Unclassified customer file"}
              </small>
            </span>
            <span className="checklist-action">
              <Chip
                tone={statusTone(
                  event.verificationStatus || event.status || "PENDING",
                )}
              >
                {event.verificationStatus || event.status || "PENDING"}
              </Chip>
              {url && (
                <a href={url} target="_blank" rel="noreferrer">
                  View
                </a>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function conversationSources(data: Record<string, SheetRow[]>) {
  return {
    customerInbox: data.Customer_Inbox || [],
    replyLog: data.Customer_Reply_Log || [],
    messageOutbox: data.Message_Outbox || [],
    documents: data.Document_Received_Log || [],
    activities: data.Lead_Activities || [],
    followUps: mergedFollowUpRows(
      data.Follow_Up_Queue || [],
      data.Conversation_State || [],
    ),
    creditDecisions: data.Credit_Decision_Log || [],
    verifications: data.Document_Verification_Log || [],
    assessments: data.Credit_Assessment || [],
    lmsQueue: data.LMS_Submission_Queue || [],
    lmsResults: data.LMS_Credit_Result || [],
  };
}

function CustomerActions({
  lead,
  user,
  onChanged,
  onEdit,
  readyForLms,
  verificationReady,
  queueRecord,
  consentRecord,
}: {
  lead: Lead;
  user?: CrmUser;
  onChanged: () => void;
  onEdit: (lead: Lead) => void;
  readyForLms: boolean;
  verificationReady: boolean;
  queueRecord?: SheetRow;
  consentRecord?: {
    fileName?: string;
    fileUrl?: string;
    status?: string;
    verificationStatus?: string;
  } | null;
}) {
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [consentFile, setConsentFile] = useState<File | null>(null);
  const [consentBusy, setConsentBusy] = useState(false);
  const canReview = canReviewSaCase(user, lead.processingRoute);
  const canEditDraft = canContinueManualApplication(user, lead.raw);
  const canAddNote = Boolean(user && user.role !== "readonly");
  const canManageConsent = ["admin", "regional_manager"].includes(
    user?.role || "",
  );
  const canUploadConsent = Boolean(user && user.role !== "readonly");
  const canQueue =
    readyForLms &&
    ["admin", "regional_manager"].includes(user?.role || "") &&
    !queueRecord;
  async function action(operation: "approve" | "return" | "reassign") {
    const reason =
      operation === "return"
        ? window.prompt("Reason and missing documents:") || ""
        : "";
    const salesId =
      operation === "reassign" ? window.prompt("New Sales ID:") || "" : "";
    if (
      (operation === "return" && !reason) ||
      (operation === "reassign" && !salesId)
    )
      return;
    const response = await fetch("/api/applications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation,
        leadId: lead.id,
        reason,
        "Assigned Sales ID": salesId,
      }),
    });
    const result = (await response.json()) as {
      error?: string;
      status?: string;
    };
    setMessage(
      response.ok
        ? `Completed: ${result.status}`
        : result.error || "Action failed.",
    );
    if (response.ok) onChanged();
  }
  async function queueForLms() {
    const response = await fetch("/api/lms-queue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leadId: lead.id }),
    });
    const result = (await response.json()) as {
      error?: string;
      status?: string;
      reasons?: string[];
    };
    setMessage(
      response.ok
        ? "Added once to the internal LMS queue. External submission remains locked until the official LMS connection is configured."
        : `${result.error || "LMS queue failed."}${result.reasons?.length ? ` ${result.reasons.join(", ")}` : ""}`,
    );
    if (response.ok) onChanged();
  }
  async function addNote() {
    const cleanNote = note.trim();
    if (!cleanNote) return;
    setNoteBusy(true);
    const response = await fetch("/api/applications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "note",
        leadId: lead.id,
        note: cleanNote,
      }),
    });
    const result = (await response.json()) as {
      error?: string;
      status?: string;
    };
    if (response.ok) {
      setNote("");
      setMessage("Case note saved to the activity history.");
      onChanged();
    } else setMessage(result.error || "Unable to save case note.");
    setNoteBusy(false);
  }
  async function uploadConsent() {
    if (!consentFile) return;
    setConsentBusy(true);
    setMessage("Uploading signed CTOS / CCRIS consent letter…");
    const form = new FormData();
    form.set("leadId", lead.id);
    form.set("documentType", "CTOS_CCRIS_CONSENT");
    form.set("file", consentFile);
    const response = await fetch("/api/documents", {
      method: "POST",
      body: form,
    });
    const result = (await response.json()) as { error?: string };
    setMessage(
      response.ok
        ? "Signed consent uploaded to SharePoint. Admin or Regional Manager verification is now required."
        : result.error || "Consent upload failed.",
    );
    if (response.ok) {
      setConsentFile(null);
      onChanged();
    }
    setConsentBusy(false);
  }
  async function decideConsent(action: "verify" | "reject" | "revoke") {
    const reason =
      action === "verify"
        ? ""
        : window.prompt(
            action === "revoke"
              ? "Reason supplied for consent withdrawal:"
              : "Reason the consent requires re-upload:",
          ) || "";
    if (action !== "verify" && !reason) return;
    setConsentBusy(true);
    const response = await fetch("/api/credit-bureau-consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leadId: lead.id, action, reason }),
    });
    const result = (await response.json()) as {
      error?: string;
      status?: string;
    };
    setMessage(
      response.ok
        ? `Credit-bureau consent: ${result.status}`
        : result.error || "Consent action failed.",
    );
    if (response.ok) onChanged();
    setConsentBusy(false);
  }
  if (!canEditDraft && !canReview && !canQueue && !queueRecord && !canAddNote)
    return null;
  return (
    <section className="customer-actions">
      <div className="context-heading">
        <div>
          <p className="eyebrow">ACTIONS</p>
          <h3>Work on this customer</h3>
        </div>
      </div>
      <div className="consent-control">
        <div>
          <strong>CTOS / CCRIS Consent Letter</strong>
          <small>
            Consent_BPH_V.40_01112020 · required and verified before LMS Queue
          </small>
        </div>
        <div className="consent-control-status">
          <Chip
            tone={statusTone(
              consentRecord?.verificationStatus ||
                consentRecord?.status ||
                "NOT RECEIVED",
            )}
          >
            {consentRecord?.verificationStatus ||
              consentRecord?.status ||
              "NOT RECEIVED"}
          </Chip>
          {safeSharePointUrl(consentRecord?.fileUrl || "") && (
            <a
              href={safeSharePointUrl(consentRecord?.fileUrl || "")}
              target="_blank"
              rel="noreferrer"
            >
              View signed form
            </a>
          )}
        </div>
        {canUploadConsent &&
          consentRecord?.verificationStatus !== "VERIFIED" && (
            <div className="consent-upload-action">
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                onChange={(event) =>
                  setConsentFile(event.target.files?.[0] || null)
                }
              />
              <button
                type="button"
                disabled={consentBusy || !consentFile}
                onClick={uploadConsent}
              >
                {consentBusy ? "Working…" : "Upload signed consent"}
              </button>
            </div>
          )}
        {canManageConsent && consentRecord && (
          <div className="manager-actions">
            {consentRecord.verificationStatus !== "VERIFIED" && (
              <button
                type="button"
                disabled={consentBusy}
                onClick={() => decideConsent("verify")}
              >
                Verify Consent
              </button>
            )}
            {consentRecord.verificationStatus !== "VERIFIED" && (
              <button
                type="button"
                disabled={consentBusy}
                onClick={() => decideConsent("reject")}
              >
                Require Re-upload
              </button>
            )}
            {consentRecord.verificationStatus === "VERIFIED" && (
              <button
                type="button"
                disabled={consentBusy}
                onClick={() => decideConsent("revoke")}
              >
                Record Withdrawal
              </button>
            )}
          </div>
        )}
      </div>
      {canEditDraft && (
        <div className="manager-actions">
          <button onClick={() => onEdit(lead)}>
            Continue Application + Files
          </button>
        </div>
      )}
      {canReview && (
        <div className="manager-actions">
          {verificationReady && (
            <button onClick={() => action("approve")}>
              Approve Verification
            </button>
          )}
          <button onClick={() => action("return")}>Return for Documents</button>
          <button onClick={() => action("reassign")}>Reassign Staff</button>
        </div>
      )}
      {canReview && !verificationReady && (
        <p className="form-message error">
          Approval is locked until all required documents and AI verification
          checks have passed.
        </p>
      )}
      {canQueue && (
        <div className="manager-actions lms-queue-action">
          <button onClick={queueForLms}>Add to Internal LMS Queue</button>
        </div>
      )}
      {queueRecord && (
        <div className="queue-state">
          <Chip tone={statusTone(queueRecord["Queue Status"])}>
            {queueRecord["Queue Status"] || "QUEUED"}
          </Chip>
          <span>
            Unique internal queue record: {queueRecord["Queue ID"] || "—"}
          </span>
        </div>
      )}
      {canAddNote && (
        <div className="case-note-editor">
          <label htmlFor={`case-note-${lead.id}`}>Internal case note</label>
          <textarea
            id={`case-note-${lead.id}`}
            value={note}
            maxLength={2000}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Record a call, document issue, customer instruction or handover note…"
          />
          <div>
            <small>{note.length}/2,000</small>
            <button
              type="button"
              disabled={noteBusy || !note.trim()}
              onClick={addNote}
            >
              {noteBusy ? "Saving…" : "Save Case Note"}
            </button>
          </div>
        </div>
      )}
      {message && (
        <p
          className={
            message.toLowerCase().includes("failed") ||
            message.toLowerCase().includes("locked")
              ? "form-message error"
              : "form-message"
          }
        >
          {message}
        </p>
      )}
    </section>
  );
}

function Customer360Workspace({
  leads,
  data,
  stateData,
  initialLeadId,
  onSelect,
  user,
  onChanged,
  onEdit,
}: {
  leads: Lead[];
  data: Record<string, SheetRow[]>;
  stateData?: Record<string, SheetRow[]>;
  initialLeadId?: string;
  onSelect: (lead: Lead) => void;
  user?: CrmUser;
  onChanged: () => void;
  onEdit: (lead: Lead) => void;
}) {
  const summaries = useMemo(
    () => buildConversationSummaries(leads, conversationSources(data)),
    [leads, data],
  );
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("All stages");
  const [selectedId, setSelectedId] = useState(initialLeadId || "");
  const customerStages = Array.from(
    new Set(summaries.map((summary) => summary.lead.stage).filter(Boolean)),
  ).sort();
  const shown = summaries.filter((summary) => {
    const searchable = `${summary.lead.name} ${summary.lead.id} ${summary.lead.phone} ${summary.preview} ${Object.values(summary.lead.raw || {}).join(" ")}`;
    const matchesQuery = searchable.toLowerCase().includes(query.toLowerCase());
    const matchesStage =
      stageFilter === "All stages" || summary.lead.stage === stageFilter;
    return matchesQuery && matchesStage;
  });
  const selected =
    shown.find((summary) => summary.lead.id === selectedId) || shown[0] || null;
  const state = selected
    ? (data.Conversation_State || []).find(
        (row) => row["Lead ID"] === selected.lead.id,
      )
    : undefined;
  const qualification = selected
    ? qualificationSnapshot(selected.lead, state || {})
    : { completed: 0, total: 0, missing: [], fields: [] };
  const qualificationRecord = selected
    ? { ...selected.lead.raw, ...(state || {}) }
    : {};
  const verificationRows = selected
    ? (data.Document_Verification_Log || []).filter(
        (row) => row["Lead ID"] === selected.lead.id,
      )
    : [];
  const verification = verificationRows[verificationRows.length - 1];
  const verificationReady = Boolean(
    selected &&
      selected.requiredReceived === selected.requiredTotal &&
      ["verified", "passed"].includes(
        normalized(
          verification?.["Overall Verification Status"] ||
            verification?.["Verification Status"] ||
            selected.lead.documentStatus,
        ),
      ) &&
      !["yes", "true", "required", "manual_review"].includes(
        normalized(verification?.["Manual Review Required"]),
      ),
  );
  const assessmentRows = selected
    ? (data.Credit_Assessment || []).filter(
        (row) => row["Lead ID"] === selected.lead.id,
      )
    : [];
  const assessment = assessmentRows[assessmentRows.length - 1];
  const lmsResultRows = selected
    ? (stateData?.LMS_Credit_Result || data.LMS_Credit_Result || []).filter(
        (row) => row["Lead ID"] === selected.lead.id,
      )
    : [];
  const lmsResult = selected
    ? latestLmsResult(lmsResultRows, selected.lead.id)
    : undefined;
  const postApproval = selected
    ? (derivePostApprovalCase(
        selected.lead,
        lmsResult,
        stateData?.Lead_Activities || data.Lead_Activities || [],
      ) as unknown as PostApprovalCase)
    : null;
  const lmsQueueRows = selected
    ? (data.LMS_Submission_Queue || []).filter(
        (row) => row["Lead ID"] === selected.lead.id,
      )
    : [];
  const lmsQueue = lmsQueueRows[lmsQueueRows.length - 1];
  const queueEligibility = selected
      ? evaluateLmsQueueEligibility({
        leadId: selected.lead.id,
        assessmentRows: data.Credit_Assessment || [],
        policyRows: data.Product_Credit_Policy || [],
        existingQueueRows: [],
        documentRows: data.Document_Received_Log || [],
        policyEngineEnabled: readCreditPolicyEngineConfig(
          data.System_Config || [],
        ).enabled,
      })
    : null;
  const automation = selected
    ? assessAutomationDecision({
        lead: selected.lead,
        checklist: selected.checklist,
        state,
        verification,
        assessment,
        queueEligibility,
      } as any)
    : null;
  const totalCustomerMessages = summaries.reduce(
    (total, item) => total + item.customerMessageCount,
    0,
  );
  const totalDocuments = summaries.reduce(
    (total, item) => total + item.documentCount,
    0,
  );

  return (
    <div className="content-stack customer-360-stack">
      <SummaryStrip
        items={[
          { label: "Customer threads", value: summaries.length },
          { label: "Customer messages", value: totalCustomerMessages },
          { label: "Received documents", value: totalDocuments },
        ]}
      />
      <section className="panel customer-360">
        <aside className="thread-list">
          <div className="thread-list-heading">
            <div>
              <h2>Customer Records</h2>
              <p>One customer · one complete file</p>
            </div>
            <Chip tone="teal">{summaries.length} TOTAL</Chip>
          </div>
          <label className="thread-search">
            <span>⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, phone, IC or Lead ID"
            />
          </label>
          <label className="thread-stage-filter">
            <span>Stage</span>
            <select
              value={stageFilter}
              onChange={(event) => setStageFilter(event.target.value)}
            >
              <option>All stages</option>
              {customerStages.map((stage) => (
                <option key={stage}>{stage}</option>
              ))}
            </select>
          </label>
          <div className="thread-scroll">
            {shown.length ? (
              shown.map((summary) => (
                <button
                  key={summary.lead.id}
                  className={`thread-item ${selected?.lead.id === summary.lead.id ? "active" : ""}`}
                  onClick={() => {
                    setSelectedId(summary.lead.id);
                    onSelect(summary.lead);
                  }}
                >
                  <span className="thread-avatar">
                    {summary.lead.name
                      .split(/\s+/)
                      .map((part: string) => part[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase()}
                  </span>
                  <span className="thread-copy">
                    <span className="thread-title">
                      <strong>{summary.lead.name}</strong>
                      <time>{displayTime(summary.lastAt)}</time>
                    </span>
                    <small>{customerReference(summary.lead)}</small>
                    <em>{summary.preview}</em>
                    <span className="thread-meta">
                      <b>
                        {summary.requiredReceived}/{summary.requiredTotal}{" "}
                        required docs
                      </b>
                      <i>
                        {summary.lead.processingRoute === "AI_DIRECT"
                          ? "AI Direct"
                          : summary.lead.owner}
                      </i>
                    </span>
                  </span>
                </button>
              ))
            ) : (
              <div className="empty-thread">
                <strong>No matching customer</strong>
                <span>Try a different search.</span>
              </div>
            )}
          </div>
        </aside>
        {selected ? (
          <>
            <div className="conversation-panel">
              <header className="conversation-header">
                <div>
                  <h2>{selected.lead.name}</h2>
                  <p>{customerReference(selected.lead)}</p>
                </div>
                <div className="conversation-header-actions">
                  <Chip
                    tone={
                      selected.lead.processingRoute === "AI_DIRECT"
                        ? "teal"
                        : "blue"
                    }
                  >
                    {selected.lead.processingRoute}
                  </Chip>
                </div>
              </header>
              <div
                className="timeline"
                aria-label={`Conversation with ${selected.lead.name}`}
              >
                {selected.timeline.length ? (
                  selected.timeline.map((event) =>
                    event.type === "document" ? (
                      <article key={event.id} className="timeline-document">
                        <div className="document-symbol">▤</div>
                        <div className="timeline-document-copy">
                          <span>Customer document received</span>
                          <strong>{event.documentType || "DOCUMENT"}</strong>
                          <small>{event.fileName || event.text}</small>
                          <div>
                            <Chip
                              tone={statusTone(
                                event.verificationStatus || event.status,
                              )}
                            >
                              {event.verificationStatus ||
                                event.status ||
                                "RECEIVED"}
                            </Chip>
                            <time>{displayTime(event.at)}</time>
                          </div>
                        </div>
                        {safeSharePointUrl(event.fileUrl) ? (
                          <a
                            href={safeSharePointUrl(event.fileUrl)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open securely ↗
                          </a>
                        ) : (
                          <span className="document-link-unavailable">
                            Stored in SharePoint
                          </span>
                        )}
                      </article>
                    ) : event.type === "activity" ? (
                      <article key={event.id} className="timeline-activity">
                        <div className="activity-symbol">✓</div>
                        <div>
                          <span>{event.category?.replace(/_/g, " ")}</span>
                          <strong>{event.text}</strong>
                          <small>
                            {[event.actor, event.source]
                              .filter(Boolean)
                              .join(" · ")}
                          </small>
                        </div>
                        <time>{displayTime(event.at)}</time>
                      </article>
                    ) : (
                      <article
                        key={event.id}
                        className={`message-row ${event.direction === "ai" ? "outbound" : "inbound"}`}
                      >
                        <div className="message-bubble">
                          <span>
                            {event.direction === "ai"
                              ? "LoanBuddy AI / Staff"
                              : selected.lead.name}
                          </span>
                          <p>{event.text}</p>
                          <footer>
                            <small>{event.source}</small>
                            <time>{displayTime(event.at)}</time>
                          </footer>
                        </div>
                      </article>
                    ),
                  )
                ) : (
                  <div className="empty-timeline">
                    <strong>No recorded messages yet</strong>
                    <span>
                      New inbound and outbound activity will appear here
                      automatically.
                    </span>
                  </div>
                )}
              </div>
              <footer className="composer-locked">
                <div>
                  <strong>WhatsApp automation live</strong>
                  <span>
                    Conversation history is live and read-only. S00 automated
                    replies are active; CRM manual sending remains intentionally
                    locked.
                  </span>
                </div>
                <button disabled>Send message</button>
              </footer>
            </div>
            <aside className="customer-context">
              <section>
                <div className="context-heading">
                  <div>
                    <p className="eyebrow">CUSTOMER 360</p>
                    <h3>Case overview</h3>
                  </div>
                  <Chip tone={statusTone(selected.lead.stage)}>
                    {selected.lead.stage}
                  </Chip>
                </div>
                <dl className="context-grid">
                  <div>
                    <dt>Route</dt>
                    <dd>{selected.lead.processingRoute}</dd>
                  </div>
                  <div>
                    <dt>Visibility</dt>
                    <dd>{selected.lead.caseVisibility}</dd>
                  </div>
                  <div>
                    <dt>Branch</dt>
                    <dd>{selected.lead.branch}</dd>
                  </div>
                  <div>
                    <dt>Owner</dt>
                    <dd>{selected.lead.owner}</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>{pick(selected.lead.raw, ["Source"])}</dd>
                  </div>
                  <div>
                    <dt>Created</dt>
                    <dd>{pick(selected.lead.raw, ["Created Date"])}</dd>
                  </div>
                  <div>
                    <dt>Phone</dt>
                    <dd>{selected.lead.phone}</dd>
                  </div>
                  <div>
                    <dt>IC</dt>
                    <dd>
                      {maskedIdentity(
                        pick(qualificationRecord, ["IC Number"]),
                      )}
                    </dd>
                  </div>
                </dl>
              </section>
              {automation && (
                <section className="automation-decision">
                  <div className="context-heading">
                    <div>
                      <p className="eyebrow">AUTOMATION NEXT STEP</p>
                      <h3>{automation.label}</h3>
                    </div>
                    <Chip
                      tone={
                        automation.tone as
                          | "teal"
                          | "blue"
                          | "amber"
                          | "red"
                          | "gray"
                      }
                    >
                      {automation.readyForLms ? "READY" : "ACTIVE"}
                    </Chip>
                  </div>
                  <p>{automation.reason}</p>
                  <code>{automation.code}</code>
                </section>
              )}
              <section>
                <div className="context-heading">
                  <div>
                    <p className="eyebrow">DOCUMENTS</p>
                    <h3>
                      {selected.requiredReceived}/{selected.requiredTotal}{" "}
                      required received
                    </h3>
                  </div>
                </div>
                <ConsentTemplateActions compact />
                <div className="checklist">
                  {selected.checklist.map((item) => {
                    const record = item.record;
                    const url = safeSharePointUrl(record?.fileUrl || "");
                    const status = record
                      ? record.verificationStatus || record.status
                      : item.required
                        ? "MISSING"
                        : item.lmsRequired
                          ? "LMS REQUIRED"
                          : item.referenceOnly
                            ? "REFERENCE ONLY"
                            : "OPTIONAL";
                    return (
                      <div className="checklist-row" key={item.type}>
                        <span
                          className={`check-icon ${record ? "complete" : ""}`}
                        >
                          {record ? "✓" : "·"}
                        </span>
                        <span>
                          <strong>{item.label}</strong>
                          <small>
                            {record?.fileName ||
                              (item.required
                                ? "Required"
                                : item.lmsRequired
                                  ? "Required before LMS"
                                  : item.referenceOnly
                                    ? "Optional customer reference only"
                                    : "Optional")}
                          </small>
                        </span>
                        <span className="checklist-action">
                          <Chip tone={statusTone(status)}>{status}</Chip>
                          {url && (
                            <a href={url} target="_blank" rel="noreferrer">
                              View
                            </a>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <OtherDocuments timeline={selected.timeline} />
              </section>
              <section>
                <div className="context-heading">
                  <div>
                    <p className="eyebrow">QUALIFICATION</p>
                    <h3>
                      {qualification.completed}/{qualification.total} credit
                      inputs complete
                    </h3>
                  </div>
                  <Chip
                    tone={qualification.missing.length ? "amber" : "teal"}
                  >
                    {qualification.missing.length ? "INCOMPLETE" : "COMPLETE"}
                  </Chip>
                </div>
                {qualification.missing.length > 0 && (
                  <p className="qualification-gaps">
                    Missing: {qualification.missing.join(", ")}
                  </p>
                )}
                <dl className="status-list">
                  <div>
                    <dt>Current step</dt>
                    <dd>{pick(state || {}, ["Current Step"])}</dd>
                  </div>
                  <div>
                    <dt>Next action</dt>
                    <dd>{pick(state || {}, ["Next Action"])}</dd>
                  </div>
                  <div>
                    <dt>Consent</dt>
                    <dd>{pick(qualificationRecord, ["Consent Status"])}</dd>
                  </div>
                  <div>
                    <dt>Age</dt>
                    <dd>{pick(qualificationRecord, ["Age"])}</dd>
                  </div>
                  <div>
                    <dt>Employment type</dt>
                    <dd>
                      {pick(qualificationRecord, [
                        "Employment Type",
                        "Employment Status",
                      ])}
                    </dd>
                  </div>
                  <div>
                    <dt>Employment tenure</dt>
                    <dd>
                      {pick(qualificationRecord, [
                        "Employment Tenure Months",
                        "Employment Duration",
                      ])}
                    </dd>
                  </div>
                  <div>
                    <dt>Employer</dt>
                    <dd>{pick(qualificationRecord, ["Employer Name"])}</dd>
                  </div>
                  <div>
                    <dt>Industry</dt>
                    <dd>{pick(qualificationRecord, ["Industry"])}</dd>
                  </div>
                  <div>
                    <dt>Gross monthly income</dt>
                    <dd>
                      {pick(qualificationRecord, ["Monthly Income"]) !== "—"
                        ? `RM ${pick(qualificationRecord, ["Monthly Income"])}`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Verified net income</dt>
                    <dd>
                      {pick(qualificationRecord, ["Verified Net Income"]) !==
                      "—"
                        ? `RM ${pick(qualificationRecord, ["Verified Net Income"])}`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Income evidence</dt>
                    <dd>
                      {pick(qualificationRecord, [
                        "Income Verification Source",
                      ])}
                    </dd>
                  </div>
                  <div>
                    <dt>Variable income average</dt>
                    <dd>
                      {pick(qualificationRecord, [
                        "Variable Income Average",
                      ]) !== "—"
                        ? `RM ${pick(qualificationRecord, ["Variable Income Average"])}`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Monthly commitments</dt>
                    <dd>
                      {pick(qualificationRecord, [
                        "Existing Commitment",
                        "Monthly Commitments",
                      ]) !== "—"
                        ? `RM ${pick(qualificationRecord, ["Existing Commitment", "Monthly Commitments"])}`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Commitment breakdown</dt>
                    <dd>
                      {pick(qualificationRecord, ["Commitment Breakdown"])}
                    </dd>
                  </div>
                  <div>
                    <dt>Requested amount</dt>
                    <dd>{selected.lead.amount}</dd>
                  </div>
                  <div>
                    <dt>Requested tenure</dt>
                    <dd>
                      {pick(qualificationRecord, ["Requested Tenure Months"])}
                    </dd>
                  </div>
                  <div>
                    <dt>Salary bank-in</dt>
                    <dd>{pick(qualificationRecord, ["Salary Bank In"])}</dd>
                  </div>
                  <div>
                    <dt>EPF available</dt>
                    <dd>{pick(qualificationRecord, ["EPF Available"])}</dd>
                  </div>
                </dl>
              </section>
              <section>
                <div className="context-heading">
                  <div>
                    <p className="eyebrow">PRE-LMS CREDIT</p>
                    <h3>Affordability & policy</h3>
                  </div>
                  <Chip
                    tone={statusTone(
                      pick(assessment || {}, ["Assessment Status"]),
                    )}
                  >
                    {pick(assessment || {}, ["Assessment Status"])}
                  </Chip>
                </div>
                <dl className="status-list">
                  <div>
                    <dt>Preliminary DSR</dt>
                    <dd>
                      {pick(assessment || {}, ["Preliminary DSR"])}
                      {assessment?.["Preliminary DSR"] ? "%" : ""}
                    </dd>
                  </div>
                  <div>
                    <dt>Net disposable income</dt>
                    <dd>
                      {assessment?.["Net Disposable Income"]
                        ? `RM ${assessment["Net Disposable Income"]}`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Pre-screen score</dt>
                    <dd>
                      {assessment?.["Pre-Screen Score"]
                        ? `${assessment["Pre-Screen Score"]} / 100`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Hard rules</dt>
                    <dd>{pick(assessment || {}, ["Hard Rule Status"])}</dd>
                  </div>
                  <div>
                    <dt>LMS eligibility</dt>
                    <dd>
                      {pick(assessment || {}, ["LMS Submission Eligibility"])}
                    </dd>
                  </div>
                  <div>
                    <dt>Policy version</dt>
                    <dd>{pick(assessment || {}, ["Policy Version"])}</dd>
                  </div>
                  <div>
                    <dt>Reason codes</dt>
                    <dd>
                      {pick(assessment || {}, [
                        "Reason Codes",
                        "Hard Rule Reasons",
                      ])}
                    </dd>
                  </div>
                </dl>
              </section>
              <section>
                <div className="context-heading">
                  <div>
                    <p className="eyebrow">VERIFICATION & LMS</p>
                    <h3>Final decision lifecycle</h3>
                  </div>
                </div>
                <dl className="status-list">
                  <div>
                    <dt>Document status</dt>
                    <dd>{selected.lead.documentStatus}</dd>
                  </div>
                  <div>
                    <dt>AI verification</dt>
                    <dd>
                      {pick(verification || {}, [
                        "Overall Verification Status",
                      ])}
                    </dd>
                  </div>
                  <div>
                    <dt>Manual review</dt>
                    <dd>
                      {pick(verification || {}, ["Manual Review Required"])}
                    </dd>
                  </div>
                  <div>
                    <dt>Internal queue</dt>
                    <dd>{pick(lmsQueue || {}, ["Queue Status"])}</dd>
                  </div>
                  <div>
                    <dt>LMS status</dt>
                    <dd>{selected.lead.lmsStatus}</dd>
                  </div>
                  <div>
                    <dt>LMS bureau check</dt>
                    <dd>{pick(lmsResult || {}, ["Bureau Check Status"])}</dd>
                  </div>
                  <div>
                    <dt>LMS final decision</dt>
                    <dd>{pick(lmsResult || {}, ["Final Decision"])}</dd>
                  </div>
                  <div>
                    <dt>LMS final DSR</dt>
                    <dd>{pick(lmsResult || {}, ["Final DSR"])}</dd>
                  </div>
                </dl>
              </section>
              {postApproval && (
                <section className="post-approval-context">
                  <div className="context-heading">
                    <div>
                      <p className="eyebrow">POST-APPROVAL</p>
                      <h3>Agreement to disbursement</h3>
                    </div>
                    <Chip tone={postApproval.tone}>
                      {postApproval.stage.replaceAll("_", " ")}
                    </Chip>
                  </div>
                  <dl className="status-list">
                    <div>
                      <dt>Official LMS decision</dt>
                      <dd>{postApproval.lmsDecision}</dd>
                    </div>
                    <div>
                      <dt>Agreement</dt>
                      <dd>{postApproval.agreementStatus}</dd>
                    </div>
                    <div>
                      <dt>Direct Debit</dt>
                      <dd>{postApproval.directDebitStatus}</dd>
                    </div>
                    <div>
                      <dt>Disbursement</dt>
                      <dd>{postApproval.disbursementStatus}</dd>
                    </div>
                    <div>
                      <dt>Next required action</dt>
                      <dd>{postApproval.nextAction}</dd>
                    </div>
                  </dl>
                  {!postApproval.officialApproval && (
                    <p className="post-approval-lock">
                      Locked until the latest official LMS result is APPROVED.
                      Internal queue status is not approval evidence.
                    </p>
                  )}
                </section>
              )}
              <CustomerActions
                lead={selected.lead}
                user={user}
                onChanged={onChanged}
                onEdit={onEdit}
                readyForLms={Boolean(automation?.readyForLms)}
                verificationReady={verificationReady}
                queueRecord={lmsQueue}
                consentRecord={
                  selected.checklist.find(
                    (item) => item.type === "CTOS_CCRIS_CONSENT",
                  )?.record || null
                }
              />
            </aside>
          </>
        ) : (
          <div className="customer-360-empty">
            <strong>No customer records available</strong>
            <span>The selected access scope has no visible leads.</span>
          </div>
        )}
      </section>
    </div>
  );
}

function DocumentQueue({
  leads,
  data,
  onLead,
}: {
  leads: Lead[];
  data: Record<string, SheetRow[]>;
  onLead: (lead: Lead) => void;
}) {
  const summaries = useMemo(
    () =>
      buildConversationSummaries(leads, conversationSources(data)).filter(
        (summary) => summary.documentCount > 0,
      ),
    [leads, data],
  );
  const [query, setQuery] = useState("");
  const shown = summaries.filter((summary) =>
    `${summary.lead.name} ${summary.lead.id} ${summary.lead.phone}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const documentRows = data.Document_Received_Log || [];
  const completed = countCompletedDocuments(documentRows);
  return (
    <div className="content-stack">
      <SummaryStrip
        items={[
          { label: "Received documents", value: documentRows.length },
          { label: "Customers with documents", value: summaries.length },
          { label: "Completed / verified", value: completed },
        ]}
      />
      <section className="panel document-queue">
        <div className="table-toolbar">
          <div>
            <h2>Customer Document Queue</h2>
            <p>
              Documents are grouped by customer instead of separate log rows.
            </p>
          </div>
          <label className="search-box">
            <span>⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search customer..."
            />
          </label>
        </div>
        <div className="document-case-grid">
          {shown.length ? (
            shown.map((summary) => (
              <article className="document-case" key={summary.lead.id}>
                <header>
                  <div>
                    <h3>{summary.lead.name}</h3>
                    <p>{customerReference(summary.lead)}</p>
                  </div>
                  <Chip
                    tone={
                      summary.requiredReceived === summary.requiredTotal
                        ? "teal"
                        : "amber"
                    }
                  >
                    {summary.requiredReceived}/{summary.requiredTotal} REQUIRED
                  </Chip>
                </header>
                <div className="document-case-progress">
                  <i
                    style={{
                      width: `${Math.round((summary.requiredReceived / summary.requiredTotal) * 100)}%`,
                    }}
                  />
                </div>
                <div className="checklist">
                  {summary.checklist.map((item) => {
                    const record = item.record;
                    const url = safeSharePointUrl(record?.fileUrl || "");
                    return (
                      <div className="checklist-row" key={item.type}>
                        <span
                          className={`check-icon ${record ? "complete" : ""}`}
                        >
                          {record ? "✓" : "·"}
                        </span>
                        <span>
                          <strong>{item.label}</strong>
                          <small>
                            {record?.fileName ||
                              (item.required
                                ? "Missing"
                                : item.lmsRequired
                                  ? "Required before LMS"
                                  : "Optional")}
                          </small>
                        </span>
                        <span className="checklist-action">
                          {record && (
                            <Chip
                              tone={statusTone(
                                record.verificationStatus || record.status,
                              )}
                            >
                              {record.verificationStatus || record.status}
                            </Chip>
                          )}
                          {url && (
                            <a href={url} target="_blank" rel="noreferrer">
                              View
                            </a>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <OtherDocuments timeline={summary.timeline} />
                <footer>
                  <span>
                    {summary.lead.processingRoute === "AI_DIRECT"
                      ? "AI managed · Regional visibility"
                      : summary.lead.owner === "Unassigned"
                        ? "Waiting for SA assignment"
                        : `Assigned to ${summary.lead.owner}`}
                  </span>
                  <button onClick={() => onLead(summary.lead)}>
                    Open customer →
                  </button>
                </footer>
              </article>
            ))
          ) : (
            <div className="document-queue-empty">
              <strong>No matching document cases</strong>
              <span>
                Received customer files will appear here automatically.
              </span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

const workQueues: NavKey[] = [
  "Qualification",
  "Documents",
  "Verification",
  "Credit Assessment",
  "Follow-up",
  "Escalations",
];

function WorkQueue({
  leads,
  data,
  onLead,
  connected,
}: {
  leads: Lead[];
  data: Record<string, SheetRow[]>;
  onLead: (lead: Lead) => void;
  connected: boolean;
}) {
  const [queue, setQueue] = useState<NavKey>("Follow-up");
  const [dataScope, setDataScope] = useState<"PRODUCTION" | "ALL">(
    "PRODUCTION",
  );
  const scopedLeads = useMemo(
    () =>
      dataScope === "ALL"
        ? leads
        : leads.filter((lead) => !isSyntheticLead(lead.raw)),
    [dataScope, leads],
  );
  return (
    <div className="content-stack">
      <div className="queue-controls">
        <nav className="queue-tabs" aria-label="Work queue type">
          {workQueues.map((item) => (
            <button
              key={item}
              className={queue === item ? "active" : ""}
              onClick={() => setQueue(item)}
            >
              {item}
            </button>
          ))}
        </nav>
        <select
          aria-label="Work queue data scope"
          value={dataScope}
          onChange={(event) =>
            setDataScope(event.target.value as "PRODUCTION" | "ALL")
          }
        >
          <option value="PRODUCTION">Production only</option>
          <option value="ALL">Include test / UAT</option>
        </select>
      </div>
      {queue === "Documents" ? (
        <DocumentQueue leads={scopedLeads} data={data} onLead={onLead} />
      ) : (
        <ModulePage
          active={queue}
          filteredLeads={scopedLeads}
          onLead={onLead}
          connected={connected}
          data={data}
        />
      )}
    </div>
  );
}

function PostApprovalWorkspace({
  leads,
  data,
  onLead,
  user,
  onChanged,
}: {
  leads: Lead[];
  data: Record<string, SheetRow[]>;
  onLead: (lead: Lead) => void;
  user?: CrmUser;
  onChanged: () => void;
}) {
   const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const cases = useMemo(
    () =>
      buildPostApprovalCases({
        leads,
        lmsResults: data.LMS_Credit_Result || [],
        activities: data.Lead_Activities || [],
      }) as unknown as PostApprovalCase[],
    [data.LMS_Credit_Result, data.Lead_Activities, leads],
  );
  const agreementsSigned = cases.filter((item) => item.agreementSigned).length;
  const directDebitReady = cases.filter((item) => item.directDebitReady).length;
  const disbursed = cases.filter((item) => item.disbursed).length;
  const performAction = async (item: PostApprovalCase, action: string) => {
    const key = `${item.leadId}:${action}`;
    setBusy(key);
    setMessage("");
    setError(false);
    try {
      const response = await fetch("/api/fulfilment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId: item.leadId, action }),
      });
      const result = (await response.json()) as {
        error?: string;
        warning?: string;
        status?: string;
      };
      if (!response.ok) throw new Error(result.error || "Unable to record action.");
      setMessage(
        result.warning ||
          `${String(result.status || "Fulfilment action").replaceAll("_", " ")} recorded.`,
      );
      onChanged();
    } catch (requestError) {
      setError(true);
      setMessage(
        requestError instanceof Error
          ? requestError.message
          : "Unable to record action.",
      );
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="content-stack post-approval-workspace">
      <SummaryStrip
        items={[
          { label: "Officially approved", value: cases.length },
          { label: "Agreements signed", value: agreementsSigned },
          { label: "Direct Debit ready", value: directDebitReady },
          { label: "Disbursed", value: disbursed },
        ]}
      />
      <section className="panel fulfilment-flow" aria-label="Post-approval stages">
        <div>
          <span>1</span>
          <strong>Official LMS approval</strong>
          <small>Latest external result must be APPROVED</small>
        </div>
        <div>
          <span>2</span>
          <strong>Agreement</strong>
          <small>Prepare and capture signed evidence</small>
        </div>
        <div>
          <span>3</span>
          <strong>Direct Debit</strong>
          <small>Register and confirm the mandate</small>
        </div>
        <div>
          <span>4</span>
          <strong>Disbursement</strong>
          <small>Record the completed fund release</small>
        </div>
      </section>
      <section className="panel table-panel post-approval-register">
        <div className="table-toolbar">
          <div>
            <h2>Post-Approval Fulfilment</h2>
            <p>
              Internal queue rows are excluded until an official LMS approval
              result exists.
            </p>
          </div>
          <Chip tone="blue">CONTROLLED WORKFLOW</Chip>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>LMS decision</th>
                <th>Agreement</th>
                <th>Direct Debit</th>
                <th>Disbursement</th>
                <th>Next required action</th>
                <th>Controlled action</th>
              </tr>
            </thead>
            <tbody>
              {cases.length ? (
                cases.map((item) => {
                  const action = fulfilmentActionForCase(item, user);
                  const definition = action ? FULFILMENT_ACTIONS[action] : null;
                  const requiresRegionalControl =
                    item.stage === "READY_FOR_DISBURSEMENT" &&
                    !["admin", "regional_manager"].includes(user?.role || "");
                  return (
                  <tr key={item.leadId} className="clickable-row" onClick={() => onLead(item.lead)}>
                    <td>
                      <strong>{item.lead.name}</strong>
                      <span>
                        {item.leadId} · {item.lead.owner}
                      </span>
                    </td>
                    <td>
                      <Chip tone="teal">{item.lmsDecision}</Chip>
                      <span>{displayTime(item.approvedAt)}</span>
                    </td>
                    <td>
                      <Chip tone={item.agreementSigned ? "teal" : "amber"}>
                        {item.agreementStatus}
                      </Chip>
                    </td>
                    <td>
                      <Chip
                        tone={
                          item.directDebitReady
                            ? "teal"
                            : item.agreementSigned
                              ? "amber"
                              : "gray"
                        }
                      >
                        {item.directDebitStatus}
                      </Chip>
                    </td>
                    <td>
                      <Chip
                        tone={
                          item.disbursed
                            ? "teal"
                            : item.directDebitReady
                              ? "blue"
                              : "gray"
                        }
                      >
                        {item.disbursementStatus}
                      </Chip>
                    </td>
                    <td className="blocker-cell">
                      <strong>{item.stage.replaceAll("_", " ")}</strong>
                      <span>{item.nextAction}</span>
                    </td>
                    <td className="fulfilment-action-cell">
                      {definition ? (
                        <button
                          type="button"
                          disabled={busy === `${item.leadId}:${action}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            void performAction(item, action!);
                          }}
                        >
                          {busy === `${item.leadId}:${action}`
                            ? "Recording…"
                            : definition.label}
                        </button>
                      ) : (
                        <span>
                          {item.dataIssues.length
                            ? "Data exception — action locked"
                            : requiresRegionalControl
                              ? "Admin / Regional Manager required"
                              : item.disbursed
                                ? "Complete"
                                : "No authorised action"}
                        </span>
                      )}
                    </td>
                  </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="post-approval-empty" colSpan={7}>
                    <strong>No officially approved cases yet</strong>
                    <span>
                      Cases appear here only after the latest LMS result is
                      APPROVED. An internal LMS queue row is not an external
                      approval.
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {message && (
          <div className={`form-message post-approval-message${error ? " error" : ""}`}>
            {message}
          </div>
        )}
      </section>
    </div>
  );
}

function ModulePage({
  active,
  filteredLeads,
  onLead,
  connected,
  data,
  user,
  onChanged,
}: {
  active: NavKey;
  filteredLeads: Lead[];
  onLead: (lead: Lead) => void;
  connected: boolean;
  data: Record<string, SheetRow[]>;
  user?: CrmUser;
  onChanged?: () => void;
}) {
  if (active === "Leads")
    return (
      <LeadTable
        title="All Leads"
        leads={filteredLeads}
        onLead={onLead}
        connected={connected}
      />
    );
  if (active === "Documents")
    return <DocumentQueue leads={filteredLeads} data={data} onLead={onLead} />;

  const config = moduleConfig[active];
  if (!config) return null;
  const sourceRows =
    active === "Qualification"
      ? mergedQualificationRows(
          filteredLeads,
          data.Conversation_State || [],
        )
      : active === "Follow-up"
      ? mergedFollowUpRows(
          data.Follow_Up_Queue || [],
          data.Conversation_State || [],
        )
      : data[config.tab] || [];
  const rows =
    active === "Audit Log"
      ? sourceRows
      : rowsForVisibleLeads(sourceRows, filteredLeads);
  const openRow = (leadId: string) => {
    const lead = filteredLeads.find((item) => item.id === leadId);
    if (lead) onLead(lead);
  };

  if (active === "Verification") {
    const verified = rows.filter((row) =>
      ["verified", "passed", "complete", "completed"].includes(
        normalized(row["Overall Verification Status"]),
      ),
    ).length;
    const manualReview = rows.filter((row) => {
      const value = normalized(row["Manual Review Required"]);
      return ["yes", "true", "required", "manual review"].includes(value);
    }).length;
    const displayRows = rows.map((row) => ({
      ...row,
      "AI Confidence": formatConfidence(row["AI Confidence"]),
    }));
    return (
      <div className="content-stack">
        <SummaryStrip
          items={[
            { label: "Verification records", value: rows.length },
            { label: "Verified", value: verified },
            { label: "Manual review required", value: manualReview },
          ]}
        />
        <RecordTable
          title={config.title}
          rows={displayRows}
          columns={config.columns}
          onOpenLead={openRow}
        />
      </div>
    );
  }

  if (active === "Credit Assessment") {
    const scores = rows
      .map((row) => Number(row["Pre-Screen Score"]))
      .filter((score) => Number.isFinite(score));
    const average = scores.length
      ? Math.round(
          scores.reduce((total, score) => total + score, 0) / scores.length,
        )
      : 0;
    const eligible = rows.filter((row) =>
      ["yes", "true", "eligible"].includes(
        normalized(row["LMS Submission Eligibility"]),
      ),
    ).length;
    return (
      <div className="content-stack">
        <SummaryStrip
          items={[
            { label: "Credit assessments", value: rows.length },
            { label: "Average pre-screen", value: average },
            { label: "LMS eligible", value: eligible },
          ]}
        />
        <RecordTable
          title={config.title}
          rows={rows}
          columns={config.columns}
          onOpenLead={openRow}
        />
      </div>
    );
  }

  if (active === "Qualification") {
    const qualified = rows.filter((row) => {
      const status = normalized(row["Qualification Status"]);
      const step = normalized(row["Current Step"]);
      return (
        ["qualified", "complete", "completed", "approved"].includes(status) ||
        ["qualified", "documents", "approved"].includes(step)
      );
    }).length;
    const pending = rows.filter((row) => {
      const status = normalized(row["Qualification Status"]);
      return status.includes("pending") || status.includes("waiting");
    }).length;
    return (
      <div className="content-stack">
        <SummaryStrip
          items={[
            { label: "Conversation states", value: rows.length },
            { label: "Qualified", value: qualified },
            { label: "Pending / waiting", value: pending },
          ]}
        />
        <RecordTable
          title={config.title}
          rows={rows}
          columns={config.columns}
          onOpenLead={openRow}
        />
      </div>
    );
  }

  if (active === "Follow-up") {
        const queueRows = rows.filter((row) => {
      const status = normalized(row.Status);
      return !["resolved", "closed", "completed", "cancelled"].includes(
        status,
      );
    });
    const applications = buildApplicationRegister(filteredLeads, data);
    const queuedLeadIds = new Set(
      queueRows.map((row) => pick(row, ["Lead ID"])).filter(Boolean),
    );
    const derivedRows = applications
      .filter((item) => ["QUALIFICATION", "DOCUMENTS"].includes(item.phase))
      .filter((item) => !queuedLeadIds.has(item.lead.id))
      .map((item) => ({
        "Lead ID": item.lead.id,
        "Lead Name": item.lead.name,
        "Phone Number": item.lead.phone,
        "Follow Up Type": item.phase === "DOCUMENTS" ? "Missing documents" : "Incomplete information",
        "Next Action": pick(item.state || {}, ["Next Action"]) || item.blocker,
        "Due At": "Awaiting S09 schedule",
        Status: item.phase,
        "Assigned To": item.lead.owner || (item.lead.processingRoute === "AI_DIRECT" ? "AI Direct" : "Unassigned"),
        Source: "Application Register",
      }));
    const followRows = [...queueRows, ...derivedRows].map((row) => {
      const leadState = latestRow(data.Conversation_State || [], pick(row, ["Lead ID"])) || {};
      return {
        ...leadState,
        ...row,
        "Reminder Stage": pick(row, ["Reminder Stage", "Last AI Message Type"]) !== "—"
          ? pick(row, ["Reminder Stage", "Last AI Message Type"])
          : pick(leadState, ["Last AI Message Type"]),
        "Last Reminder At": pick(row, ["Last Reminder At", "Last AI Message At"]) !== "—"
          ? pick(row, ["Last Reminder At", "Last AI Message At"])
          : pick(leadState, ["Last AI Message At"]),
        "AI Status": pick(leadState, ["AI Status"]) === "—"
          ? "ACTIVE"
          : pick(leadState, ["AI Status"]),
      };
    });
    const qualificationPending = applications.filter(
      (item) => item.phase === "QUALIFICATION",
    ).length;
    const documentPending = applications.filter(
      (item) => item.phase === "DOCUMENTS",
    ).length;
    return (
      <div className="content-stack">
        <SummaryStrip
          items={[
            { label: "Follow-up actions", value: followRows.length },
            { label: "Qualification pending", value: qualificationPending },
            { label: "Document pending", value: documentPending },
          ]}
        />
        <RecordTable
          title={config.title}
          rows={followRows}
          columns={config.columns}
          onOpenLead={openRow}
        />
      </div>
    );
  }

  if (active === "Conversations") {
    const sources = conversationSources(data);
    const conversationSummaries = buildConversationSummaries(filteredLeads, sources);
    const conversationRows = buildConversationRows(
      filteredLeads,
      sources,
    );
    const customerMessages = conversationRows.filter(
      (row) => row.Direction === "CUSTOMER",
    ).length;
    const outboundMessages = conversationRows.filter(
      (row) => row.Direction === "OUTBOUND",
    ).length;
    const deliveryProblems = conversationRows.filter((row) =>
      /failed|error|rejected|undeliver/i.test(row.Status || ""),
    ).length;
    return (
      <div className="content-stack">
        <SummaryStrip
          items={[
            { label: "All recorded messages", value: conversationRows.length },
            { label: "Customer messages", value: customerMessages },
            { label: "Outbound / AI records", value: outboundMessages },
            { label: "Recorded delivery problems", value: deliveryProblems },
          ]}
        />
        <WhatsAppConsole
          leads={conversationSummaries.map((summary) => summary.lead)}
          data={data}
          user={user}
          onChanged={onChanged || (() => {})}
        />
      </div>
    );
  }

  if (active === "Escalations") {
    const open = rows.filter(
      (row) =>
        !["resolved", "closed", "completed"].includes(normalized(row.Status)),
    ).length;
    const highPriority = rows.filter((row) =>
      ["high", "urgent", "critical"].includes(normalized(row.Priority)),
    ).length;
    return (
      <div className="content-stack">
        <SummaryStrip
          items={[
            { label: "Escalation records", value: rows.length },
            { label: "Open", value: open },
            { label: "High priority", value: highPriority },
          ]}
        />
        <RecordTable
          title={config.title}
          rows={rows}
          columns={config.columns}
          onOpenLead={openRow}
        />
      </div>
    );
  }

  if (active === "LMS Status") {
    const lmsStatus = buildLmsStatus({
      leads: filteredLeads,
      queueRows: data.LMS_Submission_Queue || [],
      resultRows: data.LMS_Credit_Result || [],
    });
    return (
      <div className="content-stack">
        <SummaryStrip
          items={[
            {
              label: "Internal queue records",
              value: lmsStatus.summary.internalQueue,
            },
            {
              label: "External submissions",
              value: lmsStatus.summary.externalSubmitted,
            },
            {
              label: "Official decisions",
              value: lmsStatus.summary.officialDecisions,
            },
            { label: "Approved", value: lmsStatus.summary.approved },
          ]}
        />
        <RecordTable
          title="Internal LMS Submission Queue"
          rows={lmsStatus.queueRows}
          columns={config.columns}
          onOpenLead={openRow}
        />
        <RecordTable
          title="Official LMS Decisions"
          rows={lmsStatus.resultRows}
          columns={[
            { label: "Lead", keys: ["Lead ID"] },
            {
              label: "Submission",
              keys: ["LMS Submission ID", "Submission ID"],
            },
            {
              label: "Final Decision",
              keys: ["Final Decision", "Decision", "Result"],
            },
            { label: "Bureau Check", keys: ["Bureau Check Status"] },
            { label: "Final DSR", keys: ["Final DSR"] },
            {
              label: "Decision At",
              keys: ["Decision At", "Callback At", "Updated At"],
            },
          ]}
          onOpenLead={openRow}
        />
      </div>
    );
  }

  return (
    <div className="content-stack">
      <SummaryStrip
        items={[
          { label: "Total records", value: rows.length },
          { label: "Source tab", value: config.tab },
          { label: "Access", value: "Read only" },
        ]}
      />
      <RecordTable
        title={config.title}
        rows={rows}
        columns={config.columns}
        onOpenLead={openRow}
      />
    </div>
  );
}

function LeadDrawer({
  lead,
  onClose,
  user,
  onChanged,
  onEdit,
}: {
  lead: Lead | null;
  onClose: () => void;
  user?: CrmUser;
  onChanged: () => void;
  onEdit: (lead: Lead) => void;
}) {
  const [message, setMessage] = useState("");
  if (!lead) return null;
  const activeLead = lead;
  const canReview = canReviewSaCase(user, lead.processingRoute);
  const verificationReady = [
    "verified",
    "passed",
    "complete",
    "completed",
  ].includes(normalized(lead.documentStatus));
  const canEditDraft = canContinueManualApplication(user, lead.raw);
  async function action(operation: "approve" | "return" | "reassign") {
    const reason =
      operation === "return"
        ? window.prompt("Reason and missing documents:") || ""
        : "";
    const salesId =
      operation === "reassign" ? window.prompt("New Sales ID:") || "" : "";
    if (
      (operation === "return" && !reason) ||
      (operation === "reassign" && !salesId)
    )
      return;
    const response = await fetch("/api/applications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation,
        leadId: activeLead.id,
        reason,
        "Assigned Sales ID": salesId,
      }),
    });
    const result = (await response.json()) as {
      error?: string;
      status?: string;
    };
    setMessage(
      response.ok
        ? `Completed: ${result.status}`
        : result.error || "Action failed.",
    );
    if (response.ok) onChanged();
  }
  return (
    <>
      <button
        className="drawer-backdrop"
        aria-label="Close lead details"
        onClick={onClose}
      />
      <aside className="lead-drawer">
        <div className="drawer-header">
          <div>
            <p className="eyebrow">LEAD DETAILS</p>
            <h2>{lead.name}</h2>
            <span>{lead.id}</span>
          </div>
          <button onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="drawer-banner">
          <StageChip stage={lead.stage} />
          <span>
            {lead.processingRoute === "AI_DIRECT"
              ? "AI managed · Regional visibility"
              : canReview
                ? "SA assisted · Manager review"
                : "Assigned SA record"}
          </span>
        </div>
        <div className="detail-grid">
          <div>
            <span>Processing Route</span>
            <strong>{lead.processingRoute}</strong>
          </div>
          <div>
            <span>Visibility</span>
            <strong>{lead.caseVisibility}</strong>
          </div>
          <div>
            <span>Phone</span>
            <strong>{lead.phone}</strong>
          </div>
          <div>
            <span>Branch</span>
            <strong>{lead.branch}</strong>
          </div>
          <div>
            <span>Assigned Sales</span>
            <strong>{lead.owner}</strong>
          </div>
          <div>
            <span>Escalation Reason</span>
            <strong>{lead.escalationReason}</strong>
          </div>
          <div>
            <span>Requested Amount</span>
            <strong>{lead.amount}</strong>
          </div>
          <div>
            <span>Lead Score</span>
            <strong>{lead.score} / 100</strong>
          </div>
          <div>
            <span>Risk</span>
            <strong>{lead.risk}</strong>
          </div>
          <div>
            <span>Document Status</span>
            <strong>{lead.documentStatus}</strong>
          </div>
          <div>
            <span>LMS Status</span>
            <strong>{lead.lmsStatus}</strong>
          </div>
        </div>
        <section className="drawer-section">
          <h3>AI Assessment</h3>
          <p>{lead.aiAssessment}</p>
        </section>
        {canEditDraft && (
          <section className="drawer-section">
            <h3>Draft Application</h3>
            <p>
              Continue this saved application and upload any missing customer
              documents.
            </p>
            <div className="manager-actions">
              <button onClick={() => onEdit(activeLead)}>
                Continue Editing + Documents
              </button>
            </div>
          </section>
        )}
        {canReview && (
          <section className="drawer-section">
            <h3>Manager Actions</h3>
            <div className="manager-actions">
              {verificationReady && (
                <button onClick={() => action("approve")}>
                  Approve Verification
                </button>
              )}
              <button onClick={() => action("return")}>
                Return for Documents
              </button>
              <button onClick={() => action("reassign")}>Reassign Staff</button>
            </div>
            {!verificationReady && (
              <p className="form-message error">
                Verification approval is locked.
              </p>
            )}
            {message && <p className="form-message">{message}</p>}
          </section>
        )}
      </aside>
    </>
  );
}

const documentSlots = [
  {
    type: "IC_FRONT",
    label: "IC Front",
    required: true,
    lmsRequired: false,
    help: "Front side showing photo, name and IC number",
  },
  {
    type: "IC_BACK",
    label: "IC Back",
    required: true,
    lmsRequired: false,
    help: "Reverse side of the identity card",
  },
  {
    type: "PAYSLIP",
    label: "Latest Payslip",
    required: true,
    lmsRequired: false,
    help: "PDF, JPG or PNG",
  },
  {
    type: "BANK_STATEMENT",
    label: "Bank Statement",
    required: true,
    lmsRequired: false,
    help: "Latest available statement; up to 3 months preferred",
  },
  {
    type: "EPF_STATEMENT",
    label: "EPF Statement",
    required: false,
    lmsRequired: false,
    help: "Optional supporting document",
  },
  {
    type: "CTOS_CCRIS_CONSENT",
    label: "Signed CTOS / CCRIS Consent Letter",
    required: false,
    lmsRequired: true,
    help: "Consent_BPH_V.40_01112020; required before LMS Queue, not before application verification",
  },
  {
    type: "CUSTOMER_CCRIS_REPORT",
    label: "Customer-provided CCRIS Report",
    required: false,
    lmsRequired: false,
    help: "Optional reference only; does not replace consent or the latest official LMS check",
  },
] as const;

function ManualApplication({
  user,
  branches,
  onSaved,
  initialLead,
  initialQualification,
  existingDocuments,
}: {
  user?: CrmUser;
  branches: string[];
  onSaved: () => void;
  initialLead?: Lead | null;
  initialQualification?: SheetRow;
  existingDocuments: Record<string, string>;
}) {
  const [leadId, setLeadId] = useState(initialLead?.id || "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<Record<string, File | undefined>>({});
  const [uploaded, setUploaded] =
    useState<Record<string, string>>(existingDocuments);
  async function save(
    event: React.FormEvent<HTMLFormElement> | HTMLFormElement,
    action: "draft" | "submit",
  ) {
    const formElement =
      event instanceof HTMLFormElement ? event : event.currentTarget;
    if (!(event instanceof HTMLFormElement)) event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (action === "submit") {
        const missingDocs = documentSlots.filter(
          (slot) => slot.required && !files[slot.type] && !uploaded[slot.type],
        );
        if (missingDocs.length)
          throw new Error(
            `Upload required documents: ${missingDocs.map((slot) => slot.label).join(", ")}.`,
          );
      }
      const form = new FormData(formElement);
      const payload = Object.fromEntries(
        Array.from(form.entries()).filter(
          ([, value]) => typeof value === "string",
        ),
      );
      const draftResponse = await fetch("/api/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, leadId, action: "draft" }),
      });
      const draftResult = (await draftResponse.json()) as {
        error?: string;
        leadId?: string;
      };
      if (!draftResponse.ok || !draftResult.leadId)
        throw new Error(draftResult.error || "Unable to save application.");
      const activeLeadId = draftResult.leadId;
      setLeadId(activeLeadId);

      const newlyUploaded: Record<string, string> = {};
      for (const slot of documentSlots) {
        const file = files[slot.type];
        if (!file) continue;
        setMessage(`Uploading ${slot.label}…`);
        const uploadData = new FormData();
        uploadData.set("leadId", activeLeadId);
        uploadData.set("documentType", slot.type);
        uploadData.set("file", file);
        const uploadResponse = await fetch("/api/documents", {
          method: "POST",
          body: uploadData,
        });
        const uploadResult = (await uploadResponse.json()) as {
          error?: string;
          fileName?: string;
        };
        if (!uploadResponse.ok)
          throw new Error(
            `${slot.label}: ${uploadResult.error || "Upload failed."}`,
          );
        newlyUploaded[slot.type] = uploadResult.fileName || file.name;
      }
      if (Object.keys(newlyUploaded).length)
        setUploaded((current) => ({ ...current, ...newlyUploaded }));

      if (action === "submit") {
        const submitResponse = await fetch("/api/applications", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...payload,
            leadId: activeLeadId,
            action: "submit",
          }),
        });
        const submitResult = (await submitResponse.json()) as {
          error?: string;
        };
        if (!submitResponse.ok)
          throw new Error(
            submitResult.error || "Unable to submit application.",
          );
      }
      setMessage(
        action === "submit"
          ? `Application ${activeLeadId} and documents submitted for verification.`
          : `Draft ${activeLeadId} and selected documents saved.`,
      );
      onSaved();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to save application.",
      );
    } finally {
      setBusy(false);
    }
  }
  const staffBranch = user?.role === "staff" ? user.branchIds[0] : "";
  const values = {
    ...(initialQualification || {}),
    ...(initialLead?.raw || {}),
  };
  const initialBranch = values["Branch ID"] || staffBranch;
  return (
    <form
      className="application-form panel"
      onSubmit={(event) => save(event, "submit")}
    >
      <div className="application-heading">
        <div>
          <h2>
            {leadId ? "Continue Draft Application" : "Manual Application"}
          </h2>
          <p>
            {leadId
              ? `Editing ${leadId}`
              : "Create a new LoanBuddy application"}
          </p>
        </div>
        <Chip tone="blue">{user?.role?.toUpperCase() || "SECURE"}</Chip>
      </div>
      <div className="form-section">
        <h3>Customer</h3>
        <div className="form-grid">
          <label>
            Full Name *
            <input
              name="Lead Name"
              required
              defaultValue={values["Lead Name"] || ""}
            />
          </label>
          <label>
            Phone Number *
            <input
              name="Phone Number"
              required
              placeholder="60123456789"
              defaultValue={values["Phone Number"] || ""}
            />
          </label>
          <label>
            IC Number *
            <input
              name="IC Number"
              placeholder="900101-14-1234"
              defaultValue={values["IC Number"] || ""}
            />
          </label>
          <label>
            Branch *
            <select name="Branch ID" required defaultValue={initialBranch}>
              {!initialBranch && <option value="">Select branch</option>}
              {staffBranch ? (
                <option>{staffBranch}</option>
              ) : (
                branches.map((value) => <option key={value}>{value}</option>)
              )}
            </select>
          </label>
        </div>
      </div>
      <div className="form-section">
        <h3>Qualification & Pre-LMS Credit Inputs</h3>
        <p className="section-note">
          These fields are saved to Conversation_State for the deterministic
          credit assessment. CTOS / CCRIS remains an LMS function and is not
          requested from the customer.
        </p>
        <div className="form-grid">
          <label>
            Gross Monthly Income (RM) *
            <input
              name="Monthly Income"
              type="number"
              min="0"
              required
              defaultValue={values["Monthly Income"] || ""}
            />
          </label>
          <label>
            Verified Net Income (RM) *
            <input
              name="Verified Net Income"
              type="number"
              min="0"
              required
              defaultValue={values["Verified Net Income"] || ""}
            />
          </label>
          <label>
            Variable Income Average (RM)
            <input
              name="Variable Income Average"
              type="number"
              min="0"
              defaultValue={values["Variable Income Average"] || ""}
            />
          </label>
          <label>
            Loan Amount Requested (RM) *
            <input
              name="Loan Amount Requested"
              type="number"
              min="0"
              required
              defaultValue={
                values["Loan Amount Requested"] || values["Loan Amount"] || ""
              }
            />
          </label>
          <label>
            Requested Tenure (Months) *
            <input
              name="Requested Tenure Months"
              type="number"
              min="1"
              required
              defaultValue={values["Requested Tenure Months"] || ""}
            />
          </label>
          <label>
            Customer Age *
            <input
              name="Age"
              type="number"
              min="0"
              required
              defaultValue={values.Age || ""}
            />
          </label>
          <label>
            Employment Status *
            <select
              name="Employment Status"
              required
              defaultValue={
                values["Employment Status"] || values["Employment Type"] || ""
              }
            >
              <option value="">Select status</option>
              <option>Fixed Salary</option>
              <option>Commission with Verifiable Income</option>
              <option>Self Employed</option>
            </select>
          </label>
          <label>
            Employment Tenure (Months) *
            <input
              name="Employment Tenure Months"
              type="number"
              min="0"
              required
              defaultValue={
                values["Employment Tenure Months"] ||
                values["Employment Duration"] ||
                ""
              }
            />
          </label>
          <label>
            Employer Name *
            <input
              name="Employer Name"
              required
              defaultValue={values["Employer Name"] || ""}
            />
          </label>
          <label>
            Employer / Industry *
            <input
              name="Industry"
              required
              placeholder="e.g. Manufacturing"
              defaultValue={values.Industry || ""}
            />
          </label>
          <label>
            Salary Bank In *
            <select
              name="Salary Bank In"
              required
              defaultValue={values["Salary Bank In"] || ""}
            >
              <option value="">Select</option>
              <option>YES</option>
              <option>NO</option>
            </select>
          </label>
          <label>
            EPF Available
            <select
              name="EPF Available"
              defaultValue={values["EPF Available"] || ""}
            >
              <option value="">Select</option>
              <option>YES</option>
              <option>NO</option>
            </select>
          </label>
          <label>
            Monthly Commitments (RM) *
            <input
              name="Monthly Commitments"
              type="number"
              min="0"
              required
              defaultValue={
                values["Monthly Commitments"] ||
                values["Existing Commitment"] ||
                ""
              }
            />
          </label>
          <label>
            Commitment Breakdown
            <input
              name="Commitment Breakdown"
              placeholder="Housing, vehicle, cards, other commitments"
              defaultValue={values["Commitment Breakdown"] || ""}
            />
          </label>
          <label>
            Income Verification Source *
            <select
              name="Income Verification Source"
              required
              defaultValue={values["Income Verification Source"] || ""}
            >
              <option value="">Select evidence</option>
              <option>Payslip + Bank Statement</option>
              <option>Payslip</option>
              <option>Bank Statement</option>
              <option>Other Verified Evidence</option>
            </select>
          </label>
          <label>
            Preferred Language
            <select
              name="Preferred Language"
              defaultValue={values["Preferred Language"] || "BM"}
            >
              <option value="BM">Bahasa Melayu</option>
              <option value="EN">English</option>
              <option value="ZH">中文</option>
            </select>
          </label>
          <label>
            Customer Data Consent *
            <select
              name="Consent Status"
              required
              defaultValue={values["Consent Status"] || ""}
            >
              <option value="">Select</option>
              <option value="YES">YES — Confirmed</option>
              <option value="NO">NO — Not confirmed</option>
            </select>
          </label>
          <label>
            Source
            <input
              name="Manual Source Detail"
              placeholder="Walk-in / Call / WhatsApp"
              defaultValue={values["Manual Source Detail"] || ""}
            />
          </label>
        </div>
      </div>
      <div className="form-section">
        <h3>Customer Documents</h3>
        <p className="section-note">
          Files are stored securely in LoanBuddy SharePoint. PDF, JPG or PNG
          only; maximum 10 MB each.
        </p>
        <ConsentTemplateActions />
        <div className="document-upload-grid">
          {documentSlots.map((slot) => (
            <label
              className={`document-upload ${files[slot.type] || uploaded[slot.type] ? "selected" : ""}`}
              key={slot.type}
            >
              <span>
                <strong>
                  {slot.label}
                  {slot.required ? " *" : slot.lmsRequired ? " · LMS gate" : ""}
                </strong>
                <small>
                  {files[slot.type]?.name
                    ? `${uploaded[slot.type] ? "Replacement selected" : "Selected"}: ${files[slot.type]?.name}`
                    : uploaded[slot.type]
                      ? `Uploaded: ${uploaded[slot.type]}`
                      : slot.help}
                </small>
              </span>
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                onChange={(event) =>
                  setFiles((current) => ({
                    ...current,
                    [slot.type]: event.target.files?.[0],
                  }))
                }
              />
              <em>
                {files[slot.type]
                  ? uploaded[slot.type]
                    ? "Replace"
                    : "Selected"
                  : uploaded[slot.type]
                    ? "Uploaded"
                    : "Choose file"}
              </em>
            </label>
          ))}
        </div>
      </div>
      {message && (
        <div
          className={
            /Unable|Missing|duplicate|failed|required|not configured/i.test(
              message,
            )
              ? "form-message error"
              : "form-message"
          }
        >
          {message}
        </div>
      )}
      <div className="form-actions">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={(event) => save(event.currentTarget.form!, "draft")}
        >
          Save Draft + Files
        </button>
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Submit for Verification"}
        </button>
      </div>
    </form>
  );
}

type FollowUpSettings = {
  enabled: boolean;
  firstMinutes: number;
  secondMinutes: number;
  thirdMinutes: number;
  finalMinutes: number;
  maxCount: number;
  businessHoursOnly: boolean;
  stopOnReply: boolean;
  stopOnOptOut: boolean;
  informationIncomplete: boolean;
  documentsIncomplete: boolean;
    businessStart: string;
  businessEnd: string;
configured?: boolean;
  updatedAt?: string;
};

const followUpTimingFields = [
  ["firstMinutes", "Reminder 1", "Recommended: 2 hours"],
  ["secondMinutes", "Reminder 2", "Recommended: 24 hours"],
  ["thirdMinutes", "Reminder 3", "Recommended: 3 days"],
  ["finalMinutes", "Final reminder", "Recommended: 7 days"],
] as const;

const followUpSalesIntent = [
  ["Helpful check-in", "Offer assistance and ask for the single next missing item."],
  ["Value reminder", "Reconnect the application goal and make document submission easy."],
  ["Progress recovery", "Address hesitation and guide the customer back to the application."],
  ["Respectful close", "Give one clear final action without pressure or repeated chasing."],
] as const;

  function followUpDuration(minutes: number) {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} minutes`;
}

function FollowUpSettingsManagement({ user }: { user?: CrmUser }) {
  const [settings, setSettings] = useState<FollowUpSettings>({
    ...DEFAULT_FOLLOW_UP_SETTINGS,
  });
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmEnable, setConfirmEnable] = useState(false);
  const canManage = ["admin", "regional_manager"].includes(user?.role || "");
  const load = useCallback(() => {
    setLoadingSettings(true);
    return fetch("/api/follow-up-settings", { cache: "no-store" })
      .then(async (response) => {
        const result = (await response.json()) as { settings?: FollowUpSettings; error?: string };
        if (!response.ok) throw new Error(result.error || "Unable to load follow-up settings.");
        setSettings(result.settings || { ...DEFAULT_FOLLOW_UP_SETTINGS });
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load follow-up settings."))
      .finally(() => setLoadingSettings(false));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async (confirmed = false) => {
    if (settings.enabled && !confirmed) {
      setConfirmEnable(true);
      setMessage("Confirm before enabling: saved settings will be available to the automatic S09 follow-up workflow.");
      return;
    }
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/follow-up-settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        settings,
        expectedUpdatedAt: settings.updatedAt || "",
        confirmation: settings.enabled ? "ENABLE_FOLLOW_UP_ENGINE" : "SAVE_FOLLOW_UP_SETTINGS",
      }),
    });
    const result = (await response.json()) as { settings?: FollowUpSettings; error?: string };
    if (response.ok) {
      if (result.settings) setSettings(result.settings);
      setMessage(settings.enabled
        ? "Follow-up settings saved and the CRM master switch is ON."
        : "Follow-up settings saved. The CRM master switch remains OFF.");
      setConfirmEnable(false);
    } else setMessage(result.error || "Unable to save follow-up settings.");
    setBusy(false);
  };
  const update = <K extends keyof FollowUpSettings>(key: K, value: FollowUpSettings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));

  return (
    <div className="content-stack follow-up-settings">
      <SummaryStrip items={[
        { label: "Master switch", value: loadingSettings ? "Loading…" : settings.enabled ? "ON" : "OFF" },
        { label: "Reminder steps", value: settings.maxCount },
        { label: "First reminder", value: followUpDuration(settings.firstMinutes) },
        { label: "Final reminder", value: followUpDuration(settings.finalMinutes) },
      ]} />
      <section className={`panel follow-up-master ${settings.enabled ? "is-on" : "is-off"}`}>
        <div>
          <span>AUTOMATION MASTER CONTROL</span>
          <h2>Incomplete Customer Follow-up</h2>
          <p>Controls reminders when required application information or documents are unfinished. Customer replies, pause requests and opt-outs always stop the sequence.</p>
        </div>
        <label className="follow-up-switch">
          <input type="checkbox" checked={settings.enabled} disabled={!canManage || loadingSettings || busy}
            onChange={(event) => { update("enabled", event.target.checked); setConfirmEnable(false); }} />
          <strong>{settings.enabled ? "ENGINE ON" : "ENGINE OFF"}</strong>
        </label>
      </section>
      <section className="panel follow-up-editor">
        <div className="table-toolbar">
          <div><h2>Reminder Timing</h2><p>All timings are measured from the customer becoming inactive, not from the previous reminder.</p></div>
          <Chip tone="blue">MYT</Chip>
        </div>
        <div className="follow-up-timing-grid">
          {followUpTimingFields.map(([key, label, helper], index) => (
            <label key={key}>
              <span>{index + 1}</span>
              <strong>{label}</strong>
              <input type="number" min="15" step="15" value={settings[key]}
                disabled={!canManage || busy}
                onChange={(event) => update(key, Number(event.target.value))} />
              <small>minutes · {followUpDuration(settings[key])}<br />{helper}</small>
            </label>
          ))}
        </div>
      </section>
            <section className="panel follow-up-sequence-control">
        <div><strong>Maximum reminder steps</strong><small>S09 stops after this number of automated reminders. Timing steps above the selected limit will not be sent.</small></div>
        <label><span>Active steps</span><select value={settings.maxCount} disabled={!canManage || busy} onChange={(event) => update("maxCount", Number(event.target.value))}>{[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count} reminder{count === 1 ? "" : "s"}</option>)}</select></label>
      </section>
<section className="panel follow-up-rules">
        <div className="table-toolbar"><div><h2>Safety & Case Rules</h2><p>Mandatory stop controls cannot be disabled.</p></div></div>
        <div className="follow-up-rule-grid">
          {([
            ["informationIncomplete", "Incomplete information", "Follow up when application questions are unfinished."],
            ["documentsIncomplete", "Incomplete documents", "Follow up only for documents genuinely still missing."],
                    ["businessHoursOnly", "Business hours only", "Hold reminders outside approved operating hours."],
            ["stopOnReply", "Stop on customer reply", "Mandatory — prevents messages after the customer responds."],
            ["stopOnOptOut", "Stop on pause / opt-out", "Mandatory — respects refusal, pause and unsubscribe intent."],
          ] as const).map(([key, label, copy]) => (
            <label key={key}>
              <input type="checkbox" checked={settings[key]}
                disabled={!canManage || busy || key === "stopOnReply" || key === "stopOnOptOut"}
                                onChange={(event) => update(key, event.target.checked)} />
              <span><strong>{label}</strong><small>{copy}</small></span>
            </label>
          ))}
        </div>
        <div className="follow-up-business-window">
          <div><strong>Approved sending window</strong><small>Asia/Kuala_Lumpur (MYT). S09 holds automated reminders outside this window.</small></div>
          <label><span>Start</span><input type="time" value={settings.businessStart} disabled={!canManage || busy || !settings.businessHoursOnly} onChange={(event) => update("businessStart", event.target.value)} /></label>
          <label><span>End</span><input type="time" value={settings.businessEnd} disabled={!canManage || busy || !settings.businessHoursOnly} onChange={(event) => update("businessEnd", event.target.value)} /></label>
        </div>
</section>
            <section className="panel follow-up-preview">
                <div className="table-toolbar"><div><h2>Sequence Preview & Sales Intent</h2><p>The AI creates a fresh message from the live case, answers the customer first and asks only for genuinely missing information or documents.</p></div><Chip tone="teal">{settings.maxCount} ACTIVE</Chip></div>
        <div className="follow-up-preview-grid">
          {followUpTimingFields.map(([key, label], index) => (
            <article key={key} className={index >= settings.maxCount ? "is-inactive" : ""}>
              <span>{index + 1}</span><div><strong>{label} · {followUpSalesIntent[index][0]}</strong><small>{followUpSalesIntent[index][1]}</small><em>{index >= settings.maxCount ? "Disabled by maximum steps" : "After " + followUpDuration(settings[key]) + " inactive"}</em></div>
            </article>
          ))}
        </div>
        <div className="follow-up-guardrails">
          <div><strong>Eligible</strong><small>Application information unfinished or required documents genuinely missing.</small></div>
          <div><strong>Stops immediately</strong><small>Customer replies, asks to pause, refuses, opts out, or the case becomes complete.</small></div>
          <div><strong>Message standard</strong><small>Natural Malaysian language, no repeated question, no false approval promise, and one clear next action.</small></div>
        </div>
      </section>
{confirmEnable && canManage && (
        <section className="panel follow-up-confirm">
          <div><strong>Enable automatic follow-up?</strong><p>This saves the active schedule for S09. Verify the Make scenario connection before production sending.</p></div>
          <div><button className="account-secondary" onClick={() => setConfirmEnable(false)} disabled={busy}>Cancel</button><button onClick={() => void save(true)} disabled={busy}>{busy ? "Saving…" : "Confirm Enable"}</button></div>
        </section>
      )}
      <div className="follow-up-actions">
        <span>{settings.updatedAt ? `Last updated ${displayTime(settings.updatedAt)}` : "Using controlled defaults"}</span>
        {canManage ? <div><button className="account-secondary" disabled={busy} onClick={() => { setSettings({ ...DEFAULT_FOLLOW_UP_SETTINGS, updatedAt: settings.updatedAt }); setConfirmEnable(false); }}>Restore Recommended</button><button disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save Settings"}</button></div> : <small>Manager view only. Admin or Regional Manager can change these controls.</small>}
      </div>
      {message && <div className={/Unable|must|required|changed|error/i.test(message) ? "form-message error" : "form-message"}>{message}</div>}
    </div>
  );
}


type PolicyRecord = Record<string, string> & {
  activation?: { valid: boolean; errors: string[] };
};
type PolicyEngineState = {
  configured: boolean;
  enabled: boolean;
  operational: boolean;
  canEnable: boolean;
  reasons: string[];
  activePolicyCount: number;
  activePolicy: { code: string; version: string } | null;
  updatedAt: string;
};
const initialPolicy: Record<string, string> = {
  "Policy Code": "LB_PERSONAL_LOAN",
  "Policy Version": "",
  "Effective From": "",
  "Product Name": "Personal Loan",
  Currency: "MYR",
  "Minimum Age": "",
  "Maximum Age At Maturity": "",
  "Minimum Employment Tenure Months": "",
  "Minimum Verified Net Income": "",
  "Maximum Preliminary DSR": "",
  "Minimum Net Disposable Income": "",
  "Minimum Loan Amount": "",
  "Maximum Loan Amount": "",
  "Minimum Tenure Months": "",
  "Maximum Tenure Months": "",
  "Variable Income Recognition Percent": "",
  "Minimum Auto LMS Score": "",
  "Manual Review Score": "",
  "Required Documents": "IC_FRONT,IC_BACK,PAYSLIP,BANK_STATEMENT",
  "Optional Documents": "EPF_STATEMENT",
  "Policy Notes": "",
};
const initialManagementApproval = {
  approvedBy: "",
  approvalDate: "",
  approvalReference: "",
};
const policyFields = [
  ["Policy Code", "text"],
  ["Policy Version", "text"],
  ["Effective From", "date"],
  ["Product Name", "text"],
  ["Currency", "text"],
  ["Minimum Age", "number"],
  ["Maximum Age At Maturity", "number"],
  ["Minimum Employment Tenure Months", "number"],
  ["Minimum Verified Net Income", "number"],
  ["Maximum Preliminary DSR", "number"],
  ["Minimum Net Disposable Income", "number"],
  ["Minimum Loan Amount", "number"],
  ["Maximum Loan Amount", "number"],
  ["Minimum Tenure Months", "number"],
  ["Maximum Tenure Months", "number"],
  ["Variable Income Recognition Percent", "number"],
  ["Minimum Auto LMS Score", "number"],
  ["Manual Review Score", "number"],
  ["Required Documents", "text"],
  ["Optional Documents", "text"],
  ["Policy Notes", "text"],
] as const;

function CreditPolicyManagement({ user }: { user?: CrmUser }) {
  const [policies, setPolicies] = useState<PolicyRecord[]>([]);
  const [engine, setEngine] = useState<PolicyEngineState | null>(null);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [draft, setDraft] = useState<Record<string, string>>(initialPolicy);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [pendingAction, setPendingAction] = useState<{
    key: string;
    action: "activate" | "retire";
  } | null>(null);
  const [managementApproval, setManagementApproval] = useState(
    initialManagementApproval,
  );
  const [pendingEngineState, setPendingEngineState] = useState<boolean | null>(
    null,
  );
  const canManage = user?.role === "admin";
  const load = useCallback(
    () => {
      return fetch("/api/credit-policy", { cache: "no-store" })
        .then(async (response) => {
          const result = (await response.json()) as {
            policies?: PolicyRecord[];
            engine?: PolicyEngineState;
            error?: string;
          };
          if (!response.ok)
            throw new Error(result.error || "Unable to load credit policy.");
          setPolicies(result.policies || []);
          setEngine(result.engine || null);
        })
        .catch((error) =>
          setMessage(
            error instanceof Error
              ? error.message
              : "Unable to load credit policy.",
          ),
        )
        .finally(() => setPolicyLoading(false));
    },
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("create");
    setMessage("");
    const response = await fetch("/api/credit-policy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "create", policy: draft }),
    });
    const result = (await response.json()) as { error?: string };
    if (response.ok) {
      setMessage(
        "New immutable DRAFT version created. It remains blocked until every policy field is complete and Admin explicitly activates it.",
      );
      setDraft(initialPolicy);
      await load();
    } else setMessage(result.error || "Unable to create policy version.");
    setBusy("");
  }
  async function changePolicy(
    policy: PolicyRecord,
    action: "activate" | "retire",
  ) {
    const label = `${policy["Policy Code"]}/${policy["Policy Version"]}`;
    setPendingAction(null);
    setBusy(label);
    setMessage("");
    const response = await fetch("/api/credit-policy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        policyCode: policy["Policy Code"],
        policyVersion: policy["Policy Version"],
        confirmation: action === "activate" ? "ACTIVATE" : "RETIRE",
        ...(action === "activate" ? managementApproval : {}),
      }),
    });
    const result = (await response.json()) as { error?: string };
    setMessage(
      response.ok
        ? `${label} is now ${action === "activate" ? "ACTIVE" : "RETIRED"}.`
        : result.error || "Policy action failed.",
    );
    if (response.ok) {
      setManagementApproval(initialManagementApproval);
      await load();
    }
    setBusy("");
  }
  async function changeEngine(enabled: boolean) {
    setPendingEngineState(null);
    setBusy("engine");
    setMessage("");
    const response = await fetch("/api/credit-policy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "set-engine",
        enabled,
        confirmation: enabled
          ? "ENABLE_POLICY_ENGINE"
          : "DISABLE_POLICY_ENGINE",
      }),
    });
    const result = (await response.json()) as { error?: string };
    setMessage(
      response.ok
        ? enabled
          ? "Credit Policy Engine is ON. Only the validated ACTIVE policy thresholds can govern assessment and LMS queue eligibility."
          : "Credit Policy Engine is OFF. Policy versions and thresholds are preserved, but automatic assessment use and LMS queue entry are locked."
        : result.error || "Unable to change the Credit Policy Engine.",
    );
    if (response.ok) await load();
    setBusy("");
  }
  function requestEngineChange(enabled: boolean) {
    setPendingEngineState(enabled);
    setMessage(
      enabled
        ? "Confirm enabling the Credit Policy Engine. The approved ACTIVE policy thresholds will govern automatic eligibility."
        : "Confirm disabling the Credit Policy Engine. Existing policy versions remain stored, but automatic LMS queue entry will stop.",
    );
  }
  function requestPolicyChange(
    policy: PolicyRecord,
    action: "activate" | "retire",
  ) {
    const label = `${policy["Policy Code"]}/${policy["Policy Version"]}`;
    setPendingAction({ key: label, action });
    if (action === "activate")
      setManagementApproval(initialManagementApproval);
    setMessage(
      action === "activate"
        ? `Complete the management approval gate for ${label}. Activation remains blocked until the real approver, approval date and approval reference are recorded.`
        : `Confirm retirement of ${label}. No new assessment can use it after retirement.`,
    );
  }
  function copyToDraft(policy: PolicyRecord) {
    setDraft(cloneCreditPolicyDraft(policy, initialPolicy));
    setPendingAction(null);
    setManagementApproval(initialManagementApproval);
    setMessage(
      `${policy["Policy Code"]}/${policy["Policy Version"]} values loaded into a new DRAFT form. Enter a new version and effective date, then review every threshold before creating it. Nothing has been saved or activated.`,
    );
    document.querySelector(".policy-editor")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }
  const active = policies.filter((policy) => policy.Status === "ACTIVE").length;
  const engineBlockers = (engine?.reasons || []).slice(0, 4).join(", ");
  const approvalReadiness = useMemo(
    () => validateManagementApproval(managementApproval),
    [managementApproval],
  );
  const pendingPolicy = pendingAction
    ? policies.find(
        (policy) =>
          `${policy["Policy Code"]}/${policy["Policy Version"]}` ===
          pendingAction.key,
      )
    : undefined;
  return (
    <div className="content-stack">
      <SummaryStrip
        items={[
          {
            label: "Policy versions",
            value: policyLoading ? "Loading…" : policies.length,
          },
          {
            label: "Active policies",
            value: policyLoading ? "Loading…" : active,
          },
          {
            label: "Policy engine",
            value: policyLoading
              ? "Loading…"
              : engine?.operational
                ? "ON"
                : engine?.enabled
                  ? "BLOCKED"
                  : "OFF",
          },
          { label: "External LMS", value: "LOCKED" },
        ]}
      />
      <section
        className={`panel policy-engine-control ${engine?.operational ? "is-on" : "is-off"}`}
      >
        <div className="policy-engine-copy">
          <span>ADMIN-ONLY MASTER CONTROL</span>
          <h2>Credit Policy Engine</h2>
          <p>
            One switch controls use of the ACTIVE Credit Policy and all lending
            thresholds. OFF preserves every version, but locks automatic policy
            use and internal LMS Queue entry; it never creates a bypass.
          </p>
          {!policyLoading && engine && !engine.canEnable && engineBlockers && (
            <small>Enable blockers: {engineBlockers}</small>
          )}
        </div>
        <div className="policy-engine-state">
          <Chip
            tone={
              policyLoading
                ? "gray"
                : engine?.operational
                  ? "teal"
                  : engine?.enabled
                    ? "red"
                    : "amber"
            }
          >
            {policyLoading
              ? "LOADING"
              : engine?.operational
                ? "ENGINE ON"
                : engine?.enabled
                  ? "ON · BLOCKED"
                  : "ENGINE OFF"}
          </Chip>
          <span>
            {engine?.activePolicy
              ? `${engine.activePolicy.code}/${engine.activePolicy.version}`
              : "No eligible ACTIVE policy"}
          </span>
          {engine?.updatedAt && <time>Updated {displayTime(engine.updatedAt)}</time>}
          {canManage && (
            <div className="policy-engine-actions">
              {pendingEngineState !== null ? (
                <>
                  <button
                    type="button"
                    disabled={busy === "engine"}
                    onClick={() => changeEngine(pendingEngineState)}
                  >
                    {busy === "engine"
                      ? "Saving…"
                      : pendingEngineState
                        ? "Confirm Enable"
                        : "Confirm Disable"}
                  </button>
                  <button
                    type="button"
                    className="account-secondary"
                    disabled={busy === "engine"}
                    onClick={() => {
                      setPendingEngineState(null);
                      setMessage("");
                    }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={
                    policyLoading ||
                    busy === "engine" ||
                    (!engine?.enabled && !engine?.canEnable)
                  }
                  onClick={() => requestEngineChange(!engine?.enabled)}
                >
                  {engine?.enabled ? "Disable Engine" : "Enable Engine"}
                </button>
              )}
            </div>
          )}
          {!canManage && (
            <small>Regional Manager view only. Admin controls this switch.</small>
          )}
        </div>
      </section>
      {canManage && (
        <form className="panel policy-editor" onSubmit={create}>
          <div className="table-toolbar">
            <div>
              <h2>Create Credit Policy Version</h2>
              <p>
                Every version is appended. Existing versions are never
                overwritten, and SHADOW cannot be activated.
              </p>
            </div>
            <Chip tone="amber">DRAFT ONLY</Chip>
          </div>
          <div className="policy-grid">
            {policyFields.map(([field, type]) => (
              <label key={field}>
                {field}
                <input
                  required={[
                    "Policy Code",
                    "Policy Version",
                    "Effective From",
                    "Product Name",
                    "Currency",
                  ].includes(field)}
                  type={type}
                  min={type === "number" ? "0" : undefined}
                  step={type === "number" ? "any" : undefined}
                  value={draft[field] || ""}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      [field]: event.target.value,
                    }))
                  }
                />
              </label>
            ))}
          </div>
          <div className="policy-actions">
            <button disabled={busy === "create"}>
              {busy === "create" ? "Creating…" : "Create DRAFT Version"}
            </button>
          </div>
        </form>
      )}
      {canManage &&
        pendingAction?.action === "activate" &&
        pendingPolicy && (
          <section className="panel policy-approval-gate">
            <div className="table-toolbar">
              <div>
                <span>FAIL-CLOSED ACTIVATION GATE</span>
                <h2>Management Approval Record</h2>
                <p>
                  Activating {pendingAction.key} requires the real management
                  approval record. The Admin executing the action is captured
                  separately in Audit Log.
                </p>
              </div>
              <Chip tone="amber">ENGINE STAYS OFF</Chip>
            </div>
            <div className="policy-approval-grid">
              <label>
                Management Approver
                <input
                  autoComplete="off"
                  maxLength={120}
                  placeholder="Real approving person or committee"
                  value={managementApproval.approvedBy}
                  onChange={(event) =>
                    setManagementApproval((current) => ({
                      ...current,
                      approvedBy: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Approval Date
                <input
                  type="date"
                  value={managementApproval.approvalDate}
                  onChange={(event) =>
                    setManagementApproval((current) => ({
                      ...current,
                      approvalDate: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Approval Reference
                <input
                  autoComplete="off"
                  maxLength={200}
                  placeholder="Memo, committee minute or approval ID"
                  value={managementApproval.approvalReference}
                  onChange={(event) =>
                    setManagementApproval((current) => ({
                      ...current,
                      approvalReference: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <div className="policy-approval-footer">
              <small>
                No threshold is created or changed here. This records the
                authority for the exact DRAFT values already shown above.
              </small>
              <div className="policy-actions">
                <button
                  type="button"
                  className="account-secondary"
                  disabled={busy === pendingAction.key}
                  onClick={() => {
                    setPendingAction(null);
                    setManagementApproval(initialManagementApproval);
                    setMessage("");
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={
                    busy === pendingAction.key || !approvalReadiness.valid
                  }
                  onClick={() => changePolicy(pendingPolicy, "activate")}
                >
                  {busy === pendingAction.key
                    ? "Activating…"
                    : "Activate Approved Policy"}
                </button>
              </div>
            </div>
          </section>
        )}
      <section className="panel table-panel">
        <div className="table-toolbar">
          <div>
            <h2>Policy Version Control</h2>
            <p>
              Activation is fail-closed. Blank or invalid limits cannot become
              ACTIVE.
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Policy</th>
                <th>Status</th>
                <th>Effective</th>
                <th>DSR / NDI</th>
                <th>Score Bands</th>
                <th>Approval</th>
                <th>Validation</th>
                {canManage && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {policyLoading ? (
                <tr>
                  <td colSpan={canManage ? 8 : 7}>
                    <strong>Loading credit policy…</strong>
                    <span>Reading the append-only production policy table.</span>
                  </td>
                </tr>
              ) : policies.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 8 : 7}>
                    <strong>No policy versions found</strong>
                    <span>
                      Production assessment and LMS readiness remain locked.
                    </span>
                  </td>
                </tr>
              ) : policies.map((policy) => {
                const key = `${policy["Policy Code"]}/${policy["Policy Version"]}`;
                const errors = policy.activation?.errors || [];
                return (
                  <tr key={key}>
                    <td>
                      <strong>{key}</strong>
                      <span>{policy["Product Name"]}</span>
                    </td>
                    <td>
                      <Chip
                        tone={
                          policy.Status === "ACTIVE"
                            ? "teal"
                            : policy.Status === "SHADOW"
                              ? "amber"
                              : "gray"
                        }
                      >
                        {policy.Status || "DRAFT"}
                      </Chip>
                    </td>
                    <td>{policy["Effective From"] || "—"}</td>
                    <td>
                      {policy["Maximum Preliminary DSR"] || "—"}% / RM{" "}
                      {policy["Minimum Net Disposable Income"] || "—"}
                    </td>
                    <td>
                      {policy["Manual Review Score"] || "—"} →{" "}
                      {policy["Minimum Auto LMS Score"] || "—"}
                    </td>
                    <td>
                      {policy["Approved By"]
                        ? `${policy["Approved By"]} · ${policy["Approved At"]}`
                        : "Not approved"}
                    </td>
                    <td>
                      {policy.activation?.valid ? (
                        <Chip tone="teal">READY</Chip>
                      ) : (
                        <span className="policy-errors">
                          {errors.slice(0, 3).join(", ") || "Not validated"}
                          {errors.length > 3 ? ` +${errors.length - 3}` : ""}
                        </span>
                      )}
                    </td>
                    {canManage && (
                      <td>
                        <div className="account-actions">
                          {pendingAction?.key === key ? (
                            <>
                              {pendingAction.action === "activate" ? (
                                <button type="button" disabled>
                                  Approval Gate Open
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={busy === key}
                                  onClick={() =>
                                    changePolicy(policy, pendingAction.action)
                                  }
                                >
                                  Confirm Retire
                                </button>
                              )}
                              <button
                                type="button"
                                className="account-secondary"
                                disabled={busy === key}
                                onClick={() => {
                                  setPendingAction(null);
                                  setManagementApproval(
                                    initialManagementApproval,
                                  );
                                  setMessage("");
                                }}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="account-secondary"
                                disabled={Boolean(busy)}
                                onClick={() => copyToDraft(policy)}
                              >
                                Copy to new DRAFT
                              </button>
                              <button
                                type="button"
                                disabled={
                                  busy === key ||
                                  policy.Status === "ACTIVE" ||
                                  !policy.activation?.valid
                                }
                                onClick={() =>
                                  requestPolicyChange(policy, "activate")
                                }
                              >
                                Activate
                              </button>
                              <button
                                type="button"
                                className="account-secondary"
                                disabled={
                                  busy === key ||
                                  ["SHADOW", "RETIRED"].includes(
                                    policy.Status,
                                  )
                                }
                                onClick={() =>
                                  requestPolicyChange(policy, "retire")
                                }
                              >
                                Retire
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {message && (
        <div
          className={
            /failed|unable|cannot|invalid|incomplete|locked/i.test(message)
              ? "form-message error"
              : "form-message"
          }
        >
          {message}
        </div>
      )}
    </div>
  );
}

type ManagedUser = CrmUser & {
  active: boolean;
  passwordManagedInCrm: boolean;
  hasPassword: boolean;
};
type AccountDraft = {
  username: string;
  name: string;
  role: CrmUser["role"];
  branchIds: string;
  salesId: string;
  password: string;
  active: boolean;
};
const emptyAccount: AccountDraft = {
  username: "",
  name: "",
  role: "staff",
  branchIds: "",
  salesId: "",
  password: "",
  active: false,
};

function UserManagement() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [account, setAccount] = useState<AccountDraft>(emptyAccount);
  const [editing, setEditing] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const readinessSummary = accountReadinessSummary(users);
  const load = () => {
    return fetch("/api/admin/users", { cache: "no-store" })
      .then((response) => response.json())
      .then((result: { users?: ManagedUser[]; error?: string }) => {
        if (result.error) setMessage(result.error);
        else setUsers(result.users || []);
      })
      .catch(() => setMessage("Unable to load user accounts."))
      .finally(() => setUsersLoading(false));
  };
  useEffect(() => {
    void load();
  }, []);
  function beginEdit(user: ManagedUser) {
    setEditing(user.username);
    setAccount({
      username: user.username,
      name: user.name,
      role: user.role,
      branchIds: user.branchIds.join(", "),
      salesId: user.salesId || "",
      password: "",
      active: user.active,
    });
    setMessage("");
  }
  async function saveAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(editing || "create");
    setMessage("");
    const user = {
      username: account.username,
      name: account.name,
      role: account.role,
      branchIds: account.branchIds
        .split(/[,|]/)
        .map((value) => value.trim())
        .filter(Boolean),
      salesId: account.salesId,
      password: account.password || undefined,
      active: account.active,
    };
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: editing ? "update" : "create",
        username: editing || undefined,
        user,
      }),
    });
    const result = (await response.json()) as { error?: string };
    if (response.ok) {
      setMessage(
        editing
          ? `Account ${editing} updated.`
          : `Account ${account.username} created.`,
      );
      setEditing("");
      setAccount(emptyAccount);
      await load();
    } else setMessage(result.error || "Unable to save account.");
    setBusy("");
  }
  async function reset(username: string) {
    const password = passwords[username] || "";
    if (password.length < 12) {
      setMessage("New password must contain at least 12 characters.");
      return;
    }
    setBusy(username);
    setMessage("");
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "reset_password", username, password }),
    });
    const result = (await response.json()) as { error?: string };
    if (response.ok) {
      setPasswords((current) => ({ ...current, [username]: "" }));
      setMessage(
        `Password updated for ${username}. The account's active or inactive status was preserved.`,
      );
      await load();
    } else setMessage(result.error || "Password reset failed.");
    setBusy("");
  }
  async function toggle(user: ManagedUser) {
    setBusy(user.username);
    setMessage("");
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "set_active",
        username: user.username,
        active: !user.active,
      }),
    });
    const result = (await response.json()) as { error?: string };
    if (response.ok) {
      setMessage(
        `${user.username} ${user.active ? "deactivated" : "activated"}.`,
      );
      await load();
    } else setMessage(result.error || "Unable to change account status.");
    setBusy("");
  }
  return (
    <div className="content-stack">
      <SummaryStrip
        items={[
          {
            label: "Sign-in ready",
            value: usersLoading
              ? "Loading…"
              : readinessSummary.ready,
          },
          {
            label: "Ready branch managers",
            value: usersLoading
              ? "Loading…"
              : readinessSummary.readyManagers,
          },
          {
            label: "Staff not ready",
            value: usersLoading
              ? "Loading…"
              : readinessSummary.blockedStaff,
          },
          {
            label: "Ready regional managers",
            value: usersLoading
              ? "Loading…"
              : readinessSummary.readyRegionalManagers,
          },
        ]}
      />
      <form className="panel account-editor" onSubmit={saveAccount}>
        <div className="table-toolbar">
          <div>
            <h2>{editing ? "Edit User Account" : "Add User Account"}</h2>
            <p>
              Inactive accounts cannot sign in. Password changes do not
              activate an account; activation is a separate Admin action.
            </p>
          </div>
          {editing && (
            <button
              type="button"
              className="account-secondary"
              onClick={() => {
                setEditing("");
                setAccount(emptyAccount);
              }}
            >
              Cancel Edit
            </button>
          )}
        </div>
        <div className="account-grid">
          <label>
            Username *
            <input
              required
              disabled={Boolean(editing)}
              value={account.username}
              onChange={(event) =>
                setAccount((current) => ({
                  ...current,
                  username: event.target.value,
                }))
              }
              placeholder="e.g. k2015"
            />
          </label>
          <label>
            Full Name *
            <input
              required
              value={account.name}
              onChange={(event) =>
                setAccount((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
          </label>
          <label>
            Role *
            <select
              value={account.role}
              onChange={(event) =>
                setAccount((current) => ({
                  ...current,
                  role: event.target.value as CrmUser["role"],
                }))
              }
            >
              <option value="staff">Staff / SA</option>
              <option value="manager">Branch Manager</option>
              <option value="regional_manager">Regional Manager</option>
              <option value="readonly">Read Only</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label>
            Branch IDs
            <input
              value={account.branchIds}
              onChange={(event) =>
                setAccount((current) => ({
                  ...current,
                  branchIds: event.target.value,
                }))
              }
              placeholder="BR001 or BR001, BR002"
            />
          </label>
          <label>
            Sales ID{account.role === "staff" ? " *" : ""}
            <input
              required={account.role === "staff"}
              value={account.salesId}
              onChange={(event) =>
                setAccount((current) => ({
                  ...current,
                  salesId: event.target.value,
                }))
              }
              placeholder="e.g. K2015"
            />
          </label>
          {!editing && (
            <label>
              Initial Password
              <input
                type="password"
                value={account.password}
                onChange={(event) =>
                  setAccount((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
                placeholder="Optional; minimum 12 characters"
                autoComplete="new-password"
              />
            </label>
          )}
          <label className="account-checkbox">
            <input
              type="checkbox"
              checked={account.active}
              onChange={(event) =>
                setAccount((current) => ({
                  ...current,
                  active: event.target.checked,
                }))
              }
            />{" "}
            Active account
          </label>
          <button
            className="account-save"
            disabled={Boolean(busy)}
            type="submit"
          >
            {busy === (editing || "create")
              ? "Saving…"
              : editing
                ? "Save Changes"
                : "Create Account"}
          </button>
        </div>
      </form>
      <section className="panel table-panel">
        <div className="table-toolbar">
          <div>
            <h2>User Management</h2>
            <p>Passwords use secure one-way hashes and are never displayed.</p>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Status</th>
                <th>Role</th>
                <th>Branch</th>
                <th>Sales ID</th>
                <th>Account Readiness</th>
                <th>New Password</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {usersLoading ? (
                <tr>
                  <td colSpan={8}>
                    <strong>Loading user accounts…</strong>
                    <span>Reading the protected production account store.</span>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <strong>No user accounts found</strong>
                    <span>No account record is available to administer.</span>
                  </td>
                </tr>
              ) : users.map((user) => {
                const readiness = accountReadiness(user);
                return (
                <tr key={user.username}>
                  <td>
                    <strong>{user.name}</strong>
                    <span>{user.username}</span>
                  </td>
                  <td>
                    <Chip tone={user.active ? "teal" : "gray"}>
                      {user.active ? "Active" : "Inactive"}
                    </Chip>
                  </td>
                  <td>{user.role.replace("_", " ")}</td>
                  <td>{user.branchIds.join(", ") || "All"}</td>
                  <td>{user.salesId || "—"}</td>
                  <td>
                    <Chip
                      tone={
                        readiness.tone as
                          | "red"
                          | "amber"
                          | "teal"
                          | "blue"
                          | "gray"
                      }
                    >
                      {readiness.label}
                    </Chip>
                    <span>{readiness.detail}</span>
                  </td>
                  <td>
                    <input
                      className="password-reset-input"
                      type="password"
                      value={passwords[user.username] || ""}
                      onChange={(event) =>
                        setPasswords((current) => ({
                          ...current,
                          [user.username]: event.target.value,
                        }))
                      }
                      placeholder="Minimum 12 characters"
                      autoComplete="new-password"
                    />
                  </td>
                  <td>
                    <div className="account-actions">
                      <button
                        disabled={busy === user.username}
                        onClick={() => reset(user.username)}
                      >
                        Set Password
                      </button>
                      <button
                        className="account-secondary"
                        disabled={busy === user.username}
                        onClick={() => beginEdit(user)}
                      >
                        Edit
                      </button>
                      <button
                        className="account-secondary"
                        disabled={busy === user.username}
                        onClick={() => toggle(user)}
                      >
                        {user.active ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {message && (
          <div
            className={
              /failed|unable|must|not found|require|exists/i.test(message)
                ? "form-message error user-message"
                : "form-message user-message"
            }
          >
            {message}
          </div>
        )}
      </section>
    </div>
  );
}

export default function Home() {
  const [active, setActive] = useState<NavKey>("Dashboard");
  const [branch, setBranch] = useState("All Branches");
  const [dateRange, setDateRange] = useState<DateRange>("All Time");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [crm, setCrm] = useState<CrmResponse>({ connected: false });
  const [loading, setLoading] = useState(true);
  const [refreshError, setRefreshError] = useState("");
  const loadCrm = useCallback(() => {
    setLoading(true);
    setRefreshError("");
    fetch("/api/crm?refresh=1", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.href = "/login";
          return null;
        }
        return response.json() as Promise<CrmResponse>;
      })
      .then((result) => {
        if (result) {
          setCrm(result);
          if (!result.connected)
            setRefreshError(result.error || "Unable to refresh CRM data.");
        }
      })
      .catch(() => {
        setRefreshError("Unable to refresh CRM data.");
        setCrm((current) => ({
          connected: false,
          error: "Connection unavailable",
          user: current.user,
        }));
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(loadCrm, 0);
    const timer = window.setInterval(loadCrm, 60000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [loadCrm]);
  const allSourceLeads = useMemo(
    () => (crm.connected ? (crm.data?.Leads || []).map(mapSheetLead) : []),
    [crm.connected, crm.data?.Leads],
  );
  const datedData = useMemo<Record<string, SheetRow[]>>(
    () =>
      filterCrmDataByDate(crm.data || {}, dateRange) as Record<
        string,
        SheetRow[]
      >,
    [crm.data, dateRange],
  );
  const sourceLeads = useMemo(
    () => (crm.connected ? (datedData.Leads || []).map(mapSheetLead) : []),
    [crm.connected, datedData],
  );
  const branches = useMemo(
    () =>
      buildBranchOptions(
        allSourceLeads,
        crm.data?.Branch_Master || [],
        crm.user?.branchIds || [],
      ),
    [allSourceLeads, crm.data, crm.user?.branchIds],
  );
  const filteredLeads = useMemo(
    () =>
      branch === "All Branches"
        ? sourceLeads
        : sourceLeads.filter((lead) => lead.branch === branch),
    [branch, sourceLeads],
  );
  const dashboardLeads = useMemo(
    () => filteredLeads.filter((lead) => !isSyntheticLead(lead.raw)),
    [filteredLeads],
  );
  const searchableCustomers = useMemo(
    () =>
      buildConversationSummaries(
        allSourceLeads,
        conversationSources(crm.data || {}),
      ).map((summary) => summary.lead),
    [allSourceLeads, crm.data],
  );
  const workQueueCustomers = useMemo(() => {
    const customers = buildConversationSummaries(
      filteredLeads,
      conversationSources(datedData),
    ).map((summary) => summary.lead);
    return branch === "All Branches"
      ? customers
      : customers.filter((lead) => lead.branch === branch);
  }, [branch, datedData, filteredLeads]);
  const actionCenter = useMemo(
    () =>
      buildActionCenter({
        leads: dashboardLeads.map((lead) => lead.raw),
        data: crm.data || {},
        role: crm.user?.role || "staff",
        connected: crm.connected,
        stale: Boolean(crm.stale),
      }) as ActionCenterResult,
    [crm.connected, crm.data, crm.stale, crm.user?.role, dashboardLeads],
  );
  const existingDocuments = useMemo(() => {
    const result: Record<string, string> = {};
    if (!editingLead) return result;
    for (const row of crm.data?.Document_Received_Log || []) {
      if (row["Lead ID"] !== editingLead.id) continue;
      const type =
        row["Document Type"] ||
        row["Detected Document Type"] ||
        row["Document Label"];
      const fileName =
        row["Original File Name"] ||
        row["File Name"] ||
        row["Document Name"] ||
        "Existing document";
      if (documentSlots.some((slot) => slot.type === type))
        result[type] = fileName;
    }
    return result;
  }, [crm.data, editingLead]);
  const editingQualification = useMemo(
    () =>
      editingLead
        ? latestRow(crm.data?.Conversation_State || [], editingLead.id) || {}
        : {},
    [crm.data, editingLead],
  );
  const changeNavigation = (value: NavKey) => {
    if (value === "New Application") setEditingLead(null);
    setActive(value);
  };
  const editDraft = (lead: Lead) => {
    setEditingLead(lead);
    setSelectedLead(null);
    setActive("New Application");
  };
  const openCustomer = (lead: Lead) => {
    setSelectedLead(lead);
    setActive("Customers");
  };
  return (
    <main className="app-shell">
      <Sidebar
        active={active}
        onChange={changeNavigation}
        connected={crm.connected}
        stale={crm.stale}
        role={crm.user?.role}
      />
      <section className="workspace">
        <Topbar
          active={active}
          branch={branch}
          setBranch={setBranch}
          branches={branches}
          dateRange={dateRange}
          setDateRange={setDateRange}
          user={crm.user}
          notificationCount={actionCenter.totalActions}
          onNotifications={() => setActive("Action Center")}
          leads={searchableCustomers}
          onCustomer={openCustomer}
        />
        <div className="page-content">
          <div className="page-intro">
            <p>
              {pageDescriptions[active]}{" "}
              {loading
                ? "Refreshing Google Sheets…"
                : crm.connected
                  ? crm.stale
                    ? `Showing a stale cached snapshot of ${crm.spreadsheet}; live Google Sheets access is unavailable.`
                    : `Connected to ${crm.spreadsheet}.`
                  : `Google Sheets unavailable${crm.error ? `: ${crm.error}` : "."}`}
              {!loading && crm.dataUpdatedAt
                ? ` Last refreshed ${new Date(crm.dataUpdatedAt).toLocaleString("en-MY", {
                    timeZone: "Asia/Kuala_Lumpur",
                    hour12: true,
                  })}.`
                : ""}
              {refreshError ? ` ${refreshError}` : ""}
            </p>
            <button className="safe-mode" onClick={loadCrm} disabled={loading}>
              {loading ? "↻ REFRESHING…" : crm.connected ? "↻ REFRESH DATA" : "↻ RETRY CONNECTION"}
            </button>
          </div>
          {active === "New Application" ? (
            <ManualApplication
              key={editingLead?.id || "new"}
              user={crm.user}
              branches={branches}
              onSaved={loadCrm}
              initialLead={editingLead}
              initialQualification={editingQualification}
              existingDocuments={existingDocuments}
            />
          ) : active === "Dashboard" ? (
            <Dashboard
              filteredLeads={dashboardLeads}
              onLead={openCustomer}
              connected={crm.connected}
            />
          ) : active === "Action Center" ? (
            <ActionCenter
              result={actionCenter}
              onNavigate={changeNavigation}
            />
          ) : active === "Reports" ? (
            <ManagementReports
              leads={dashboardLeads.map((lead) => lead.raw)}
              data={datedData}
              connected={crm.connected}
              stale={crm.stale}
            />
          ) : active === "Applications" ? (
            <ApplicationsWorkspace
              leads={filteredLeads}
              data={crm.data || {}}
              onLead={openCustomer}
            />
          ) : active === "Customers" ? (
            <Customer360Workspace
              leads={filteredLeads}
              data={crm.data || {}}
              stateData={crm.data}
              initialLeadId={selectedLead?.id}
              onSelect={setSelectedLead}
              user={crm.user}
              onChanged={loadCrm}
              onEdit={editDraft}
            />
          ) : active === "Work Queue" ? (
            <WorkQueue
              leads={workQueueCustomers}
              data={datedData}
              onLead={openCustomer}
              connected={crm.connected}
            />
          ) : active === "Post-Approval" ? (
            <PostApprovalWorkspace
              leads={filteredLeads}
              data={crm.data || {}}
              onLead={openCustomer}
              user={crm.user}
              onChanged={loadCrm}
            />
          ) : active === "Follow-up Settings" &&
            ["admin", "regional_manager", "manager"].includes(crm.user?.role || "") ? (
            <FollowUpSettingsManagement user={crm.user} />
          ) : active === "Credit Policy" &&
            ["admin", "regional_manager"].includes(crm.user?.role || "") ? (
            <CreditPolicyManagement user={crm.user} />
          ) : active === "User Management" && crm.user?.role === "admin" ? (
            <UserManagement />
          ) : (
            <ModulePage
              active={active}
              filteredLeads={filteredLeads}
              onLead={openCustomer}
              connected={crm.connected}
              data={
                active === "Audit Log" ? datedData : crm.data || {}
              }
              user={crm.user}
              onChanged={loadCrm}
            />
          )}
        </div>
      </section>
    </main>
  );
}
