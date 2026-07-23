import React, { useMemo, useState } from "react";
import type { HistoryRecord, PlanGenerationRun } from "../../lib/adminTypes";

interface AdminRunsPanelProps {
  runs: PlanGenerationRun[];
  plans: HistoryRecord[];
  loading: boolean;
  error: string;
  onRefresh: (filters: { status?: string; modelName?: string; date?: string; planId?: string }) => void;
}

function duration(ms: number | null): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return new Date(value).toLocaleString();
  return String(value);
}

export function AdminRunsPanel({ runs, plans, loading, error, onRefresh }: AdminRunsPanelProps) {
  const [status, setStatus] = useState("");
  const [modelName, setModelName] = useState("");
  const [date, setDate] = useState("");
  const [planId, setPlanId] = useState("");
  const fallbackRuns = useMemo<PlanGenerationRun[]>(
    () => plans.map((plan) => ({
      id: `fallback-${plan.id}`,
      plan_id: plan.id,
      project_title: plan.project_title,
      model_provider: "saved-plan",
      model_name: plan.workbook_mode ?? "dynamic",
      prompt_version: plan.generation_source ?? "dashboard",
      status: plan.status === "failed" ? "failed" : "completed",
      attempt_number: 1,
      duration_ms: null,
      input_tokens: null,
      output_tokens: null,
      validation_error_count: plan.status === "failed" ? 1 : 0,
      validation_errors: null,
      error_message: null,
      started_at: plan.created_at,
      completed_at: plan.created_at,
      created_at: plan.created_at,
    })),
    [plans],
  );
  const baseRuns = runs.length > 0 ? runs : fallbackRuns;
  const displayRuns = baseRuns
    .filter((run) => !status || run.status === status)
    .filter((run) => !modelName || run.model_name === modelName)
    .filter((run) => !planId || run.plan_id === planId)
    .filter((run) => !date || String(run.started_at ?? run.created_at).startsWith(date));
  const usingFallback = runs.length === 0 && fallbackRuns.length > 0;
  const modelNames = useMemo(() => [...new Set(baseRuns.map((run) => run.model_name).filter(Boolean))], [baseRuns]);
  const runSummary = useMemo(() => {
    const total = displayRuns.length;
    const completed = displayRuns.filter((run) => run.status === "completed").length;
    const failed = displayRuns.filter((run) => run.status === "failed").length;
    const durations = displayRuns.map((run) => Number(run.duration_ms || 0)).filter((value) => value > 0);
    const avgDuration = durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0;
    return {
      total,
      completed,
      failed,
      successRate: total ? Math.round((completed / total) * 100) : 0,
      avgDuration,
    };
  }, [displayRuns]);

  function applyFilters() {
    onRefresh({ status, modelName, date, planId });
  }

  return (
    <section className="schedule-card admin-plans-panel">
      <div className="card-heading">
        <div>
          <span className="eyebrow">AI GENERATION MONITORING</span>
          <h3>Plan Generation Runs</h3>
        </div>
        <button className="download-button" type="button" onClick={applyFilters}>Refresh</button>
      </div>

      <div className="admin-filter-panel">
        {usingFallback && (
          <div className="success-box">
            Showing saved plans as completed AI runs because the dedicated run-log table has no records yet.
          </div>
        )}
        <div className="admin-summary-grid">
          <div className="admin-summary-card">
            <span>Total runs</span>
            <strong>{runSummary.total.toLocaleString()}</strong>
          </div>
          <div className="admin-summary-card">
            <span>Success rate</span>
            <strong>{runSummary.total ? `${runSummary.successRate}%` : "—"}</strong>
          </div>
          <div className="admin-summary-card">
            <span>Failed runs</span>
            <strong>{runSummary.failed.toLocaleString()}</strong>
          </div>
          <div className="admin-summary-card">
            <span>Avg duration</span>
            <strong>{runSummary.avgDuration ? duration(runSummary.avgDuration) : "—"}</strong>
          </div>
        </div>
        <div className="admin-filter-grid">
          <div className="admin-filter-field">
            <label htmlFor="run-status-filter">Status</label>
            <select id="run-status-filter" className="select-atom" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter run status">
              <option value="">All statuses</option>
              {["running", "completed", "failed"].map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div className="admin-filter-field">
            <label htmlFor="run-model-filter">Model</label>
            <select id="run-model-filter" className="select-atom" value={modelName} onChange={(event) => setModelName(event.target.value)} aria-label="Filter model">
              <option value="">All models</option>
              {modelNames.map((item) => <option key={item} value={item ?? ""}>{item}</option>)}
            </select>
          </div>
          <div className="admin-filter-field">
            <label htmlFor="run-date-filter">Date</label>
            <input id="run-date-filter" className="input-atom" type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="Filter date" />
          </div>
          <div className="admin-filter-field">
            <label htmlFor="run-plan-filter">Plan</label>
            <select id="run-plan-filter" className="select-atom" value={planId} onChange={(event) => setPlanId(event.target.value)} aria-label="Filter plan">
              <option value="">All plans</option>
              {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.project_title}</option>)}
            </select>
          </div>
        </div>
      </div>

      {loading ? <p className="empty-note">Loading AI runs...</p> : error ? <div className="error-box" role="alert">{error}</div> : (
        <div className="table-scroll admin-table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Provider</th>
                <th>Model</th>
                <th>Prompt version</th>
                <th>Status</th>
                <th>Attempt</th>
                <th>Duration</th>
                <th>Input tokens</th>
                <th>Output tokens</th>
                <th>Validation errors</th>
                <th>Started</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody>
              {displayRuns.map((run) => (
                <React.Fragment key={run.id}>
                  <tr>
                    <td>{display(run.project_title)}</td>
                    <td>{display(run.model_provider)}</td>
                    <td>{display(run.model_name)}</td>
                    <td>{display(run.prompt_version)}</td>
                    <td><span className={`compact-badge status-${run.status}`}>{run.status}</span></td>
                    <td>{display(run.attempt_number)}</td>
                    <td>{duration(run.duration_ms)}</td>
                    <td>{display(run.input_tokens)}</td>
                    <td>{display(run.output_tokens)}</td>
                    <td>{display(run.validation_error_count)}</td>
                    <td>{display(run.started_at)}</td>
                    <td>{display(run.completed_at)}</td>
                  </tr>
                  {run.error_message && (
                    <tr>
                      <td colSpan={12}>
                        <details>
                          <summary>Error message</summary>
                          <p className="modal-text">{run.error_message}</p>
                        </details>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {displayRuns.length === 0 && (
                <tr><td colSpan={12} className="text-center text-muted p-4">No generation runs found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
