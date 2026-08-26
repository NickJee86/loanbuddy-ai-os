"use client";

import { useMemo } from "react";
import { buildManagementReport } from "./reporting.mjs";

type SheetRow = Record<string, string>;

function number(value: number, digits = 0) {
  return new Intl.NumberFormat("en-MY", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function money(value: number) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
    maximumFractionDigits: 0,
  }).format(value);
}

function rate(value: number) {
  return `${number(value, 1)}%`;
}

function ReportMetric({
  label,
  value,
  note,
  tone = "teal",
}: {
  label: string;
  value: string;
  note: string;
  tone?: "teal" | "blue" | "amber" | "coral";
}) {
  return (
    <article className={`report-metric report-metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function RateBar({
  label,
  value,
  note,
}: {
  label: string;
  value: number;
  note: string;
}) {
  const width = Math.min(100, Math.max(0, value));
  return (
    <div className="rate-row">
      <div>
        <strong>{label}</strong>
        <span>{note}</span>
      </div>
      <b>{rate(value)}</b>
      <div className="report-progress" aria-label={`${label} ${rate(value)}`}>
        <i style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

type PerformanceRow = {
  name: string;
  leads: number;
  qualified: number;
  documentsComplete: number;
  creditReady: number;
  conversionRate: number;
};

function PerformanceTable({
  title,
  subtitle,
  nameLabel,
  rows,
}: {
  title: string;
  subtitle: string;
  nameLabel: string;
  rows: PerformanceRow[];
}) {
  return (
    <section className="panel report-table-panel">
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <span className="report-count">{rows.length} groups</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{nameLabel}</th>
              <th>Leads</th>
              <th>Qualified</th>
              <th>Docs Complete</th>
              <th>Credit Ready</th>
              <th>Qualification %</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.name}>
                  <td>
                    <strong>{row.name}</strong>
                  </td>
                  <td>{row.leads}</td>
                  <td>{row.qualified}</td>
                  <td>{row.documentsComplete}</td>
                  <td>{row.creditReady}</td>
                  <td>{rate(row.conversionRate)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="report-empty-cell">
                  No production records are available for this report yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DistributionCard({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; count: number }>;
}) {
  const maximum = Math.max(1, ...rows.map((row) => row.count));
  return (
    <section className="panel distribution-card">
      <h2>{title}</h2>
      {rows.length ? (
        <div className="distribution-list">
          {rows.map((row) => (
            <div key={row.label}>
              <span>{row.label}</span>
              <div className="distribution-track">
                <i style={{ width: `${(row.count / maximum) * 100}%` }} />
              </div>
              <strong>{row.count}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="report-empty">No production data yet.</p>
      )}
    </section>
  );
}

export default function ManagementReports({
  leads,
  data,
  connected,
  stale,
}: {
  leads: SheetRow[];
  data: Record<string, SheetRow[]>;
  connected: boolean;
  stale?: boolean;
}) {
  const report = useMemo(
    () => buildManagementReport({ leads, data }),
    [leads, data],
  );
  const maxTrend = Math.max(
    1,
    ...report.sevenDayTrend.map((item: { count: number }) => item.count),
  );
  const health = !connected ? "OFFLINE" : stale ? "STALE" : "HEALTHY";
  const healthTone = !connected ? "coral" : stale ? "amber" : "teal";

  return (
    <div className="content-stack management-reports">
      <section className="report-status-bar">
        <div>
          <strong>Management reporting is calculated live</strong>
          <span>
            Test and UAT leads are excluded. Branch and date filters apply to
            every report below.
          </span>
        </div>
        <b className={`health-badge health-${healthTone}`}>{health}</b>
      </section>

      <div className="report-metric-grid">
        <ReportMetric
          label="Total Leads"
          value={number(report.overview.totalLeads)}
          note={`${report.overview.todayLeads} received today`}
        />
        <ReportMetric
          label="Qualified"
          value={number(report.overview.qualified)}
          note={`${rate(report.conversion.qualificationRate)} of leads`}
          tone="blue"
        />
        <ReportMetric
          label="Documents Complete"
          value={number(report.overview.documentsComplete)}
          note={`${report.overview.documentsPending} still pending`}
          tone="amber"
        />
        <ReportMetric
          label="Credit Ready"
          value={number(report.overview.creditReady)}
          note="Pre-LMS readiness only"
          tone="teal"
        />
        <ReportMetric
          label="Internal LMS Queue"
          value={number(report.overview.internalQueue)}
          note="Not an external submission"
          tone="blue"
        />
        <ReportMetric
          label="External LMS Submitted"
          value={number(report.overview.externallySubmitted)}
          note="Requires submission evidence"
          tone="amber"
        />
        <ReportMetric
          label="External Approved"
          value={number(report.overview.lmsApproved)}
          note={`${report.conversion.externalDecisionCount} final decisions`}
          tone="teal"
        />
        <ReportMetric
          label="Disbursed"
          value={number(report.overview.disbursed)}
          note="Completed customer outcomes"
          tone="coral"
        />
      </div>

      <div className="report-two-column">
        <section className="panel report-conversion-panel">
          <div className="section-heading">
            <div>
              <h2>Conversion & Approval</h2>
              <p>Production funnel performance for the selected period</p>
            </div>
          </div>
          <div className="rate-list">
            <RateBar
              label="Qualification rate"
              value={report.conversion.qualificationRate}
              note={`${report.overview.qualified} of ${report.overview.totalLeads} leads`}
            />
            <RateBar
              label="Document completion rate"
              value={report.conversion.documentCompletionRate}
              note={`${report.overview.documentsComplete} complete cases`}
            />
            <RateBar
              label="Credit-ready rate"
              value={report.conversion.creditReadyRate}
              note={`${report.overview.creditReady} Pre-LMS ready cases`}
            />
            <RateBar
              label="External LMS approval rate"
              value={report.conversion.externalApprovalRate}
              note={
                report.conversion.externalDecisionCount
                  ? `${report.overview.lmsApproved} approved from ${report.conversion.externalDecisionCount} decisions`
                  : "No official LMS decisions received"
              }
            />
          </div>
        </section>

        <section className="panel trend-panel">
          <div className="section-heading">
            <div>
              <h2>7-Day Lead Trend</h2>
              <p>New production leads by Malaysia date</p>
            </div>
          </div>
          <div className="trend-chart" aria-label="Seven day lead trend">
            {report.sevenDayTrend.map(
              (item: { key: string; label: string; count: number }) => (
                <div key={item.key}>
                  <strong>{item.count}</strong>
                  <span className="trend-bar">
                    <i
                      style={{
                        height: `${Math.max(4, (item.count / maxTrend) * 100)}%`,
                      }}
                    />
                  </span>
                  <small>{item.label}</small>
                </div>
              ),
            )}
          </div>
        </section>
      </div>

      <section className="panel report-operations-panel">
        <div className="section-heading">
          <div>
            <h2>Executive KPI & Operations</h2>
            <p>Workload, activity, AI quality and customer value</p>
          </div>
        </div>
        <div className="executive-kpi-grid">
          <div>
            <span>Active / Processing</span>
            <strong>{number(report.overview.activeProcessing)}</strong>
          </div>
          <div>
            <span>Manual Review</span>
            <strong>{number(report.overview.manualReview)}</strong>
          </div>
          <div>
            <span>Open Follow-ups</span>
            <strong>{number(report.operations.followUps)}</strong>
          </div>
          <div>
            <span>Open Escalations</span>
            <strong>{number(report.operations.escalations)}</strong>
          </div>
          <div>
            <span>Messages Today</span>
            <strong>{number(report.operations.todayMessages)}</strong>
          </div>
          <div>
            <span>Documents Today</span>
            <strong>{number(report.operations.todayDocuments)}</strong>
          </div>
          <div>
            <span>Average Lead Score</span>
            <strong>{number(report.averages.leadScore, 1)}</strong>
          </div>
          <div>
            <span>Average AI Confidence</span>
            <strong>{rate(report.averages.aiConfidence)}</strong>
          </div>
          <div>
            <span>Average Loan Request</span>
            <strong>{money(report.averages.loanAmount)}</strong>
          </div>
          <div>
            <span>Average Monthly Income</span>
            <strong>{money(report.averages.monthlyIncome)}</strong>
          </div>
          <div>
            <span>Average Processing Days</span>
            <strong>{number(report.averages.processingDays, 1)}</strong>
          </div>
          <div>
            <span>Rejected / Declined</span>
            <strong>{number(report.overview.rejected)}</strong>
          </div>
        </div>
      </section>

      <div className="report-table-grid">
        <PerformanceTable
          title="Branch Performance"
          subtitle="Ranked by credit-ready, qualified and lead volume"
          nameLabel="Branch"
          rows={report.branchPerformance}
        />
        <PerformanceTable
          title="Staff Performance"
          subtitle="Assigned SA workload and conversion"
          nameLabel="Sales ID"
          rows={report.staffPerformance}
        />
      </div>

      <PerformanceTable
        title="Lead Source Performance"
        subtitle="Source quality and conversion for the selected period"
        nameLabel="Source"
        rows={report.sourcePerformance}
      />

      <div className="distribution-grid">
        <DistributionCard
          title="Processing Route"
          rows={report.routeDistribution}
        />
        <DistributionCard title="Risk Profile" rows={report.riskDistribution} />
        <DistributionCard
          title="Follow-up Priority"
          rows={report.priorityDistribution}
        />
      </div>
    </div>
  );
}

