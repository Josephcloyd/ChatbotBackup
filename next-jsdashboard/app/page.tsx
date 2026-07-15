"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";


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
  id: string;
  whatsapp_user_id: string;
  project_title: string;
  summary: string;
  total_hours_estimate: number;
  recommended_team_size: number;
  created_at: string;
  raw_plan: ProductionPlan;
}

interface HistoryResponse {
  configured: boolean;
  plans: HistoryRecord[];
  error?: string;
}

interface OperatorAccount {
  id: string;
  username: string;
  role: "admin" | "operator";
  createdAt: string;
}

const starterPrompt = "Create a production plan for a class of 4 annotators over 4 calendar months with 400 total hours, starting today.";

function Icon({ name }: { name: "spark" | "grid" | "clock" | "team" | "hours" | "download" | "trash" | "edit" | "users" }) {
  const paths = {
    spark: <path d="m12 3 1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8L12 3Zm6 11 .8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14Z" />,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    team: <><path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 20v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    hours: <><path d="M4 19V9M10 19V5M16 19v-7M22 19V3" /><path d="M2 19h22" /></>,
    download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M5 20h14" /></>,
    trash: <><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" /></>,
    edit: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></>,
    users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: "16px", height: "16px", display: "inline-block", verticalAlign: "middle" }}>{paths[name]}</svg>;
}

