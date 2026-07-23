import { useMemo } from "react";
import type { FrontendRole, HistoryRecord, OperatorAccount, PlanGenerationRun } from "../../lib/adminTypes";
import { Icon } from "../atoms/Icon";

interface PlannerHealth {
  status?: string;
  service?: string;
  dependencies?: {
    template?: { available?: boolean; requiredFor?: string };
    ollama?: { configured?: boolean; baseUrl?: string; model?: string; reachability?: string };
    supabase?: { configured?: boolean; required?: boolean };
  };
}

interface AdminOverviewPanelProps {
  plans: HistoryRecord[];
  runs: PlanGenerationRun[];
  operators: OperatorAccount[];
  plannerOnline: boolean;
  health: PlannerHealth | null;
  currentUser: { username: string; role: FrontendRole };
  onRefresh: () => void;
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "No timestamp";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function planStatus(plan: HistoryRecord): string {
  return plan.status ?? "generated";
}

export function AdminOverviewPanel({
  plans,
  runs,
  operators,
  plannerOnline,
  health,
  currentUser,
  onRefresh,
}: AdminOverviewPanelProps) {
  const overview = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const generatedThisWeek = plans.filter((plan) => new Date(plan.created_at).getTime() >= sevenDaysAgo).length;
    const totalHours = plans.reduce((sum, plan) => sum + Number(plan.total_hours_estimate || 0), 0);
    const totalAssets = plans.reduce((sum, plan) => {
      const project = plan.raw_plan?.project as { totalAssets?: number } | undefined;
      return sum + Number(project?.totalAssets || 0);
    }, 0);
    const teamValues = plans.map((plan) => Number(plan.recommended_team_size || 0)).filter((value) => value > 0);
    const averageTeam = teamValues.length ? teamValues.reduce((sum, value) => sum + value, 0) / teamValues.length : 0;
    const activeOperators = operators.filter((operator) => operator.active !== false).length;
    const failedRuns = runs.filter((run) => run.status === "failed").length;
    const validationIssues = runs.reduce((sum, run) => sum + Number(run.validation_error_count || 0), 0);

    return {
      generatedThisWeek,
      totalHours,
      totalAssets,
      averageTeam,
      activeOperators,
      failedRuns,
      validationIssues,
      needsReview: plans.filter((plan) => planStatus(plan) === "generated").length,
    };
  }, [operators, plans, runs]);

  const pipeline = useMemo(() => {
    const statuses = ["generating", "generated", "failed", "archived"];
    const counts = new Map<string, number>();
    plans.forEach((plan) => counts.set(planStatus(plan), (counts.get(planStatus(plan)) ?? 0) + 1));
    return statuses.map((status) => ({ status, count: counts.get(status) ?? 0 }));
  }, [plans]);

  const activities = useMemo(() => {
    const planEvents = plans.map((plan) => ({
      id: `plan-${plan.id}`,
      time: plan.created_at,
      label: "Plan saved",
      title: plan.project_title,
      detail: `${plan.whatsapp_user_id} • ${planStatus(plan).replace("_", " ")}`,
      tone: planStatus(plan),
    }));
    const runEvents = runs.map((run) => ({
      id: `run-${run.id}`,
      time: run.completed_at ?? run.started_at ?? run.created_at,
      label: run.status === "failed" ? "Generation failed" : "AI run logged",
      title: run.project_title ?? "Untitled run",
      detail: `${run.model_name ?? "model unknown"} • ${run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : "duration pending"}`,
      tone: run.status,
    }));
    return [...planEvents, ...runEvents]
      .sort((left, right) => new Date(right.time ?? 0).getTime() - new Date(left.time ?? 0).getTime())
      .slice(0, 8);
  }, [plans, runs]);

  const healthItems = [
    { label: "MCP server", value: plannerOnline ? "Online" : "Offline", ok: plannerOnline },
    { label: "Ollama", value: health?.dependencies?.ollama?.model ?? "Checked during generation", ok: health?.dependencies?.ollama?.configured !== false && plannerOnline },
    { label: "Supabase", value: health?.dependencies?.supabase?.configured ? "Configured" : "Offline mode", ok: Boolean(health?.dependencies?.supabase?.configured) },
    { label: "Template files", value: health?.dependencies?.template?.available ? "Available" : "Missing", ok: health?.dependencies?.template?.available !== false },
    { label: "Admin session", value: currentUser.username, ok: currentUser.role === "admin" },
  ];

  const metricCards = [
    ["Plans this week", overview.generatedThisWeek],
    ["Planned hours", formatNumber(overview.totalHours)],
    ["Planned units", overview.totalAssets ? formatNumber(overview.totalAssets) : "—"],
    ["Avg team size", overview.averageTeam ? formatNumber(overview.averageTeam) : "—"],
    ["Active operators", overview.activeOperators],
    ["Needs review", overview.needsReview],
  ];

  return (
    <section className="admin-overview-stack">
      <section className="schedule-card admin-plans-panel">
        <div className="card-heading">
          <div>
            <span className="eyebrow">OPERATIONS SNAPSHOT</span>
            <h3>Dashboard Command Center</h3>
          </div>
          <button className="download-button" type="button" onClick={onRefresh}>
            <Icon name="clock" /> Refresh data
          </button>
        </div>

        <div className="admin-summary-grid admin-summary-grid-six">
          {metricCards.map(([label, value]) => (
            <div className="admin-summary-card" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="admin-insight-grid">
        <article className="schedule-card admin-insight-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">GENERATION HEALTH</span>
              <h3>Service checks</h3>
            </div>
          </div>
          <div className="health-list">
            {healthItems.map((item) => (
              <div className="health-row" key={item.label}>
                <span className={item.ok ? "health-dot ok" : "health-dot warn"} />
                <div>
                  <strong>{item.label}</strong>
                  <small>{item.value}</small>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="schedule-card admin-insight-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">PLAN STATUS PIPELINE</span>
              <h3>Current queue</h3>
            </div>
          </div>
          <div className="pipeline-list">
            {pipeline.map((item) => (
              <div className="pipeline-row" key={item.status}>
                <span className={`compact-badge status-${item.status}`}>{item.status.replace("_", " ")}</span>
                <div className="pipeline-track">
                  <div style={{ width: `${plans.length ? Math.max((item.count / plans.length) * 100, item.count ? 8 : 0) : 0}%` }} />
                </div>
                <strong>{item.count}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="schedule-card admin-insight-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">VALIDATION WATCH</span>
              <h3>Quality signals</h3>
            </div>
          </div>
          <div className="watch-list">
            <div>
              <span>Failed runs</span>
              <strong>{overview.failedRuns}</strong>
            </div>
            <div>
              <span>Validation issues</span>
              <strong>{overview.validationIssues}</strong>
            </div>
            <div>
              <span>Run-log coverage</span>
              <strong>{plans.length ? `${Math.round((runs.length / plans.length) * 100)}%` : "—"}</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="schedule-card admin-plans-panel">
        <div className="card-heading">
          <div>
            <span className="eyebrow">RECENT ACTIVITY</span>
            <h3>Latest admin timeline</h3>
          </div>
          <span className="rows-count">{activities.length} events</span>
        </div>
        <div className="activity-feed">
          {activities.map((activity) => (
            <div className="activity-row" key={activity.id}>
              <span className={`activity-marker status-${activity.tone}`} />
              <div>
                <strong>{activity.label}</strong>
                <p>{activity.title}</p>
                <small>{activity.detail}</small>
              </div>
              <time>{formatDateTime(activity.time)}</time>
            </div>
          ))}
          {activities.length === 0 && <p className="empty-note">No activity has been recorded yet.</p>}
        </div>
      </section>
    </section>
  );
}
