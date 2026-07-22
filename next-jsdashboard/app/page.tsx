"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { DashboardLayout } from "../components/templates/DashboardLayout";
import { Sidebar } from "../components/organisms/Sidebar";
import { DashboardMetrics } from "../components/organisms/DashboardMetrics";
import { PlanTable } from "../components/organisms/PlanTable";
import { PlanHistory } from "../components/organisms/PlanHistory";
import { AdminPlansPanel } from "../components/organisms/AdminPlansPanel";
import { AdminOperatorsPanel } from "../components/organisms/AdminOperatorsPanel";
import { EditPlanModal, DeleteOperatorModal } from "../components/organisms/AdminModals";
import { Icon } from "../components/atoms/Icon";
import { ThemeToggle } from "../components/atoms/ThemeToggle";
import { DashboardSkeleton } from "../components/organisms/DashboardSkeleton";

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
  const [activePlanId, setActivePlanId] = useState<string | null>(null);

  // Core Data States
  const [prompt, setPrompt] = useState(starterPrompt);
  const [mode, setMode] = useState<"dynamic" | "template">("dynamic");
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [history, setHistory] = useState<HistoryResponse>({ configured: false, plans: [] });
  const [operators, setOperators] = useState<OperatorAccount[]>([]);
  const [plannerOnline, setPlannerOnline] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Admin Modal States
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

  // 2. Fetch data (Plans & Operators)
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

    const checkHealth = () =>
      fetch("/api/planner/health", { cache: "no-store" })
        .then((response) => setPlannerOnline(response.ok))
        .catch(() => setPlannerOnline(false));

    checkHealth();
    fetchPlans();
    fetchOperators();

    const timer = window.setInterval(checkHealth, 15_000);
    return () => window.clearInterval(timer);
  }, [user, fetchPlans, fetchOperators]);

  // Dynamic values
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
    const planSheet = plan?.workbook.sheets.find((s) => s.sheetName === "Production Plan");
    const firstRow = planSheet?.rows[0];
    const targetCol = firstRow
      ? Object.keys(firstRow).find((k) => k.startsWith("Target ") && !k.includes("Annotators")) ??
        "Target Total Hours"
      : "Target Total Hours";
    const perAnnotCol = firstRow
      ? Object.keys(firstRow).find((k) => k.startsWith("Target ") && k.includes("per Annotator")) ??
        "Target Total Hours per Annotator"
      : "Target Total Hours per Annotator";
    const totalPlanned = rows.reduce((sum, row) => sum + numberValue(row[targetCol]), 0);
    const teamSize = rows.reduce(
      (largest, row) => Math.max(largest, numberValue(row["Target Active Annotators"])),
      0,
    );
    const monthly = new Map<string, number>();
    rows.forEach((row) => {
      const month = String(row.Month ?? "Unscheduled");
      monthly.set(month, (monthly.get(month) ?? 0) + numberValue(row[targetCol]));
    });
    const unitLabel = targetCol === "Target Total Hours" ? "hours" : targetCol.replace("Target ", "").toLowerCase();
    return {
      totalPlanned,
      teamSize,
      scheduledDays: rows.length,
      monthly: [...monthly.entries()].map(([month, value]) => ({ month, value })),
      targetCol,
      perAnnotCol,
      unitLabel,
    };
  }, [rows, plan]);

  const maxMonth = Math.max(...metrics.monthly.map((item) => item.value), 1);

  // User actions
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
      const data = (await response.json()) as GenerationResult;
      if (!response.ok || !data.success) throw new Error(data.error ?? data.whatsappSummary ?? "Plan generation failed");
      setResult(data);
      fetchPlans();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to generate the plan");
    } finally {
      setLoading(false);
    }
  }

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
      if (reassignTarget) {
        const reassignRes = await fetch("/api/planner/operators/reassign", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fromUsername: deleteOpUser.username, toUsername: reassignTarget }),
        });
        const reassignData = await reassignRes.json();
        if (!reassignRes.ok || !reassignData.success) throw new Error(reassignData.error ?? "Plan reassignment failed");
      }

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
      <div className="flex-center h-screen bg-canvas text-ink">
        <p className="font-semibold">Loading profile...</p>
      </div>
    );
  }

  const sidebarContent = (
    <Sidebar
      user={user}
      plannerOnline={plannerOnline}
      adminTab={adminTab}
      setAdminTab={setAdminTab}
      mode={mode}
      setMode={setMode}
      prompt={prompt}
      setPrompt={setPrompt}
      loading={loading}
      error={error}
      generatePlan={generatePlan}
    />
  );

  return (
    <DashboardLayout sidebarContent={sidebarContent}>
      <header className="topbar">
        <div>
          <span className="eyebrow">LIFEPLAN DASHBOARD</span>
          <h1>{plan?.project.projectName ?? "Production planning board"}</h1>
        </div>
        <div className="topbar-actions">
          <span className={`connection-pill ${history.configured ? "connected" : "pending"}`}>
            <span /> Supabase Auth {history.configured ? "linked" : "offline"}
          </span>
          <ThemeToggle />
          <button className="download-button" type="button" onClick={logout}>
            Sign out
          </button>
          {downloadUrl && (
            <a className="download-button" href={downloadUrl} download>
              <Icon name="download" /> Download Excel
            </a>
          )}
        </div>
      </header>

      <div className="board">
        {user.role === "operator" ? (
          <>
            {loading ? (
              <DashboardSkeleton />
            ) : !plan ? (
              <section className="welcome-card">
                <div className="welcome-orbit">
                  <span />
                  <Icon name="grid" />
                </div>
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
                    <div className="date-range">
                      <Icon name="clock" /> {compactDate(plan.project.startDate)} <span>→</span>{" "}
                      {compactDate(plan.project.deadline)}
                    </div>
                  </div>
                  <div className="completion-ring">
                    <div>
                      <strong>0%</strong>
                      <span>actual</span>
                    </div>
                  </div>
                </section>

                <DashboardMetrics metrics={metrics} mode={mode} sheetsCount={plan.workbook.sheets.length} />

                <section className="content-grid">
                  <article className="chart-card">
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

                  <article className="assumptions-card">
                    <div className="card-heading">
                      <div>
                        <span className="eyebrow">MODEL NOTES</span>
                        <h3>Key assumptions</h3>
                      </div>
                    </div>
                    <ul>
                      {plan.project.assumptions.slice(0, 5).map((item, index) => (
                        <li key={`${item}-${index}`}>
                          <span>{index + 1}</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </article>
                </section>

                <PlanTable rows={rows} metrics={metrics} />
              </>
            )}

            <PlanHistory
              plans={history.plans}
              activePlanId={activePlanId}
              onSelectPlan={(id) => {
                setResult(null);
                setActivePlanId(id);
              }}
            />
          </>
        ) : (
          <>
            {adminTab === "plans" ? (
              <>
                <AdminPlansPanel
                  plans={history.plans}
                  activePlanId={activePlanId}
                  onSelectPlan={(id) => {
                    setResult(null);
                    setActivePlanId(id);
                  }}
                  onDeletePlan={handleDeletePlan}
                  onEditPlan={(id, title, summary) => {
                    setEditPlanId(id);
                    setEditTitle(title);
                    setEditSummary(summary);
                  }}
                />

                {plan && (
                  <div className="mt-8 border-t border-line pt-6">
                    <h4 className="text-primary mb-2 font-semibold">
                      Schedules Preview: {plan.project.projectName}
                    </h4>
                    <p className="text-muted text-sm mb-4 leading-relaxed">{plan.summary}</p>
                    <PlanTable rows={rows} metrics={metrics} />
                  </div>
                )}

                {editPlanId && (
                  <EditPlanModal
                    editTitle={editTitle}
                    setEditTitle={setEditTitle}
                    editSummary={editSummary}
                    setEditSummary={setEditSummary}
                    onClose={() => setEditPlanId(null)}
                    onSubmit={handleUpdatePlan}
                  />
                )}
              </>
            ) : (
              <>
                <AdminOperatorsPanel
                  operators={operators}
                  currentUser={user}
                  onDeleteOperator={(op) => setDeleteOpUser(op)}
                  newUsername={newUsername}
                  setNewUsername={setNewUsername}
                  newPassword={newPassword}
                  setNewPassword={setNewPassword}
                  newRole={newRole}
                  setNewRole={setNewRole}
                  handleCreateOperator={handleCreateOperator}
                />

                {deleteOpUser && (
                  <DeleteOperatorModal
                    operatorName={deleteOpUser.username}
                    operators={operators}
                    reassignTarget={reassignTarget}
                    setReassignTarget={setReassignTarget}
                    onClose={() => {
                      setDeleteOpUser(null);
                      setReassignTarget("");
                    }}
                    onConfirm={handleDeleteOperator}
                  />
                )}
              </>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
