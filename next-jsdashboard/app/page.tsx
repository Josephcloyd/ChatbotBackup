"use client";

import { useEffect, useMemo, useState } from "react";

type CellValue = string | number | boolean | null;
type PlanRow = Record<string, CellValue>;

interface ProductionPlan {
  project: {
    projectName: string;
    projectDescription: string;
    client: string;
    startDate: string;
    deadline: string;
    assumptions: string[];
  };
  workbook: { sheets: Array<{ sheetName: string; rows: PlanRow[] }> };
  summary: string;
}

interface GenerationResult {
  success: boolean;
  plan?: ProductionPlan;
  downloadUrl?: string;
  filename?: string;
  error?: string;
  whatsappSummary?: string;
}

interface HistoryRecord {
  id?: string;
  project_title: string;
  summary: string;
  total_hours_estimate: number;
  recommended_team_size: number;
  created_at?: string;
  raw_plan: ProductionPlan;
}

interface HistoryResponse {
  configured: boolean;
  plans: HistoryRecord[];
  error?: string;
}

const starterPrompt = "Create a production plan for a class of 4 annotators over 4 calendar months with 400 total hours, starting today.";

function Icon({ name }: { name: "spark" | "grid" | "clock" | "team" | "hours" | "download" }) {
  const paths = {
    spark: <path d="m12 3 1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8L12 3Zm6 11 .8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14Z" />,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    team: <><path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 20v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    hours: <><path d="M4 19V9M10 19V5M16 19v-7M22 19V3" /><path d="M2 19h22" /></>,
    download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M5 20h14" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function numberValue(value: CellValue | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactDate(value: string | undefined): string {
  if (!value) return "â€”";
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export default function Dashboard() {
  const [prompt, setPrompt] = useState(starterPrompt);
  const [userId, setUserId] = useState("dashboard-user");
  const [mode, setMode] = useState<"dynamic" | "template">("dynamic");
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [history, setHistory] = useState<HistoryResponse>({ configured: false, plans: [] });
  const [plannerOnline, setPlannerOnline] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const checkHealth = () => fetch("/api/planner/health", { cache: "no-store" })
        .then((response) => setPlannerOnline(response.ok))
        .catch(() => setPlannerOnline(false));
    void Promise.all([
      checkHealth(),
      fetch("/api/planner/plans", { cache: "no-store" })
        .then((response) => response.json())
        .then((data: HistoryResponse) => {
          setHistory(data);
          setPlannerOnline(true);
        })
        .catch(() => setHistory({ configured: false, plans: [] })),
    ]);
    const healthTimer = window.setInterval(() => void checkHealth(), 15_000);
    return () => window.clearInterval(healthTimer);
  }, []);

  const plan = result?.plan;
  const rows = useMemo(
    () => plan?.workbook.sheets.find((sheet) => sheet.sheetName === "Production Plan")?.rows ?? [],
    [plan],
  );
  const metrics = useMemo(() => {
    const totalHours = rows.reduce((sum, row) => sum + numberValue(row["Target Total Hours"]), 0);
    const teamSize = rows.reduce((largest, row) => Math.max(largest, numberValue(row["Target Active Annotators"])), 0);
    const monthly = new Map<string, number>();
    rows.forEach((row) => {
      const month = String(row.Month ?? "Unscheduled");
      monthly.set(month, (monthly.get(month) ?? 0) + numberValue(row["Target Total Hours"]));
    });
    return {
      totalHours,
      teamSize,
      scheduledDays: rows.length,
      monthly: [...monthly.entries()].map(([month, hours]) => ({ month, hours })),
    };
  }, [rows]);
  const maxMonth = Math.max(...metrics.monthly.map((item) => item.hours), 1);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  async function generatePlan() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/planner/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ whatsappUserId: userId, projectDescription: prompt, workbookMode: mode }),
      });
      const data = await response.json() as GenerationResult;
      if (!response.ok || !data.success) throw new Error(data.error ?? data.whatsappSummary ?? "Plan generation failed");
      setResult(data);
      const historyResponse = await fetch(`/api/planner/plans?userId=${encodeURIComponent(userId)}`, { cache: "no-store" });
      if (historyResponse.ok) setHistory(await historyResponse.json() as HistoryResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to generate the plan");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="control-panel">
        <div className="brand">
          <span className="brand-mark"><Icon name="spark" /></span>
          <div><strong>Flowboard</strong><span>Production intelligence</span></div>
        </div>

        <div className="model-card">
          <div className="model-topline">
            <span className={`status-dot ${plannerOnline ? "online" : "offline"}`} />
            <span>Ollama planner</span>
            <small>{plannerOnline ? "Online" : "Offline"}</small>
          </div>
          <div className="model-name">qwen3:4b <span>LOCAL</span></div>
        </div>

        <div className="panel-section">
          <label>Workbook mode</label>
          <div className="mode-switch" role="group" aria-label="Workbook mode">
            <button className={mode === "dynamic" ? "active" : ""} onClick={() => setMode("dynamic")}>Dynamic</button>
            <button className={mode === "template" ? "active" : ""} onClick={() => setMode("template")}>Template</button>
          </div>
          <p className="field-help">{mode === "dynamic" ? "Build a polished workbook from scratch." : "Fill the official workbook structure."}</p>
        </div>

        <div className="panel-section grow">
          <label htmlFor="prompt">Describe your production plan</label>
          <textarea id="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          <div className="prompt-meta"><span>Natural language</span><span>{prompt.length} characters</span></div>
        </div>

        <div className="panel-section">
          <label htmlFor="userId">Workspace ID</label>
          <input id="userId" value={userId} onChange={(event) => setUserId(event.target.value)} />
        </div>

        {error && <div className="error-box" role="alert">{error}</div>}
        <button className="generate-button" onClick={generatePlan} disabled={loading || prompt.trim().length < 10 || !userId.trim()}>
          {loading ? <><span className="spinner" /> Building your planâ€¦</> : <><Icon name="spark" /> Generate visualization</>}
        </button>
        <p className="privacy-note">Runs through your local Ollama model. Supabase stores plan history only when configured.</p>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">LIVE WORKSPACE</span>
            <h1>{plan?.project.projectName ?? "Production planning board"}</h1>
          </div>
          <div className="topbar-actions">
            <span className={`connection-pill ${history.configured ? "connected" : "pending"}`}>
              <span /> Supabase {history.configured ? "connected" : "not configured"}
            </span>
            <button className="download-button" type="button" onClick={logout}>Sign out</button>
            {result?.downloadUrl && <a className="download-button" href={result.downloadUrl}><Icon name="download" /> Download Excel</a>}
          </div>
        </header>

        <div className="board">
          {!plan ? (
            <section className="welcome-card">
              <div className="welcome-orbit"><span /><Icon name="grid" /></div>
              <span className="eyebrow">READY TO MODEL</span>
              <h2>Turn a request into an operational plan.</h2>
              <p>Describe the people, period, hours, and workstreams on the left. Your schedule, workload, and Excel workbook will take shape here.</p>
              <div className="example-chips"><span>4 calendar months</span><span>400 total hours</span><span>4 annotators</span></div>
            </section>
          ) : (
            <>
              <section className="summary-strip">
                <div className="project-summary">
                  <span className="eyebrow">PLAN OVERVIEW</span>
                  <p>{plan.summary}</p>
                  <div className="date-range"><Icon name="clock" /> {compactDate(plan.project.startDate)} <span>â†’</span> {compactDate(plan.project.deadline)}</div>
                </div>
                <div className="completion-ring"><div><strong>0%</strong><span>actual</span></div></div>
              </section>

              <section className="kpi-grid">
                <article><span className="kpi-icon blue"><Icon name="hours" /></span><div><small>Planned hours</small><strong>{metrics.totalHours.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong><em>allocated exactly</em></div></article>
                <article><span className="kpi-icon green"><Icon name="team" /></span><div><small>Active team</small><strong>{metrics.teamSize}</strong><em>maximum scheduled</em></div></article>
                <article><span className="kpi-icon amber"><Icon name="clock" /></span><div><small>Scheduled days</small><strong>{metrics.scheduledDays}</strong><em>{mode === "dynamic" ? "generated dynamically" : "from template"}</em></div></article>
                <article><span className="kpi-icon violet"><Icon name="grid" /></span><div><small>Workbook mode</small><strong className="word-value">{mode}</strong><em>{plan.workbook.sheets.length} plan sheet</em></div></article>
              </section>

              <section className="content-grid">
                <article className="chart-card">
                  <div className="card-heading"><div><span className="eyebrow">CAPACITY CURVE</span><h3>Hours by month</h3></div><span className="legend"><i /> Planned</span></div>
                  <div className="bar-chart">
                    {metrics.monthly.map((item) => (
                      <div className="bar-column" key={item.month}>
                        <div className="bar-value">{item.hours.toFixed(1)}</div>
                        <div className="bar-track"><div style={{ height: `${Math.max((item.hours / maxMonth) * 100, 3)}%` }} /></div>
                        <span>{item.month}</span>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="assumptions-card">
                  <div className="card-heading"><div><span className="eyebrow">MODEL NOTES</span><h3>Key assumptions</h3></div></div>
                  <ul>{plan.project.assumptions.slice(0, 5).map((item, index) => <li key={`${item}-${index}`}><span>{index + 1}</span>{item}</li>)}</ul>
                </article>
              </section>

              <section className="schedule-card">
                <div className="card-heading"><div><span className="eyebrow">SCHEDULE PREVIEW</span><h3>First production days</h3></div><span className="rows-count">{rows.length} total rows</span></div>
                <div className="table-scroll"><table><thead><tr><th>Date</th><th>Day</th><th>Team</th><th>Target hours</th><th>Per person</th><th>Status</th></tr></thead>
                  <tbody>{rows.slice(0, 7).map((row, index) => <tr key={`${String(row.Date)}-${index}`}><td>{String(row.Date)}</td><td>{String(row.Day ?? "â€”")}</td><td>{String(row["Target Active Annotators"] ?? "â€”")}</td><td>{numberValue(row["Target Total Hours"]).toFixed(2)}</td><td>{numberValue(row["Target Total Hours per Annotator"]).toFixed(2)}</td><td><span className="status-badge">{String(row.Status ?? "Not Started")}</span></td></tr>)}</tbody>
                </table></div>
              </section>
            </>
          )}

          <section className="history-card">
            <div className="card-heading"><div><span className="eyebrow">SUPABASE HISTORY</span><h3>Recent production plans</h3></div><span className={`history-state ${history.configured ? "on" : ""}`}>{history.configured ? "Live" : "Awaiting credentials"}</span></div>
            {history.plans.length ? <div className="history-list">{history.plans.slice(0, 5).map((item) => <button key={item.id} onClick={() => setResult({ success: true, plan: item.raw_plan })}><span>{item.project_title}</span><small>{item.total_hours_estimate}h Â· team {item.recommended_team_size}</small></button>)}</div> : <div className="history-empty"><span>âŒ</span><p>{history.configured ? "Generate your first saved plan." : "Add Supabase credentials to the MCP server to activate persistent history."}</p></div>}
          </section>
        </div>
      </section>
    </main>
  );
}

