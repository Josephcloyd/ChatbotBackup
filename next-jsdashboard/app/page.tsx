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
import { AdminOverviewPanel } from "../components/organisms/AdminOverviewPanel";
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

interface ProgressFormValues {
  progress_percentage: string;
  actual_start_date: string;
  actual_end_date: string;
  actual_hours: string;
  requested_team_size: string;
  note: string;
}

interface PlannerHealth {
  status?: string;
  service?: string;
  dependencies?: {
    template?: { available?: boolean; requiredFor?: string };
    ollama?: { configured?: boolean; baseUrl?: string; model?: string; reachability?: string };
    supabase?: { configured?: boolean; required?: boolean };
  };
}

const PLAN_OVERVIEW_LIMIT = 15;
const starterPrompt =
  "Create a 1-week production plan for a student enrollment encoding project with 8 total hours.";

function numberValue(value: CellValue | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function compactDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function progressValue(value: number | null | undefined): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), 100);
}

function buildProgressValues(planRecord: HistoryRecord | undefined): ProgressFormValues {
  return {
    progress_percentage: String(progressValue(planRecord?.progress_percentage)),
    actual_start_date: planRecord?.actual_start_date ?? "",
    actual_end_date: planRecord?.actual_end_date ?? "",
    actual_hours: planRecord?.actual_hours === null || planRecord?.actual_hours === undefined ? "" : String(planRecord.actual_hours),
    requested_team_size: planRecord?.requested_team_size === null || planRecord?.requested_team_size === undefined ? "" : String(planRecord.requested_team_size),
    note: "",
  };
}

