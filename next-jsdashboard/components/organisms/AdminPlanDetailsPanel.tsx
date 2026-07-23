import React from "react";
import { Button } from "../atoms/Button";
import { PlanTable } from "./PlanTable";
import type { HistoryRecord, PlanFileRecord, PlanRow } from "../../lib/adminTypes";

interface AdminPlanDetailsPanelProps {
  plan: HistoryRecord;
  rows: PlanRow[];
  metrics: {
    unitLabel: string;
    targetCol: string;
    perAnnotCol: string;
    totalPlanned: number;
    teamSize: number;
    scheduledDays: number;
    monthly: Array<{ month: string; value: number }>;
  };
  files: PlanFileRecord[];
  filesLoading: boolean;
  filesError: string;
  onDownloadFile: (file: PlanFileRecord) => void;
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return new Date(value).toLocaleDateString();
  }
  return String(value);
}

function editableValue(value: unknown, placeholder: string): React.ReactNode {
  const shown = display(value);
  return <span className={shown ? "editable-value-text" : "editable-value-text empty"}>{shown || placeholder}</span>;
}

function safeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  return [];
}

function fileSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function progressValue(value: number | null | undefined): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), 100);
}

export function AdminPlanDetailsPanel({
  plan,
  rows,
  metrics,
  files,
  filesLoading,
  filesError,
  onDownloadFile,
}: AdminPlanDetailsPanelProps) {
  const details: Array<[string, React.ReactNode, boolean]> = [
    ["Status", editableValue(plan.status ?? "generated", "Select status"), true],
    ["Progress", `${progressValue(plan.progress_percentage)}%`, true],
    ["Planning start", editableValue(plan.planning_start_date, "Choose planning start date"), true],
    ["Planning end", editableValue(plan.planning_end_date, "Choose planning end date"), true],
    ["Actual start", editableValue(plan.actual_start_date, "Choose actual start date"), true],
    ["Actual end", editableValue(plan.actual_end_date, "Choose actual end date"), true],
    ["Estimated hours", display(plan.total_hours_estimate) || "—", false],
    ["Actual hours", editableValue(plan.actual_hours, "Enter actual hours"), true],
    ["Requested team", editableValue(plan.requested_team_size, "Set team size"), true],
    ["Recommended team", display(plan.recommended_team_size) || "—", false],
    ["Workbook mode", display(plan.workbook_mode) || "—", false],
    ["Generation source", display(plan.generation_source) || "—", false],
    ["Created", display(plan.created_at) || "—", false],
    ["Updated", display(plan.updated_at) || "—", false],
    ["Reviewer", display(plan.reviewed_by) || "—", false],
    ["Review date", display(plan.reviewed_at) || "—", false],
  ];
  const risks = safeList(plan.key_risks).length ? safeList(plan.key_risks) : safeList(plan.raw_plan?.project?.assumptions);
  const nextSteps = safeList(plan.next_steps);
  const maxMonth = Math.max(...metrics.monthly.map((item) => item.value), 1);

  return (
    <section className="admin-detail-panel">
      <div className="card-heading">
        <div>
          <span className="eyebrow">PLAN DETAILS</span>
          <h3>{plan.project_title}</h3>
        </div>
      </div>

      <p className={`text-muted text-sm mb-4 leading-relaxed ${plan.summary ? "" : "placeholder-copy"}`}>
        {plan.summary || "Add summary"}
      </p>

      <div className="prompt-card mb-4">
        <span className="eyebrow">ORIGINAL PROMPT</span>
        <p>{plan.project_description || plan.raw_plan?.project?.projectDescription || "No prompt was recorded for this plan."}</p>
      </div>

      <div className="details-grid">
        {details.map(([label, value, editable]) => (
          <div className={`detail-item ${editable ? "editable-detail-item" : ""}`} key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      <div className="prompt-card mt-4">
        <span className="eyebrow">LATEST PROGRESS NOTE</span>
        <p>
          {plan.latest_progress_note?.trim()
            ? plan.latest_progress_note
            : "No progress note recorded yet."}
        </p>
        <p className="empty-note mt-2">
          Last progress update: {display(plan.latest_progress_updated_at) || display(plan.updated_at) || "—"}
        </p>
      </div>

      <div className="admin-summary-grid mt-6">
        <div className="admin-summary-card">
          <span>Planned {metrics.unitLabel}</span>
          <strong>{metrics.totalPlanned.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
        </div>
        <div className="admin-summary-card">
          <span>Active team</span>
          <strong>{metrics.teamSize}</strong>
        </div>
        <div className="admin-summary-card">
          <span>Scheduled days</span>
          <strong>{metrics.scheduledDays}</strong>
        </div>
        <div className="admin-summary-card">
          <span>Workbook sheets</span>
          <strong>{plan.raw_plan?.workbook?.sheets?.length ?? "—"}</strong>
        </div>
      </div>

      <article className="chart-card mt-6">
        <div className="card-heading">
          <div>
            <span className="eyebrow">CAPACITY CURVE</span>
            <h3>{metrics.unitLabel.charAt(0).toUpperCase() + metrics.unitLabel.slice(1)} by month</h3>
          </div>
          <span className="legend">
            <i /> Planned
          </span>
        </div>
        <div className="bar-chart">
          {metrics.monthly.map((item) => (
            <div className="bar-column" key={item.month}>
              <div className="bar-value">{item.value.toLocaleString()}</div>
              <div className="bar-track">
                <div style={{ height: `${Math.max((item.value / maxMonth) * 100, 3)}%` }} />
              </div>
              <span>{item.month}</span>
            </div>
          ))}
        </div>
      </article>

      {plan.rejection_reason && (
        <div className="error-box mt-4" role="alert">
          Rejection reason: {plan.rejection_reason}
        </div>
      )}

      <div className="admin-two-column mt-6">
        <div>
          <h4 className="section-subtitle">Key risks</h4>
          {risks.length ? (
            <ul className="compact-list">
              {risks.map((risk, index) => <li key={`${risk}-${index}`}>{risk}</li>)}
            </ul>
          ) : (
            <p className="empty-note">No key risks recorded.</p>
          )}
        </div>
        <div>
          <h4 className="section-subtitle">Next steps</h4>
          {nextSteps.length ? (
            <ul className="compact-list">
              {nextSteps.map((step, index) => <li key={`${step}-${index}`}>{step}</li>)}
            </ul>
          ) : (
            <p className="empty-note">No next steps recorded.</p>
          )}
        </div>
      </div>

      <div className="mt-6">
        <div className="card-heading">
          <div>
            <span className="eyebrow">WORKBOOK FILES</span>
            <h3>Saved versions</h3>
          </div>
        </div>
        {filesLoading ? (
          <p className="empty-note">Loading workbook files...</p>
        ) : filesError ? (
          <div className="error-box" role="alert">{filesError}</div>
        ) : files.length ? (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>File name</th>
                  <th>Type</th>
                  <th>Version</th>
                  <th>Size</th>
                  <th>Created</th>
                  <th>Created by</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.id}>
                    <td>{file.file_name}</td>
                    <td>{file.file_type}</td>
                    <td>v{file.version}</td>
                    <td>{fileSize(file.file_size)}</td>
                    <td>{display(file.created_at)}</td>
                    <td>{display(file.created_by)}</td>
                    <td className="text-right">
                      <Button variant="outline" type="button" onClick={() => onDownloadFile(file)}>
                        Download
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-note">No stored workbook versions were found for this plan.</p>
        )}
      </div>

      <div className="mt-6">
        <PlanTable rows={rows} metrics={metrics} />
      </div>
    </section>
  );
}
