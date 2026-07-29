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
import { AdminPlanDetailsPanel } from "../components/organisms/AdminPlanDetailsPanel";
import { AdminRunsPanel } from "../components/organisms/AdminRunsPanel";
import {
  BulkDeletePlansModal,
  DeleteOperatorModal,
  DeletePlanModal,
  EditPlanModal,
  type EditPlanFormValues,
} from "../components/organisms/AdminModals";
import { Icon } from "../components/atoms/Icon";
import { ThemeToggle } from "../components/atoms/ThemeToggle";
import { DashboardSkeleton } from "../components/organisms/DashboardSkeleton";
import type {
  CellValue,
  FrontendRole,
  HistoryRecord,
  HistoryResponse,
  OperatorAccount,
  PlanFileRecord,
  PlanGenerationRun,
  ProductionPlan,
} from "../lib/adminTypes";

interface GenerationResult {
  success: boolean;
  planId?: string;
  plan?: ProductionPlan;
  downloadUrl?: string;
  filename?: string;
  error?: string;
  whatsappSummary?: string;
}

const PLAN_OVERVIEW_LIMIT = 15;
const starterPrompt =
  "Create a 1-week production plan for a student enrollment encoding project with 8 total hours.";

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
  const [user, setUser] = useState<{ id?: string; username: string; displayName?: string; role: FrontendRole } | null>(null);
  const [adminTab, setAdminTab] = useState<"plans" | "operators" | "runs">("plans");
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [planDetailsOpen, setPlanDetailsOpen] = useState(false);

  // Core Data States
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"dynamic" | "template">("dynamic");
  const [selectedTemplate, setSelectedTemplate] = useState("HourBased_Annotation_Production_Plan_Template.xlsx");
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [history, setHistory] = useState<HistoryResponse>({ configured: false, plans: [] });
  const [operators, setOperators] = useState<OperatorAccount[]>([]);
  const [planFiles, setPlanFiles] = useState<PlanFileRecord[]>([]);
  const [planFilesLoading, setPlanFilesLoading] = useState(false);
  const [planFilesError, setPlanFilesError] = useState("");
  const [runs, setRuns] = useState<PlanGenerationRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState("");
  const [plannerOnline, setPlannerOnline] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Admin Modal States
  const [editPlan, setEditPlan] = useState<HistoryRecord | null>(null);
  const [editValues, setEditValues] = useState<EditPlanFormValues | null>(null);
  const [editErrors, setEditErrors] = useState<Partial<Record<keyof EditPlanFormValues, string>>>({});
  const [editSaving, setEditSaving] = useState(false);
  const [editMessage, setEditMessage] = useState("");

  const [newEmail, setNewEmail] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<FrontendRole>("operator");
  const [operatorNotification, setOperatorNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const [deleteOpUser, setDeleteOpUser] = useState<OperatorAccount | null>(null);
  const [reassignTarget, setReassignTarget] = useState("");
  const [deletePlan, setDeletePlan] = useState<HistoryRecord | null>(null);
  const [deletePlanSaving, setDeletePlanSaving] = useState(false);
  const [deletePlanError, setDeletePlanError] = useState("");
  const [bulkDeletePlans, setBulkDeletePlans] = useState<HistoryRecord[]>([]);
  const [bulkDeleteSaving, setBulkDeleteSaving] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState("");

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
    const params = new URLSearchParams({ limit: String(PLAN_OVERVIEW_LIMIT) });
    if (user.role === "operator") params.set("userId", user.username);
    fetch(`/api/planner/plans?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: HistoryResponse) => {
        if (!Array.isArray(data.plans)) {
          throw new Error(data.error ?? "Failed to load plans");
        }
        setHistory(data);
        setPlannerOnline(true);
      })
      .catch(() => {
        setHistory({ configured: false, plans: [] });
        setPlannerOnline(false);
      });
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

  const fetchPlanFiles = useCallback((planId: string | null) => {
    if (!planId || user?.role !== "admin") {
      setPlanFiles([]);
      return;
    }
    setPlanFilesLoading(true);
    setPlanFilesError("");
    fetch(`/api/planner/plans/${encodeURIComponent(planId)}/files`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) throw new Error(data.error ?? "Failed to load workbook files");
        setPlanFiles(data.files ?? []);
      })
      .catch((caught) => {
        setPlanFiles([]);
        setPlanFilesError(caught instanceof Error ? caught.message : "Failed to load workbook files");
      })
      .finally(() => setPlanFilesLoading(false));
  }, [user]);

  const fetchRuns = useCallback((filters: { status?: string; modelName?: string; date?: string; planId?: string } = {}) => {
    if (user?.role !== "admin") return;
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    setRunsLoading(true);
    setRunsError("");
    fetch(`/api/planner/runs?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) throw new Error(data.error ?? "Failed to load AI runs");
        setRuns(data.runs ?? []);
      })
      .catch((caught) => setRunsError(caught instanceof Error ? caught.message : "Failed to load AI runs"))
      .finally(() => setRunsLoading(false));
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
    const adminDataTimer = window.setTimeout(() => {
      fetchRuns();
    }, 0);

    const timer = window.setInterval(checkHealth, 15_000);
    return () => {
      window.clearTimeout(adminDataTimer);
      window.clearInterval(timer);
    };
  }, [user, fetchPlans, fetchOperators, fetchRuns]);

  useEffect(() => {
    const timer = window.setTimeout(() => fetchPlanFiles(activePlanId), 0);
    return () => window.clearTimeout(timer);
  }, [activePlanId, fetchPlanFiles]);

  useEffect(() => {
    if (!planDetailsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPlanDetailsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [planDetailsOpen]);

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
    const keys = firstRow ? Object.keys(firstRow) : [];
    const semanticLabel = (semantic: string) =>
      planSheet?.columnDefinitions?.find((column) => column.semantic === semantic)?.label;

    // 1. Daily target column (e.g., "Plan no. of Posts", "Target Total Hours", "Target Images")
    const dailyTargetCol = semanticLabel("planned_output") ?? keys.find(
      (k) =>
        (/plan|target/i.test(k) || /posts|images|records|documents|units|hours/i.test(k)) &&
        !/accumulate|accumulative|annotators|per\s+annotator|per\s+person|actual|balance|status/i.test(k),
    );

    // 2. Accumulative running total column (e.g., "Target Accumulative")
    const accumCol = keys.find((k) => /accumulate|accumulative/i.test(k) && !/actual/i.test(k));

    // 3. Team size column
    const teamCol = semanticLabel("planned_staff") ??
      keys.find((k) => /annotator|team|staff|worker|resource/i.test(k));

    // 4. Per annotator column
    const perAnnotCol = semanticLabel("planned_output_per_person") ??
      keys.find((k) => /per\s+(?:annotator|person|worker)/i.test(k));
    const monthCol = semanticLabel("month") ?? "Month";

    let totalPlanned = 0;
    const monthly = new Map<string, number>();

    if (dailyTargetCol) {
      totalPlanned = rows.reduce((sum, row) => sum + numberValue(row[dailyTargetCol]), 0);
      rows.forEach((row) => {
        const month = String(row[monthCol] ?? "Unscheduled");
        monthly.set(month, (monthly.get(month) ?? 0) + numberValue(row[dailyTargetCol]));
      });
    } else if (accumCol && rows.length > 0) {
      // If only accumulative column exists, take the last row's accumulative value as totalPlanned
      const lastRow = rows[rows.length - 1];
      totalPlanned = numberValue(lastRow[accumCol]);

      // Compute monthly deltas from cumulative running totals
      let prevMonthEndAccum = 0;
      const monthGroups = new Map<string, number>();
      rows.forEach((row) => {
        const month = String(row[monthCol] ?? "Unscheduled");
        monthGroups.set(month, numberValue(row[accumCol]));
      });
      monthGroups.forEach((endAccum, month) => {
        monthly.set(month, endAccum - prevMonthEndAccum);
        prevMonthEndAccum = endAccum;
      });
    } else {
      totalPlanned = (plan?.project as { totalAssets?: number })?.totalAssets ?? 0;
    }

    const teamSize = teamCol
      ? rows.reduce((largest, row) => Math.max(largest, numberValue(row[teamCol])), 0)
      : 0;

    const chosenTargetCol = dailyTargetCol ?? accumCol ?? "Target Total Hours";
    const chosenPerAnnotCol = perAnnotCol ?? chosenTargetCol;
    const unitLabel = chosenTargetCol.replace(/target\s*|plan\s*|no\.\s*of\s*/i, "").trim().toLowerCase() || "units";

    return {
      totalPlanned,
      teamSize,
      scheduledDays: rows.length,
      monthly: [...monthly.entries()].map(([month, value]) => ({ month, value })),
      targetCol: chosenTargetCol,
      perAnnotCol: chosenPerAnnotCol,
      unitLabel,
    };
  }, [rows, plan]);

  const maxMonth = Math.max(...metrics.monthly.map((item) => item.value), 1);
  const activePlanRecord = activePlanId ? history.plans.find((item) => item.id === activePlanId) : undefined;

  const planToShow = useMemo<HistoryRecord | undefined>(() => {
    if (activePlanRecord) return activePlanRecord;
    if (result?.plan) {
      return {
        id: result.planId ?? "generated",
        whatsapp_user_id: user?.username ?? "admin",
        project_title: result.plan.project.projectName,
        summary: result.plan.summary,
        project_description: result.plan.project.projectDescription,
        total_hours_estimate: metrics.totalPlanned,
        recommended_team_size: metrics.teamSize,
        created_at: new Date().toISOString(),
        raw_plan: result.plan,
        status: "generated",
        generation_source: "admin",
        workbook_mode: mode === "template" ? "official_template" : "dynamic",
      };
    }
    return undefined;
  }, [activePlanRecord, result, user, metrics, mode]);

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
      const activePrompt = prompt.trim() || starterPrompt;
      const response = await fetch("/api/planner/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          whatsappUserId: user.username,
          projectDescription: activePrompt,
          workbookMode: mode,
          selectedTemplate,
        }),
      });
      const data = (await response.json()) as GenerationResult;
      if (!response.ok || !data.success) throw new Error(data.error ?? data.whatsappSummary ?? "Plan generation failed");
      setResult(data);
      if (data.planId) setActivePlanId(data.planId);
      setPlanDetailsOpen(true);
      fetchPlans();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to generate the plan");
    } finally {
      setLoading(false);
    }
  }

  function buildEditValues(planRecord: HistoryRecord): EditPlanFormValues {
    return {
      project_title: planRecord.project_title ?? "",
      summary: planRecord.summary ?? "",
      planning_start_date: planRecord.planning_start_date ?? "",
      planning_end_date: planRecord.planning_end_date ?? "",
      actual_start_date: planRecord.actual_start_date ?? "",
      actual_end_date: planRecord.actual_end_date ?? "",
      actual_hours: planRecord.actual_hours === null || planRecord.actual_hours === undefined ? "" : String(planRecord.actual_hours),
      requested_team_size: planRecord.requested_team_size === null || planRecord.requested_team_size === undefined ? "" : String(planRecord.requested_team_size),
    };
  }

  function validateEdit(values: EditPlanFormValues): Partial<Record<keyof EditPlanFormValues, string>> {
    const nextErrors: Partial<Record<keyof EditPlanFormValues, string>> = {};
    if (!values.project_title.trim()) nextErrors.project_title = "Project title is required.";
    if (!values.summary.trim()) nextErrors.summary = "Summary is required.";
    for (const field of ["actual_hours", "requested_team_size"] as const) {
      if (values[field] !== "" && Number(values[field]) < 0) nextErrors[field] = "Value cannot be negative.";
    }
    if (values.planning_start_date && values.planning_end_date && values.planning_end_date < values.planning_start_date) {
      nextErrors.planning_end_date = "End date cannot be earlier than start date.";
    }
    if (values.actual_start_date && values.actual_end_date && values.actual_end_date < values.actual_start_date) {
      nextErrors.actual_end_date = "End date cannot be earlier than start date.";
    }
    return nextErrors;
  }

  function editPayload(values: EditPlanFormValues) {
    const nullableDate = (value: string) => value || null;
    const nullableNumber = (value: string) => value === "" ? null : Number(value);
    return {
      project_title: values.project_title.trim(),
      summary: values.summary.trim(),
      planning_start_date: nullableDate(values.planning_start_date),
      planning_end_date: nullableDate(values.planning_end_date),
      actual_start_date: nullableDate(values.actual_start_date),
      actual_end_date: nullableDate(values.actual_end_date),
      actual_hours: nullableNumber(values.actual_hours),
      requested_team_size: nullableNumber(values.requested_team_size),
    };
  }

  async function confirmDeletePlan() {
    if (!deletePlan) return;
    setDeletePlanSaving(true);
    setDeletePlanError("");
    try {
      const res = await fetch(`/api/planner/plans?id=${encodeURIComponent(deletePlan.id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Failed to delete plan");
      if (activePlanId === deletePlan.id) {
        setActivePlanId(null);
        setResult(null);
        setPlanDetailsOpen(false);
      }
      setDeletePlan(null);
      fetchPlans();
    } catch (caught) {
      setDeletePlanError(caught instanceof Error ? caught.message : "Error deleting plan");
    } finally {
      setDeletePlanSaving(false);
    }
  }

  async function confirmBulkDeletePlans() {
    if (bulkDeletePlans.length === 0) return;
    setBulkDeleteSaving(true);
    setBulkDeleteError("");
    try {
      const deletedIds = new Set<string>();
      for (const planRecord of bulkDeletePlans) {
        const res = await fetch(`/api/planner/plans?id=${encodeURIComponent(planRecord.id)}`, { method: "DELETE" });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error ?? `Failed to delete ${planRecord.project_title}`);
        deletedIds.add(planRecord.id);
      }
      if (activePlanId && deletedIds.has(activePlanId)) {
        setActivePlanId(null);
        setPlanDetailsOpen(false);
      }
      setBulkDeletePlans([]);
      fetchPlans();
    } catch (caught) {
      setBulkDeleteError(caught instanceof Error ? caught.message : "Error deleting selected plans");
    } finally {
      setBulkDeleteSaving(false);
    }
  }

  async function handleUpdatePlan(e: React.FormEvent) {
    e.preventDefault();
    if (!editPlan || !editValues) return;
    const nextErrors = validateEdit(editValues);
    setEditErrors(nextErrors);
    setEditMessage("");
    if (Object.keys(nextErrors).length > 0) return;
    setEditSaving(true);
    try {
      const res = await fetch(`/api/planner/plans?id=${encodeURIComponent(editPlan.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(editPayload(editValues)),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Failed to update plan");
      setEditMessage("Saved updates successfully.");
      fetchPlans();
      if (activePlanId === editPlan.id) setActivePlanId(editPlan.id);
      window.setTimeout(() => setEditPlan(null), 700);
    } catch (caught) {
      alert(caught instanceof Error ? caught.message : "Error saving plan edit");
      setEditMessage(caught instanceof Error ? caught.message : "Error updating plan");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleCreateOperator(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail.trim() || !newUsername.trim() || !newPassword.trim()) return;

    const invitedEmail = newEmail.trim();
    const invitedName = newUsername.trim();

    try {
      const res = await fetch("/api/planner/operators", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: newEmail, username: newUsername, password: newPassword, role: newRole }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Failed to create operator");

      setNewEmail("");
      setNewUsername("");
      setNewPassword("");
      setNewRole("operator");
      fetchOperators();

      setOperatorNotification({
        type: "success",
        message: `Invitation link sent to ${invitedEmail} for user account "${invitedName}". Account status set to Pending.`,
      });
    } catch (caught) {
      const errMsg = caught instanceof Error ? caught.message : "Error creating user";
      setOperatorNotification({ type: "error", message: errMsg });
    }
  }

  async function handleUpdateOperator(op: OperatorAccount, updates: { role?: FrontendRole; active?: boolean }) {
    if (!user) return;
    if (op.username === user.username || op.id === user.id) {
      alert("You cannot change access for your own active admin account.");
      return;
    }
    try {
      const res = await fetch(`/api/planner/operators?id=${encodeURIComponent(op.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Failed to update user");
      fetchOperators();
    } catch (caught) {
      alert(caught instanceof Error ? caught.message : "Error updating user");
    }
  }

  async function handleDeleteOperator() {
    if (!deleteOpUser) return;
    if (Number(deleteOpUser.planCount ?? 0) > 0 && !reassignTarget) {
      alert("Reassign this user's plans before deleting the account.");
      return;
    }
    const deletedName = deleteOpUser.username;
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

      setOperatorNotification({
        type: "success",
        message: `User account "${deletedName}" was successfully deleted.`,
      });
    } catch (caught) {
      const errMsg = caught instanceof Error ? caught.message : "Error deleting user";
      setOperatorNotification({ type: "error", message: errMsg });
    }
  }

  async function handleDownloadPlanFile(file: PlanFileRecord) {
    if (!activePlanId) return;
    try {
      const res = await fetch(`/api/planner/plans/${encodeURIComponent(activePlanId)}/files/${encodeURIComponent(file.id)}/download`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Failed to create download link");
      window.location.href = data.signedUrl;
    } catch (caught) {
      alert(caught instanceof Error ? caught.message : "Error downloading workbook");
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
      selectedTemplate={selectedTemplate}
      setSelectedTemplate={setSelectedTemplate}
      prompt={prompt}
      setPrompt={setPrompt}
      placeholder={starterPrompt}
      loading={loading}
      error={error}
      generatePlan={generatePlan}
      activePlanId={activePlanId}
      onSelectPlan={(id, promptText) => {
        setActivePlanId(id);
        setResult(null);
        if (promptText) setPrompt(promptText);
        setPlanDetailsOpen(true);
      }}
    />
  );

  return (
    <DashboardLayout sidebarContent={sidebarContent}>
      <header className="topbar">
        <div className="topbar-title-container" title={plan?.project.projectName ?? "Production planning board"}>
          <span className="eyebrow">LIFEPLAN DASHBOARD</span>
          <h1>{plan?.project.projectName ?? "Production planning board"}</h1>
        </div>
        <div className="topbar-actions">
          <span className={`connection-pill ${history.configured ? "connected" : "pending"}`}>
            <span /> Supabase Auth {history.configured ? "linked" : "offline"}
          </span>
          <div className="topbar-user-pill">
            <span className="user-pill-label">Logged In As</span>
            <strong className="user-pill-name">{user.displayName ?? user.username}</strong>
            <span className="user-pill-role">{user.role}</span>
          </div>
          <ThemeToggle />
          <button className="download-button" type="button" onClick={logout}>
            Sign out
          </button>
          {user.role === "admin" ? (
            result && downloadUrl && (
              <a className="download-button" href={downloadUrl} download>
                <Icon name="download" /> Download Excel
              </a>
            )
          ) : (
            downloadUrl && (
              <a className="download-button" href={downloadUrl} download>
                <Icon name="download" /> Download Excel
              </a>
            )
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
                    <p>
                      {plan.summary && plan.summary.trim()
                        ? plan.summary
                        : plan.project.projectDescription ||
                          `Production plan for ${plan.project.projectName || "requested project"} scheduled from ${compactDate(plan.project.startDate)} to ${compactDate(plan.project.deadline)}.`}
                    </p>
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
                  onViewPlan={(id) => {
                    setResult(null);
                    setActivePlanId(id);
                    setPlanDetailsOpen(true);
                  }}
                  onDeletePlan={(planRecord) => {
                    setDeletePlan(planRecord);
                    setDeletePlanError("");
                  }}
                  onDeleteSelectedPlans={(planRecords) => {
                    setBulkDeletePlans(planRecords);
                    setBulkDeleteError("");
                  }}
                  onEditPlan={(planRecord) => {
                    setEditPlan(planRecord);
                    setEditValues(buildEditValues(planRecord));
                    setEditErrors({});
                    setEditMessage("");
                  }}
                />

                {planDetailsOpen && planToShow && (
                  <div className="modal-overlay" role="presentation">
                    <div className="modal-content plan-view-modal" role="dialog" aria-modal="true" aria-labelledby="plan-view-title">
                      <div className="modal-header plan-view-header">
                        <div>
                          <span className="eyebrow">PLAN PREVIEW</span>
                          <h3 id="plan-view-title" className="modal-title">{planToShow.project_title}</h3>
                          <div className="plan-view-meta" aria-label="Plan metadata">
                            <span className={`compact-badge status-${planToShow.status ?? "generated"}`}>
                              {(planToShow.status ?? "generated").replace("_", " ")}
                            </span>
                            <span>{planToShow.whatsapp_user_id}</span>
                            <span>{new Date(planToShow.created_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                          {downloadUrl && (
                            <a className="download-button" href={downloadUrl} download>
                              <Icon name="download" /> Download Excel
                            </a>
                          )}
                          <button
                            className="icon-button modal-close-button"
                            type="button"
                            onClick={() => setPlanDetailsOpen(false)}
                            aria-label="Close plan preview"
                          >
                            <Icon name="x" />
                          </button>
                        </div>
                      </div>
                      <AdminPlanDetailsPanel
                        plan={planToShow}
                        rows={rows}
                        metrics={metrics}
                        files={planFiles}
                        filesLoading={planFilesLoading}
                        filesError={planFilesError}
                        onDownloadFile={handleDownloadPlanFile}
                      />
                    </div>
                  </div>
                )}

                {editPlan && editValues && (
                  <EditPlanModal
                    values={editValues}
                    errors={editErrors}
                    message={editMessage}
                    saving={editSaving}
                    setValue={(field, value) => setEditValues((current) => current ? { ...current, [field]: value } : current)}
                    onClose={() => setEditPlan(null)}
                    onSubmit={handleUpdatePlan}
                  />
                )}

                {deletePlan && (
                  <DeletePlanModal
                    plan={deletePlan}
                    saving={deletePlanSaving}
                    error={deletePlanError}
                    onClose={() => setDeletePlan(null)}
                    onConfirm={confirmDeletePlan}
                  />
                )}

                {bulkDeletePlans.length > 0 && (
                  <BulkDeletePlansModal
                    plans={bulkDeletePlans}
                    saving={bulkDeleteSaving}
                    error={bulkDeleteError}
                    onClose={() => setBulkDeletePlans([])}
                    onConfirm={confirmBulkDeletePlans}
                  />
                )}
              </>
            ) : adminTab === "operators" ? (
              <>
                <AdminOperatorsPanel
                  operators={operators}
                  currentUser={user}
                  onDeleteOperator={(op) => setDeleteOpUser(op)}
                  onUpdateOperator={handleUpdateOperator}
                  newEmail={newEmail}
                  setNewEmail={setNewEmail}
                  newUsername={newUsername}
                  setNewUsername={setNewUsername}
                  newPassword={newPassword}
                  setNewPassword={setNewPassword}
                  newRole={newRole}
                  setNewRole={setNewRole}
                  handleCreateOperator={handleCreateOperator}
                  notification={operatorNotification}
                  onClearNotification={() => setOperatorNotification(null)}
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
            ) : (
              <AdminRunsPanel
                runs={runs}
                plans={history.plans}
                loading={runsLoading}
                error={runsError}
                onRefresh={fetchRuns}
              />
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