export default function Dashboard() {
  const router = useRouter();

  // Session & UI States
  const [user, setUser] = useState<{ id?: string; username: string; role: FrontendRole } | null>(null);
  const [adminTab, setAdminTab] = useState<"overview" | "plans" | "operators">("overview");
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
  const [progressPlanId, setProgressPlanId] = useState<string | null>(null);
  const [progressValues, setProgressValues] = useState<ProgressFormValues>({
    progress_percentage: "0",
    actual_start_date: "",
    actual_end_date: "",
    actual_hours: "",
    requested_team_size: "",
    note: "",
  });
  const [progressErrors, setProgressErrors] = useState<Partial<Record<keyof ProgressFormValues, string>>>({});
  const [progressSaving, setProgressSaving] = useState(false);
  const [progressMessage, setProgressMessage] = useState("");
  const [plannerOnline, setPlannerOnline] = useState(false);
  const [plannerHealth, setPlannerHealth] = useState<PlannerHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Admin Modal States
  const [editPlan, setEditPlan] = useState<HistoryRecord | null>(null);
  const [editValues, setEditValues] = useState<EditPlanFormValues | null>(null);
  const [editErrors, setEditErrors] = useState<Partial<Record<keyof EditPlanFormValues, string>>>({});
  const [editSaving, setEditSaving] = useState(false);
  const [editMessage, setEditMessage] = useState("");

  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<FrontendRole>("operator");

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
    fetch(`/api/planner/runs?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) throw new Error(data.error ?? "Failed to load AI runs");
        setRuns(data.runs ?? []);
      })
      .catch(() => setRuns([]));
  }, [user]);

  const fetchHealth = useCallback(() => {
    fetch("/api/planner/health", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({ status: "offline" }));
        setPlannerHealth(data);
        setPlannerOnline(response.ok && data.status !== "offline");
      })
      .catch(() => {
        setPlannerHealth({ status: "offline" });
        setPlannerOnline(false);
      });
  }, []);

  useEffect(() => {
    if (!user) return;

    fetchHealth();
    fetchPlans();
    fetchOperators();
    const adminDataTimer = window.setTimeout(() => {
      fetchRuns();
    }, 0);

    const timer = window.setInterval(fetchHealth, 15_000);
    return () => {
      window.clearTimeout(adminDataTimer);
      window.clearInterval(timer);
    };
  }, [user, fetchPlans, fetchOperators, fetchRuns, fetchHealth]);

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

    // 1. Daily target column (e.g., "Plan no. of Posts", "Target Total Hours", "Target Images")
    const dailyTargetCol = keys.find(
      (k) =>
        (/plan|target/i.test(k) || /posts|images|records|documents|units|hours/i.test(k)) &&
        !/accumulate|accumulative|annotators|per\s+annotator|per\s+person|actual|balance|status/i.test(k),
    );

    // 2. Accumulative running total column (e.g., "Target Accumulative")
    const accumCol = keys.find((k) => /accumulate|accumulative/i.test(k) && !/actual/i.test(k));

    // 3. Team size column
    const teamCol = keys.find((k) => /annotator|team|staff|worker|resource/i.test(k));

    // 4. Per annotator column
    const perAnnotCol = keys.find((k) => /per\s+(?:annotator|person|worker)/i.test(k));

    let totalPlanned = 0;
    const monthly = new Map<string, number>();

    if (dailyTargetCol) {
      totalPlanned = rows.reduce((sum, row) => sum + numberValue(row[dailyTargetCol]), 0);
      rows.forEach((row) => {
        const month = String(row.Month ?? "Unscheduled");
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
        const month = String(row.Month ?? "Unscheduled");
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
  const selectedProgress = progressValue(planToShow?.progress_percentage);
  const progressValuesForPlan = progressPlanId === planToShow?.id ? progressValues : buildProgressValues(planToShow);
  const progressErrorsForPlan = progressPlanId === planToShow?.id ? progressErrors : {};
  const progressMessageForPlan = progressPlanId === planToShow?.id ? progressMessage : "";

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
      fetchRuns();
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

  function validateProgress(values: ProgressFormValues): Partial<Record<keyof ProgressFormValues, string>> {
    const nextErrors: Partial<Record<keyof ProgressFormValues, string>> = {};
    const progress = Number(values.progress_percentage);
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
      nextErrors.progress_percentage = "Progress must be between 0 and 100.";
    }
    if (values.actual_hours !== "" && Number(values.actual_hours) < 0) {
      nextErrors.actual_hours = "Actual hours cannot be negative.";
    }
    const teamSize = Number(values.requested_team_size);
    if (values.requested_team_size !== "" && (!Number.isInteger(teamSize) || teamSize < 0)) {
      nextErrors.requested_team_size = "Team size must be a whole number at least 0.";
    }
    if (values.actual_start_date && values.actual_end_date && values.actual_end_date < values.actual_start_date) {
      nextErrors.actual_end_date = "End date cannot be earlier than start date.";
    }
    return nextErrors;
  }

  function progressPayload(values: ProgressFormValues) {
    const nullableDate = (value: string) => value || null;
    const nullableNumber = (value: string) => value === "" ? null : Number(value);
    return {
      progress_percentage: Number(values.progress_percentage),
      actual_start_date: nullableDate(values.actual_start_date),
      actual_end_date: nullableDate(values.actual_end_date),
      actual_hours: nullableNumber(values.actual_hours),
      requested_team_size: nullableNumber(values.requested_team_size),
      note: values.note.trim() || null,
    };
  }

  function setProgressField(field: keyof ProgressFormValues, value: string) {
    setProgressPlanId(planToShow?.id ?? null);
    setProgressValues((current) => ({
      ...(progressPlanId === planToShow?.id ? current : progressValuesForPlan),
      [field]: value,
    }));
  }

  async function handleUpdateProgress(e: React.FormEvent) {
    e.preventDefault();
    if (!planToShow || planToShow.id === "generated") return;
    const nextErrors = validateProgress(progressValuesForPlan);
    setProgressPlanId(planToShow.id);
    setProgressErrors(nextErrors);
    setProgressMessage("");
    if (Object.keys(nextErrors).length > 0) return;

    setProgressSaving(true);
    try {
      const res = await fetch(`/api/planner/plans/progress?id=${encodeURIComponent(planToShow.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(progressPayload(progressValuesForPlan)),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Failed to update plan progress");
      if (data.plan) {
        setHistory((current) => ({
          ...current,
          plans: current.plans.map((item) => item.id === data.plan.id ? { ...item, ...data.plan } : item),
        }));
      }
      setProgressValues((current) => ({ ...(progressPlanId === planToShow.id ? current : progressValuesForPlan), note: "" }));
      setProgressMessage("Progress saved.");
      fetchPlans();
    } catch (caught) {
      setProgressMessage(caught instanceof Error ? caught.message : "Error saving progress");
    } finally {
      setProgressSaving(false);
    }
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
                  <div
                    className="completion-ring"
                    style={{ background: `conic-gradient(#046241 ${selectedProgress * 3.6}deg, #e8eef3 0)` }}
                  >
                    <div>
                      <strong>{selectedProgress}%</strong>
                      <span>actual</span>
                    </div>
                  </div>
                </section>

                <section className="schedule-card progress-card">
                  <div className="card-heading">
                    <div>
                      <span className="eyebrow">PLAN PROGRESS / ACTUALS</span>
                      <h3>Latest employee update</h3>
                    </div>
                    <span className="rows-count">{selectedProgress}% complete</span>
                  </div>

                  <div className="progress-snapshot">
                    <div>
                      <span>Actual start</span>
                      <strong>{compactDate(planToShow?.actual_start_date)}</strong>
                    </div>
                    <div>
                      <span>Actual end</span>
                      <strong>{compactDate(planToShow?.actual_end_date)}</strong>
                    </div>
                    <div>
                      <span>Actual hours</span>
                      <strong>{planToShow?.actual_hours ?? "—"}</strong>
                    </div>
                    <div>
                      <span>Requested team</span>
                      <strong>{planToShow?.requested_team_size ?? "—"}</strong>
                    </div>
                    <div>
                      <span>Last updated</span>
                      <strong>{compactDateTime(planToShow?.latest_progress_updated_at ?? planToShow?.updated_at)}</strong>
                    </div>
                  </div>

                  <div className="progress-note">
                    <span>Latest note</span>
                    <p>{planToShow?.latest_progress_note?.trim() || "No progress note recorded yet."}</p>
                  </div>

                  <form className="progress-form" onSubmit={handleUpdateProgress}>
                    <div className="form-group-compact">
                      <label htmlFor="progress-percentage">Progress percentage</label>
                      <input
                        id="progress-percentage"
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={progressValuesForPlan.progress_percentage}
                        onChange={(event) => setProgressField("progress_percentage", event.target.value)}
                        className="input-atom editable-placeholder-field"
                      />
                      {progressErrorsForPlan.progress_percentage && <p className="field-error">{progressErrorsForPlan.progress_percentage}</p>}
                    </div>
                    <div className="form-group-compact">
                      <label htmlFor="actual-start-date">Actual start date</label>
                      <input
                        id="actual-start-date"
                        type="date"
                        value={progressValuesForPlan.actual_start_date}
                        onChange={(event) => setProgressField("actual_start_date", event.target.value)}
                        className="input-atom editable-placeholder-field"
                      />
                    </div>
                    <div className="form-group-compact">
                      <label htmlFor="actual-end-date">Actual end date</label>
                      <input
                        id="actual-end-date"
                        type="date"
                        value={progressValuesForPlan.actual_end_date}
                        onChange={(event) => setProgressField("actual_end_date", event.target.value)}
                        className="input-atom editable-placeholder-field"
                      />
                      {progressErrorsForPlan.actual_end_date && <p className="field-error">{progressErrorsForPlan.actual_end_date}</p>}
                    </div>
                    <div className="form-group-compact">
                      <label htmlFor="actual-hours">Actual hours</label>
                      <input
                        id="actual-hours"
                        type="number"
                        min="0"
                        step="0.25"
                        value={progressValuesForPlan.actual_hours}
                        onChange={(event) => setProgressField("actual_hours", event.target.value)}
                        placeholder="Enter actual hours"
                        className="input-atom editable-placeholder-field"
                      />
                      {progressErrorsForPlan.actual_hours && <p className="field-error">{progressErrorsForPlan.actual_hours}</p>}
                    </div>
                    <div className="form-group-compact">
                      <label htmlFor="requested-team-size">Requested team size</label>
                      <input
                        id="requested-team-size"
                        type="number"
                        min="0"
                        step="1"
                        value={progressValuesForPlan.requested_team_size}
                        onChange={(event) => setProgressField("requested_team_size", event.target.value)}
                        placeholder="Set team size"
                        className="input-atom editable-placeholder-field"
                      />
                      {progressErrorsForPlan.requested_team_size && <p className="field-error">{progressErrorsForPlan.requested_team_size}</p>}
                    </div>
                    <div className="form-group-compact progress-note-field">
                      <label htmlFor="progress-note">Update note</label>
                      <textarea
                        id="progress-note"
                        value={progressValuesForPlan.note}
                        onChange={(event) => setProgressField("note", event.target.value)}
                        placeholder="Add a short update"
                        className="textarea-atom editable-placeholder-field"
                      />
                    </div>
                    <div className="progress-form-actions">
                      {progressMessageForPlan && (
                        <div className={progressMessageForPlan === "Progress saved." ? "success-box" : "error-box"} role="alert">
                          {progressMessageForPlan}
                        </div>
                      )}
                      <button
                        className="download-button"
                        type="submit"
                        disabled={progressSaving || !planToShow || planToShow.id === "generated"}
                      >
                        {progressSaving ? "Saving..." : "Save Progress"}
                      </button>
                    </div>
                  </form>
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
            {adminTab === "overview" ? (
              <>
                <AdminOverviewPanel
                  plans={history.plans}
                  runs={runs}
                  operators={operators}
                  plannerOnline={plannerOnline}
                  health={plannerHealth}
                  currentUser={user}
                  onRefresh={() => {
                    fetchHealth();
                    fetchPlans();
                    fetchOperators();
                    fetchRuns();
                  }}
                />
              </>
            ) : adminTab === "plans" ? (
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
            ) : null}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