function numberValue(value: CellValue | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactDate(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export default function Dashboard() {
  const router = useRouter();

  // Session & UI States
  const [user, setUser] = useState<{ username: string; role: "admin" | "operator" } | null>(null);
  const [adminTab, setAdminTab] = useState<"plans" | "operators">("plans");
  const [activePlanId, setActivePlanId] = useState<string | null>(null); // For admin visual preview

  // Core Data States
  const [prompt, setPrompt] = useState(starterPrompt);
  const [mode, setMode] = useState<"dynamic" | "template">("dynamic");
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [history, setHistory] = useState<HistoryResponse>({ configured: false, plans: [] });
  const [operators, setOperators] = useState<OperatorAccount[]>([]);
  const [plannerOnline, setPlannerOnline] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Admin Modal / Interactive State
  const [editPlanId, setEditPlanId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editSummary, setEditSummary] = useState("");

  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "operator">("operator");

  const [deleteOpUser, setDeleteOpUser] = useState<OperatorAccount | null>(null);
  const [reassignTarget, setReassignTarget] = useState("");

  // 1. Fetch user authentication profile on mount
  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => {
        if (!res.ok) throw new Error("Unauthorized");
        return res.json();
      })
      .then((data) => {
        setUser(data.user);
      })
      .catch(() => {
        router.push("/login");
      });
  }, [router]);

  // 2. Fetch data (Plans & Operators) once user context is loaded
  const fetchPlans = useCallback(() => {
    if (!user) return;
    const filterQuery = user.role === "operator" ? `?userId=${encodeURIComponent(user.username)}` : "";
    fetch(`/api/planner/plans${filterQuery}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: HistoryResponse) => {
        setHistory(data);
        setPlannerOnline(true);
      })
      .catch(() => setHistory({ configured: false, plans: [] }));
  }, [user]);

  const fetchOperators = useCallback(() => {
    if (user?.role !== "admin") return;
    fetch("/api/planner/operators", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setOperators(data.operators);
        }
      })
      .catch(() => setOperators([]));
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const checkHealth = () => fetch("/api/planner/health", { cache: "no-store" })
      .then((response) => setPlannerOnline(response.ok))
      .catch(() => setPlannerOnline(false));

    checkHealth();
    fetchPlans();
    fetchOperators();

    const timer = window.setInterval(checkHealth, 15_000);
    return () => window.clearInterval(timer);
  }, [user, fetchPlans, fetchOperators]);

  // Dynamic values parsed from active plan view
  const plan = useMemo(() => {
    if (result?.plan) return result.plan;
    if (activePlanId) {
      const found = history.plans.find((p) => p.id === activePlanId);
      if (found) return found.raw_plan;
    }
    return undefined;
  }, [result, activePlanId, history]);

  const downloadUrl = useMemo(() => {
    if (result?.downloadUrl) return result.downloadUrl;
    if (activePlanId) {
      return `/api/planner/plans?id=${encodeURIComponent(activePlanId)}&download=true`;
    }
    return undefined;
  }, [result, activePlanId]);

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

  // 3. User operations (Sign out, Generate)
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  async function generatePlan() {
    if (!user) return;
    setLoading(true);
    setError("");
    setResult(null);
    setActivePlanId(null);
    try {
      const response = await fetch("/api/planner/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ whatsappUserId: user.username, projectDescription: prompt, workbookMode: mode }),
      });
      const data = await response.json() as GenerationResult;
      if (!response.ok || !data.success) throw new Error(data.error ?? data.whatsappSummary ?? "Plan generation failed");
      setResult(data);
      fetchPlans();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to generate the plan");
    } finally {
      setLoading(false);
    }
  }

  // 4. Admin Management Handlers
  async function handleDeletePlan(planId: string) {
    if (!confirm("Are you sure you want to delete this plan?")) return;
    try {
      const res = await fetch(`/api/planner/plans?id=${encodeURIComponent(planId)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Failed to delete plan");
      if (activePlanId === planId) setActivePlanId(null);
      fetchPlans();
    } catch (caught) {
      alert(caught instanceof Error ? caught.message : "Error deleting plan");
    }
  }

  async function handleUpdatePlan(e: React.FormEvent) {
    e.preventDefault();
    if (!editPlanId) return;
    try {
      const res = await fetch(`/api/planner/plans?id=${encodeURIComponent(editPlanId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project_title: editTitle, summary: editSummary }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Failed to update plan");
      setEditPlanId(null);
      fetchPlans();
    } catch (caught) {
      alert(caught instanceof Error ? caught.message : "Error updating plan");
    }
  }

  async function handleCreateOperator(e: React.FormEvent) {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword.trim()) return;
    try {
      const res = await fetch("/api/planner/operators", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: newUsername, password: newPassword, role: newRole }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Failed to create operator");
      setNewUsername("");
      setNewPassword("");
      setNewRole("operator");
      fetchOperators();
    } catch (caught) {
      alert(caught instanceof Error ? caught.message : "Error creating user");
    }
  }

  async function handleDeleteOperator() {
    if (!deleteOpUser) return;
    try {
      // 1. If reassignment is selected, execute reassignment first
      if (reassignTarget) {
        const reassignRes = await fetch("/api/planner/operators/reassign", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fromUsername: deleteOpUser.username, toUsername: reassignTarget }),
        });
        const reassignData = await reassignRes.json();
        if (!reassignRes.ok || !reassignData.success) throw new Error(reassignData.error ?? "Plan reassignment failed");
      }

      // 2. Delete user
      const res = await fetch(`/api/planner/operators?id=${encodeURIComponent(deleteOpUser.id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Failed to delete user");

      setDeleteOpUser(null);
      setReassignTarget("");
      fetchOperators();
      fetchPlans();
    } catch (caught) {
      alert(caught instanceof Error ? caught.message : "Error deleting user");
    }
  }

  if (!user) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "100vh", background: "#f5eedb", color: "#133020" }}>
        <p style={{ fontWeight: 600 }}>Loading profile...</p>
      </div>
    );
  }

  return (
    <main className="app-shell">
      {/* ──── SIDEBAR ──── */}
      <aside className="control-panel">
        <div className="brand">
          {/* Lifewood Hexagon Diamond Logo */}
          <div style={{
            width: "18px",
            height: "26px",
            background: "#FFB347",
            clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)"
          }} />
          <div>
            <strong style={{ color: "white" }}>Lifeplan</strong>
            <span>Flowboard System</span>
          </div>
        </div>

        {/* User Card */}
        <div style={{ padding: "14px", border: "1px solid #708e7c", borderRadius: "12px", background: "rgba(255,255,255,0.03)" }}>
          <div style={{ fontSize: "11px", textTransform: "uppercase", color: "#708e7c", fontWeight: 700 }}>Logged In As</div>
          <div style={{ fontSize: "16px", color: "white", fontWeight: 700, marginTop: "4px" }}>
            {user.username} <span style={{ fontSize: "10px", padding: "2px 5px", borderRadius: "4px", background: "#046241", color: "#f5eedb" }}>{user.role}</span>
          </div>
        </div>

        {/* Model Card */}
        <div className="model-card">
          <div className="model-topline">
            <span className={`status-dot ${plannerOnline ? "online" : "offline"}`} />
            <span>Ollama planner</span>
            <small>{plannerOnline ? "Online" : "Offline"}</small>
          </div>
          <div className="model-name">qwen3:8b <span>LOCAL</span></div>
        </div>

        {user.role === "operator" ? (
          /* ───── OPERATOR VIEW CONTROL PANEL ───── */
          <>
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
              <textarea id="prompt" placeholder={prompt} onChange={(event) => setPrompt(event.target.value)} />
              <div className="prompt-meta"><span>Natural language</span><span>{prompt.length} characters</span></div>
            </div>

            {error && <div className="error-box" role="alert">{error}</div>}
            <button className="generate-button" onClick={generatePlan} disabled={loading || prompt.trim().length < 10}>
              {loading ? <><span className="spinner" /> Building your plan...</> : <><Icon name="spark" /> Generate plan</>}
            </button>
            <p className="privacy-note">Runs locally through Ollama. Data saved under your account.</p>
          </>
        ) : (
          /* ───── ADMIN VIEW CONTROL PANEL ───── */
          <div className="panel-section grow" style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "10px" }}>
            <label>Administration Panels</label>
            <button
              onClick={() => setAdminTab("plans")}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: "10px",
                border: "1px solid #708e7c",
                background: adminTab === "plans" ? "#046241" : "transparent",
                color: adminTab === "plans" ? "white" : "#a4bba8",
                fontWeight: 700,
                textAlign: "left",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "10px"
              }}
            >
              <Icon name="grid" /> Plans Overview
            </button>
            <button
              onClick={() => setAdminTab("operators")}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: "10px",
                border: "1px solid #708e7c",
                background: adminTab === "operators" ? "#046241" : "transparent",
                color: adminTab === "operators" ? "white" : "#a4bba8",
                fontWeight: 700,
                textAlign: "left",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "10px"
              }}
            >
              <Icon name="users" /> Manage Operators
            </button>
          </div>
        )}
      </aside>

      {/* ──── WORKSPACE CANVAS ──── */}
      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">FLOWBOARD DASHBOARD</span>
            <h1>{plan?.project.projectName ?? "Production planning board"}</h1>
          </div>
          <div className="topbar-actions">
            <span className={`connection-pill ${history.configured ? "connected" : "pending"}`}>
              <span /> Supabase Auth {history.configured ? "linked" : "offline"}
            </span>
            <button className="download-button" type="button" onClick={logout}>Sign out</button>
            {downloadUrl && <a className="download-button" href={downloadUrl} download><Icon name="download" /> Download Excel</a>}
          </div>
        </header>

        <div className="board">
          {user.role === "operator" ? (
            /* ───── OPERATOR VIEW MAIN WORKSPACE ───── */
            <>
              {!plan ? (
                <section className="welcome-card">
                  <div className="welcome-orbit"><span /><Icon name="grid" /></div>
                  <span className="eyebrow">READY TO MODEL</span>
                  <h2>Describe your prompt to compile a new plan.</h2>
                  <p>Input target annotators, timelines, and hour counts on the sidebar to get started.</p>
                </section>
              ) : (
                <>
                  <section className="summary-strip">
                    <div className="project-summary">
                      <span className="eyebrow">PLAN OVERVIEW</span>
                      <p>{plan.summary}</p>
                      <div className="date-range"><Icon name="clock" /> {compactDate(plan.project.startDate)} <span>→</span> {compactDate(plan.project.deadline)}</div>
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
                      <tbody>{rows.slice(0, 7).map((row, index) => <tr key={`${String(row.Date)}-${index}`}><td>{String(row.Date)}</td><td>{String(row.Day ?? "—")}</td><td>{String(row["Target Active Annotators"] ?? "—")}</td><td>{numberValue(row["Target Total Hours"]).toFixed(2)}</td><td>{numberValue(row["Target Total Hours per Annotator"]).toFixed(2)}</td><td><span className="status-badge">{String(row.Status ?? "Not Started")}</span></td></tr>)}</tbody>
                    </table></div>
                  </section>
                </>
              )}

              <section className="history-card">
                <div className="card-heading"><div><span className="eyebrow">PLAN ARCHIVE</span><h3>My generated production plans</h3></div><span className="history-state on">Operator Lock</span></div>
                {history.plans.length ? <div className="history-list">{history.plans.slice(0, 10).map((item) => <button key={item.id} onClick={() => { setResult(null); setActivePlanId(item.id); }} style={{ border: activePlanId === item.id ? "1px solid #046241" : "1px solid #e3e9ee" }}><span>{item.project_title}</span><small>{item.total_hours_estimate}h · team {item.recommended_team_size}</small></button>)}</div> : <div className="history-empty"><span>⌂</span><p>Generate your first saved plan to build history.</p></div>}
              </section>
            </>
          ) : (
            /* ───── ADMIN VIEW MAIN WORKSPACE ───── */
            <>
              {adminTab === "plans" ? (
                /* Tab 1: Plans Management */
                <section className="schedule-card" style={{ padding: "24px" }}>
                  <div className="card-heading">
                    <div>
                      <span className="eyebrow">ADMIN PLANS OVERVIEW</span>
                      <h3>All Generated Production Schedules</h3>
                    </div>
                    <span className="rows-count">{history.plans.length} total plans</span>
                  </div>

                  <div className="table-scroll" style={{ marginTop: "20px" }}>
                    <table style={{ width: "100%" }}>
                      <thead>
                        <tr>
                          <th>Title</th>
                          <th>Operator</th>
                          <th>Hours</th>
                          <th>Team Size</th>
                          <th>Created At</th>
                          <th style={{ textAlign: "right" }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.plans.map((item) => (
                          <tr key={item.id} style={{ cursor: "pointer", background: activePlanId === item.id ? "#f9f7f7" : "transparent" }} onClick={() => { setResult(null); setActivePlanId(item.id); }}>
                            <td style={{ fontWeight: 700, color: "#046241" }}>{item.project_title}</td>
                            <td>{item.whatsapp_user_id}</td>
                            <td>{item.total_hours_estimate}h</td>
                            <td>{item.recommended_team_size}</td>
                            <td>{new Date(item.created_at).toLocaleDateString()}</td>
                            <td style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => {
                                  setEditPlanId(item.id);
                                  setEditTitle(item.project_title);
                                  setEditSummary(item.summary);
                                }}
                                style={{ border: 0, background: "transparent", cursor: "pointer", color: "#046241", marginRight: "12px" }}
                                title="Edit Details"
                              >
                                <Icon name="edit" />
                              </button>
                              <button
                                onClick={() => handleDeletePlan(item.id)}
                                style={{ border: 0, background: "transparent", cursor: "pointer", color: "#b91c1c" }}
                                title="Delete Plan"
                              >
                                <Icon name="trash" />
                              </button>
                            </td>
                          </tr>
                        ))}
                        {history.plans.length === 0 && (
                          <tr>
                            <td colSpan={6} style={{ textAlign: "center", padding: "20px", color: "#666666" }}>
                              No production plans generated yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Dynamic Plan Visual preview (renders if selected) */}
                  {plan && (
                    <div style={{ marginTop: "30px", borderTop: "1px solid #d3cbb6", paddingTop: "24px" }}>
                      <h4 style={{ color: "#046241", margin: "0 0 10px", fontSize: "16px" }}>Schedules Preview: {plan.project.projectName}</h4>
                      <p style={{ color: "#666666", fontSize: "13px", lineHeight: 1.5, margin: "0 0 20px" }}>{plan.summary}</p>

                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Day</th>
                              <th>Team Size</th>
                              <th>Target Hours</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.slice(0, 5).map((row, index) => (
                              <tr key={index}>
                                <td>{String(row.Date)}</td>
                                <td>{String(row.Day)}</td>
                                <td>{String(row["Target Active Annotators"])}</td>
                                <td>{numberValue(row["Target Total Hours"]).toFixed(2)}h</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Inline edit details modal (styled inside layout) */}
                  {editPlanId && (
                    <div style={{ position: "fixed", inset: 0, zIndex: 10, background: "rgba(19,48,32,0.4)", backdropFilter: "blur(4px)", display: "grid", placeItems: "center" }}>
                      <form onSubmit={handleUpdatePlan} style={{ width: "90%", maxWidth: "500px", padding: "26px", borderRadius: "14px", background: "white", boxShadow: "0 20px 60px rgba(0,0,0,0.15)", border: "1px solid #d3cbb6" }}>
                        <h3 style={{ margin: "0 0 16px", color: "#046241" }}>Edit Plan Information</h3>

                        <div style={{ display: "grid", gap: "14px" }}>
                          <div>
                            <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#666666", marginBottom: "4px" }}>Project Title</label>
                            <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} required style={{ padding: "10px", color: "#133020", background: "#f9f7f7", border: "1px solid #d3cbb6", borderRadius: "8px" }} />
                          </div>
                          <div>
                            <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#666666", marginBottom: "4px" }}>Summary Description</label>
                            <textarea value={editSummary} onChange={(e) => setEditSummary(e.target.value)} required style={{ width: "100%", height: "100px", padding: "10px", color: "#133020", background: "#f9f7f7", border: "1px solid #d3cbb6", borderRadius: "8px", resize: "none" }} />
                          </div>
                        </div>

                        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "20px" }}>
                          <button type="button" onClick={() => setEditPlanId(null)} style={{ padding: "8px 14px", border: "1px solid #d3cbb6", borderRadius: "8px", background: "transparent", cursor: "pointer" }}>Cancel</button>
                          <button type="submit" style={{ padding: "8px 14px", border: 0, borderRadius: "8px", background: "#046241", color: "white", cursor: "pointer" }}>Save Updates</button>
                        </div>
                      </form>
                    </div>
                  )}
                </section>
              ) : (
                /* Tab 2: Operators Management */
                <section style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "20px", alignItems: "start" }}>
                  {/* Operators List */}
                  <div className="schedule-card" style={{ padding: "24px" }}>
                    <div className="card-heading">
                      <div>
                        <span className="eyebrow">OPERATOR ACCOUNTS</span>
                        <h3>System Operator Profiles</h3>
                      </div>
                    </div>

                    <div className="table-scroll" style={{ marginTop: "20px" }}>
                      <table style={{ width: "100%" }}>
                        <thead>
                          <tr>
                            <th>Username</th>
                            <th>Role</th>
                            <th>Created At</th>
                            <th style={{ textAlign: "right" }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {operators.map((op) => (
                            <tr key={op.id}>
                              <td style={{ fontWeight: 700 }}>{op.username}</td>
                              <td>
                                <span style={{ padding: "2px 6px", borderRadius: "4px", fontSize: "9px", background: op.role === "admin" ? "#fff3df" : "#e6f8ef", color: op.role === "admin" ? "#bd7a19" : "#12815b", fontWeight: 700 }}>
                                  {op.role}
                                </span>
                              </td>
                              <td>{new Date(op.createdAt).toLocaleDateString()}</td>
                              <td style={{ textAlign: "right" }}>
                                <button
                                  onClick={() => setDeleteOpUser(op)}
                                  disabled={op.username === user.username}
                                  style={{ border: 0, background: "transparent", cursor: op.username === user.username ? "not-allowed" : "pointer", color: op.username === user.username ? "#ccc" : "#b91c1c" }}
                                  title="Delete operator"
                                >
                                  <Icon name="trash" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Add Operator Form */}
                  <form onSubmit={handleCreateOperator} className="schedule-card" style={{ padding: "24px", display: "grid", gap: "16px" }}>
                    <h3 style={{ margin: 0, fontSize: "16px", color: "#046241" }}>Create Operator Profile</h3>

                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#666666", marginBottom: "4px" }}>Username</label>
                      <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} required style={{ padding: "10px", color: "#133020", background: "#f9f7f7", border: "1px solid #d3cbb6", borderRadius: "8px" }} placeholder="e.g. operator2" />
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#666666", marginBottom: "4px" }}>Password</label>
                      <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required style={{ padding: "10px", color: "#133020", background: "#f9f7f7", border: "1px solid #d3cbb6", borderRadius: "8px" }} placeholder="••••••••" />
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#666666", marginBottom: "4px" }}>Role Access</label>
                      <select value={newRole} onChange={(e) => setNewRole(e.target.value as "admin" | "operator")} style={{ width: "100%", padding: "10px", border: "1px solid #d3cbb6", borderRadius: "8px", background: "#f9f7f7", color: "#133020", outline: "none", fontSize: "13px" }}>
                        <option value="operator">Operator (Prompt Generator)</option>
                        <option value="admin">Administrator (Manager)</option>
                      </select>
                    </div>

                    <button type="submit" style={{ padding: "12px", border: 0, borderRadius: "8px", background: "#046241", color: "white", fontWeight: 700, cursor: "pointer", marginTop: "10px" }}>
                      Create User Account
                    </button>
                  </form>

                  {/* Deletion & Reassignment Modal dialog */}
                  {deleteOpUser && (
                    <div style={{ position: "fixed", inset: 0, zIndex: 10, background: "rgba(19,48,32,0.4)", backdropFilter: "blur(4px)", display: "grid", placeItems: "center" }}>
                      <div style={{ width: "90%", maxWidth: "480px", padding: "26px", borderRadius: "14px", background: "white", boxShadow: "0 20px 60px rgba(0,0,0,0.15)", border: "1px solid #d3cbb6" }}>
                        <h3 style={{ margin: "0 0 10px", color: "#b91c1c" }}>Delete User: {deleteOpUser.username}</h3>
                        <p style={{ color: "#666666", fontSize: "13px", lineHeight: 1.5, margin: "0 0 20px" }}>
                          Before deleting operator <strong>{deleteOpUser.username}</strong>, you can reassign their generated production schedules to another active operator to avoid losing historical analytics.
                        </p>

                        <div style={{ margin: "0 0 20px" }}>
                          <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#666666", marginBottom: "6px" }}>Reassign plans to:</label>
                          <select value={reassignTarget} onChange={(e) => setReassignTarget(e.target.value)} style={{ width: "100%", padding: "10px", border: "1px solid #d3cbb6", borderRadius: "8px", background: "#f9f7f7", color: "#133020", outline: "none", fontSize: "13px" }}>
                            <option value="">Do not reassign (Keep orphaned or deleted)</option>
                            {operators
                              .filter((op) => op.username !== deleteOpUser.username && op.role === "operator")
                              .map((op) => (
                                <option key={op.id} value={op.username}>{op.username}</option>
                              ))}
                          </select>
                        </div>

                        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                          <button onClick={() => { setDeleteOpUser(null); setReassignTarget(""); }} style={{ padding: "8px 14px", border: "1px solid #d3cbb6", borderRadius: "8px", background: "transparent", cursor: "pointer" }}>Cancel</button>
                          <button onClick={handleDeleteOperator} style={{ padding: "8px 14px", border: 0, borderRadius: "8px", background: "#b91c1c", color: "white", cursor: "pointer" }}>Confirm Deletion</button>
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}

