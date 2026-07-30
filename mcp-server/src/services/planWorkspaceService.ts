import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  ProductionPlan,
  ProductionPlanCellValue,
  ProductionPlanRow,
  ProductionPlanSheet,
} from "../types/productionPlan.js";
import type {
  DynamicPhase,
  DynamicPlanResult,
  DynamicRisk,
} from "./dynamicPlanService.js";
import {
  buildScheduleDates,
  DEFAULT_PLANNING_MODEL,
  extractRequestedConstraints,
  type DurationUnit,
  type ResolvedPlanningSettings,
} from "./planningConstraintsService.js";
import { planRulesService } from "./planRulesService.js";
import { dynamicExcelService } from "./dynamicExcelService.js";
import { excelService } from "./excelService.js";
import { templateService } from "./templateService.js";
import { config } from "../config.js";
import {
  createPlanChangeProposal,
  createPlanConversationMessage,
  createPlanRevision,
  createSignedPlanFileDownload,
  deletePlanRevision,
  getLatestPlanRevision,
  getPlanById,
  getPlanChangeProposal,
  getPlanRevision,
  listPlanConversationMessages,
  listPlanFiles,
  listPlanRevisions,
  recordPlanFile,
  updatePlanChangeProposalStatus,
  updatePlanFromRevision,
  uploadWorkbookAndCreateSignedUrl,
  type PlanFileRecord,
  type PlanRecord,
} from "../supabaseService.js";
import {
  planAssistantResponseSchema,
  planChangeProposalSchema,
  type PlanAssistantResponse,
  type PlanChangeProposal,
  type PlanConversationIntent,
  type PlanConversationMessage,
  type PlanRevision,
} from "../types/planWorkspace.js";

export interface WorkspaceUser {
  id?: string;
  username: string;
  role: "admin" | "operator";
}

export interface SendPlanMessageInput {
  message: string;
  revisionId?: string;
}

export interface ApplyPlanProposalInput {
  proposalId: string;
  basedOnRevisionId: string;
  confirmed: boolean;
}

export class PlanWorkspaceError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = "plan_workspace_error",
  ) {
    super(message);
  }
}

export interface PlanWorkspaceMetrics {
  targetColumn: string;
  perWorkerColumn?: string;
  teamColumn?: string;
  targetHoursColumn?: string;
  totalTarget: number;
  totalHours: number;
  teamSize: number;
  workingDays: number;
  startDate: string;
  endDate: string;
  weekdaysOnly: boolean;
  unitLabel: string;
  isQuantityPlan: boolean;
  dailyTarget: number;
  dailyHours: number;
}

interface RevisionPlanningSettings {
  startDate: string;
  durationValue: number;
  durationUnit: DurationUnit;
  totalHours: number;
  teamSize: number;
  weekdaysOnly: boolean;
  unitOfMeasure?: string;
  totalQuantity?: number;
}

const HIGH_IMPACT_FIELDS = new Set([
  "planning.totalHours",
  "planning.teamSize",
  "planning.durationValue",
  "planning.durationUnit",
  "planning.startDate",
  "planning.weekdaysOnly",
  "planning.totalQuantity",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asProductionPlan(value: unknown): ProductionPlan {
  if (!isRecord(value))
    throw new PlanWorkspaceError(422, "Revision plan data is invalid.");
  return value as unknown as ProductionPlan;
}

function numberValue(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function monthName(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function weekDayName(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
}

function isWeekendDate(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function safeSlug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "production-plan"
  );
}

function distributeAmount(
  total: number,
  count: number,
  decimals = 2,
): number[] {
  const scale = 10 ** decimals;
  const scaledTotal = Math.round(total * scale);
  const base = Math.floor(scaledTotal / count);
  const remainder = scaledTotal - base * count;
  return Array.from(
    { length: count },
    (_, index) => (base + (index < remainder ? 1 : 0)) / scale,
  );
}

function findProductionSheet(
  plan: ProductionPlan,
): ProductionPlanSheet | undefined {
  return (
    plan.workbook?.sheets?.find(
      (sheet) => sheet.sheetName === "Production Plan",
    ) ??
    plan.workbook?.sheets?.find((sheet) => /production/i.test(sheet.sheetName))
  );
}

function sheetColumns(sheet: ProductionPlanSheet | undefined): string[] {
  if (!sheet) return [];
  if (sheet.columns?.length) return sheet.columns;
  return Object.keys(sheet.rows?.[0] ?? {});
}

function targetColumn(columns: string[]): string {
  return (
    columns.find((column) => column === "Target Total Hours") ??
    columns.find(
      (column) =>
        (/target|plan/i.test(column) ||
          /posts|images|records|documents|units|hours|tasks/i.test(column)) &&
        !/active|accumulate|accumulative|annotator|annotators|recorder|recorders|operator|operators|worker|workers|staff|headcount|team|resource|resources|per\s+(?:annotator|person|worker|recorder|operator|resource|staff)|actual|balance|status|variance|completion/i.test(
          column,
        ),
    ) ??
    columns[5] ??
    "Target Total Hours"
  );
}

function inferUnitLabel(plan: ProductionPlan, target: string): string {
  const fromProject = plan.project?.productionUnit;
  if (fromProject && fromProject !== "hours") return fromProject;
  const cleaned = target
    .replace(/target\s*/i, "")
    .replace(/total\s*/i, "")
    .replace(/plan\s*/i, "")
    .replace(/no\.\s*of\s*/i, "")
    .trim()
    .toLowerCase();
  return cleaned || "hours";
}

export function extractPlanWorkspaceMetrics(
  plan: ProductionPlan,
): PlanWorkspaceMetrics {
  const sheet = findProductionSheet(plan);
  const rows = sheet?.rows ?? [];
  const columns = sheetColumns(sheet);
  const target = targetColumn(columns);
  const targetHours = columns.includes("Target Total Hours")
    ? "Target Total Hours"
    : columns.includes("Target Hours")
      ? "Target Hours"
      : target;
  const team = columns.find((column) =>
    /active\s+(?:annotators|recorders|operators|resources)|workers|team|staff|resource/i.test(
      column,
    ),
  );
  const perWorker = columns.find((column) =>
    /per\s+(?:annotator|person|worker|recorder|operator|resource)/i.test(
      column,
    ),
  );
  const totalTarget = rows.reduce(
    (sum, row) => sum + numberValue(row[target]),
    0,
  );
  const totalHours = rows.reduce(
    (sum, row) => sum + numberValue(row[targetHours]),
    0,
  );
  const teamSize = team
    ? rows.reduce(
        (largest, row) => Math.max(largest, numberValue(row[team])),
        0,
      )
    : 0;
  const startDate = String(rows[0]?.Date ?? plan.project?.startDate ?? "");
  const endDate = String(rows.at(-1)?.Date ?? plan.project?.deadline ?? "");
  const workingDays = rows.length;
  const unitLabel = inferUnitLabel(plan, target);
  const isQuantityPlan = unitLabel !== "hours" && target !== targetHours;

  return {
    targetColumn: target,
    perWorkerColumn: perWorker,
    teamColumn: team,
    targetHoursColumn: targetHours,
    totalTarget: round2(totalTarget),
    totalHours: round2(totalHours),
    teamSize,
    workingDays,
    startDate,
    endDate,
    weekdaysOnly:
      rows.length > 0
        ? rows.every((row) => !isWeekendDate(String(row.Date)))
        : true,
    unitLabel,
    isQuantityPlan,
    dailyTarget: workingDays > 0 ? round2(totalTarget / workingDays) : 0,
    dailyHours: workingDays > 0 ? round2(totalHours / workingDays) : 0,
  };
}

export function classifyPlanConversationIntent(
  message: string,
): PlanConversationIntent {
  const text = message.toLowerCase();
  if (
    /\b(weather|recipe|joke|poem|song|news|stock|crypto|movie|translate|write\s+an?\s+email)\b/.test(
      text,
    )
  ) {
    return "unrelated_request";
  }
  if (
    /\b(compare|difference|diff|changed)\b/.test(text) &&
    /\brevisions?\b/.test(text)
  ) {
    return "compare_revisions";
  }
  if (
    /\b(restore|revert|go\s+back|roll\s+back)\b/.test(text) &&
    /\brevisions?\b/.test(text)
  ) {
    return "restore_revision";
  }
  if (/\b(regenerate|rebuild|start\s+over|new\s+revision)\b/.test(text)) {
    return "request_regeneration";
  }
  if (
    /\b(wrong|incorrect|mistake|error|not\s+right|should\s+be)\b/.test(text)
  ) {
    return "report_mistake";
  }
  if (
    /\b(meant|misunderstood|clarify|instead|per\s+(?:worker|annotator|person|resource))\b/.test(
      text,
    )
  ) {
    return "clarify_requirement";
  }
  if (
    /\b(change|set|update|move|adjust|use|switch|increase|decrease|make)\b/.test(
      text,
    )
  ) {
    return "request_modification";
  }
  if (
    /\b(how|formula|calculate|calculated|calculation|daily\s+target|staffing\s+requirement|team\s+size)\b/.test(
      text,
    )
  ) {
    return "explain_calculation";
  }
  if (/\b(explain|why|summarize|summary|walk\s+me\s+through)\b/.test(text)) {
    return "explain_plan";
  }
  return "explain_plan";
}

function formulaResult(value: number, suffix = ""): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`;
}

export function buildPlanExplanation(
  plan: ProductionPlan,
  intent: PlanConversationIntent,
): PlanAssistantResponse {
  const metrics = extractPlanWorkspaceMetrics(plan);
  const assumptions = plan.project?.assumptions?.slice(0, 6) ?? [];
  const projectName = plan.project?.projectName || "this production plan";
  const unit = metrics.unitLabel;
  const planSummary =
    `${projectName} runs from ${metrics.startDate || "the selected start date"} to ${metrics.endDate || "the selected end date"} ` +
    `across ${metrics.workingDays} scheduled day(s), with ${metrics.teamSize || "the planned"} resource(s).`;

  if (intent === "explain_calculation") {
    const formulas = [
      {
        label: "Daily team target",
        expression: `${metrics.totalTarget.toLocaleString()} ${unit} / ${metrics.workingDays} scheduled day(s)`,
        result: formulaResult(metrics.dailyTarget, ` ${unit}/day`),
      },
      {
        label: "Daily target per resource",
        expression: `${metrics.dailyTarget.toLocaleString()} ${unit}/day / ${Math.max(metrics.teamSize, 1)} resource(s)`,
        result: formulaResult(
          metrics.teamSize > 0 ? metrics.dailyTarget / metrics.teamSize : 0,
          ` ${unit}/resource/day`,
        ),
      },
      {
        label: "Planned hours per day",
        expression: `${metrics.totalHours.toLocaleString()} hours / ${metrics.workingDays} scheduled day(s)`,
        result: formulaResult(metrics.dailyHours, " hours/day"),
      },
    ];
    return planAssistantResponseSchema.parse({
      intent,
      message:
        `The main daily target is based on the selected plan's actual schedule rows: ` +
        `${metrics.totalTarget.toLocaleString()} ${unit} over ${metrics.workingDays} scheduled day(s), ` +
        `which gives ${metrics.dailyTarget.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit} per day.`,
      explanation: {
        summary:
          "The calculation uses the current revision's Production Plan rows, not a fresh estimate.",
        formulas,
        assumptions,
      },
      requiresConfirmation: false,
      canApply: false,
    });
  }

  return planAssistantResponseSchema.parse({
    intent,
    message:
      `${planSummary} The plan allocates ${metrics.totalTarget.toLocaleString()} ${unit} ` +
      `and ${metrics.totalHours.toLocaleString(undefined, { maximumFractionDigits: 2 })} planned hour(s). ` +
      `It is using ${metrics.weekdaysOnly ? "weekday-only" : "calendar-day"} scheduling.`,
    explanation: {
      summary:
        plan.summary ||
        "The selected production plan is organized around the current workbook schedule and assumptions.",
      assumptions,
    },
    requiresConfirmation: false,
    canApply: false,
  });
}

function addChange(
  changes: PlanChangeProposal["changes"],
  field: string,
  label: string,
  previousValue: unknown,
  proposedValue: unknown,
  reason: string,
  impact?: string,
): void {
  if (previousValue === proposedValue) return;
  changes.push({ field, label, previousValue, proposedValue, reason, impact });
}

function firstHoursNumber(message: string): number | undefined {
  const match =
    message.match(
      /\b(\d+(?:\.\d+)?)\s+(?:total\s+|working\s+|productive\s+)?hours?\b/i,
    ) ??
    message.match(/\bhours?\s+(?:should\s+be|to|of|=|:)?\s*(\d+(?:\.\d+)?)\b/i);
  const value = match ? Number(match[1]) : undefined;
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function proposalSummary(message: string): string {
  const trimmed = message.trim();
  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
}

function proposedSettingsFromChanges(
  metrics: PlanWorkspaceMetrics,
  changes: PlanChangeProposal["changes"],
): RevisionPlanningSettings {
  const next: RevisionPlanningSettings = {
    startDate: metrics.startDate,
    durationValue: Math.max(metrics.workingDays, 1),
    durationUnit: "days",
    totalHours: metrics.totalHours || metrics.totalTarget || 1,
    teamSize: Math.max(metrics.teamSize, 1),
    weekdaysOnly: metrics.weekdaysOnly,
    unitOfMeasure: metrics.isQuantityPlan ? metrics.unitLabel : undefined,
    totalQuantity: metrics.isQuantityPlan ? metrics.totalTarget : undefined,
  };

  for (const change of changes) {
    if (change.field === "planning.totalHours")
      next.totalHours = Number(change.proposedValue);
    if (change.field === "planning.teamSize")
      next.teamSize = Number(change.proposedValue);
    if (change.field === "planning.durationValue")
      next.durationValue = Number(change.proposedValue);
    if (change.field === "planning.durationUnit")
      next.durationUnit = String(change.proposedValue) as DurationUnit;
    if (change.field === "planning.startDate")
      next.startDate = String(change.proposedValue);
    if (change.field === "planning.weekdaysOnly")
      next.weekdaysOnly = Boolean(change.proposedValue);
    if (change.field === "planning.totalQuantity")
      next.totalQuantity = Number(change.proposedValue);
  }

  return next;
}

function estimateRecalculatedMetrics(
  metrics: PlanWorkspaceMetrics,
  changes: PlanChangeProposal["changes"],
) {
  const next = proposedSettingsFromChanges(metrics, changes);
  let proposedDuration = next.durationValue;
  try {
    proposedDuration = buildScheduleDates({
      startDate: next.startDate,
      duration: { value: next.durationValue, unit: next.durationUnit },
      totalHours: next.totalHours,
      teamSize: next.teamSize,
      weekdaysOnly: next.weekdaysOnly,
      unitOfMeasure: next.unitOfMeasure,
      totalQuantity: next.totalQuantity,
    }).length;
  } catch {
    proposedDuration = next.durationValue;
  }
  const proposedTotalTarget = next.totalQuantity ?? next.totalHours;
  return {
    previousWorkerCount: metrics.teamSize,
    proposedWorkerCount: next.teamSize,
    previousTotalHours: metrics.totalHours,
    proposedTotalHours: round2(next.totalHours),
    previousDuration: metrics.workingDays,
    proposedDuration,
    previousDailyTarget: metrics.dailyTarget,
    proposedDailyTarget:
      proposedDuration > 0 ? round2(proposedTotalTarget / proposedDuration) : 0,
    previousTotalTarget: metrics.totalTarget,
    proposedTotalTarget: round2(proposedTotalTarget),
  };
}

function proposalWarnings(
  metrics: PlanWorkspaceMetrics,
  changes: PlanChangeProposal["changes"],
): string[] {
  const next = proposedSettingsFromChanges(metrics, changes);
  let scheduledDays = next.durationValue;
  try {
    scheduledDays = buildScheduleDates({
      startDate: next.startDate,
      duration: { value: next.durationValue, unit: next.durationUnit },
      totalHours: next.totalHours,
      teamSize: next.teamSize,
      weekdaysOnly: next.weekdaysOnly,
      unitOfMeasure: next.unitOfMeasure,
      totalQuantity: next.totalQuantity,
    }).length;
  } catch (error) {
    return [
      `The revised schedule needs clarification: ${(error as Error).message}`,
    ];
  }
  const availableHours = next.teamSize * scheduledDays * 8;
  if (next.totalHours > availableHours) {
    return [
      `The requested ${next.totalHours.toLocaleString()} hours exceeds the default available capacity of ` +
        `${availableHours.toLocaleString()} hours (${next.teamSize} resource(s) x ${scheduledDays} day(s) x 8 hours).`,
    ];
  }
  return [];
}

export function buildPlanChangeProposal(
  planId: string,
  basedOnRevisionId: string,
  plan: ProductionPlan,
  message: string,
): PlanChangeProposal | null {
  const metrics = extractPlanWorkspaceMetrics(plan);
  const currentDate = new Date().toISOString().slice(0, 10);
  const requested = extractRequestedConstraints(message, currentDate);
  const changes: PlanChangeProposal["changes"] = [];
  const hoursNumber = firstHoursNumber(message);
  const perWorkerHours =
    hoursNumber !== undefined &&
    /\b(?:per|for each|each)\s+(?:worker|annotator|person|resource|employee|operator)\b/i.test(
      message,
    );

  if (perWorkerHours) {
    addChange(
      changes,
      "planning.totalHours",
      "Total planned hours",
      metrics.totalHours,
      round2(hoursNumber * Math.max(metrics.teamSize, 1)),
      "The message says the hours apply to each resource, so team hours must be resource hours multiplied by worker count.",
      "Daily team hours and per-resource targets will be recalculated.",
    );
  } else if (requested.totalHours !== undefined) {
    addChange(
      changes,
      "planning.totalHours",
      "Total planned hours",
      metrics.totalHours,
      requested.totalHours,
      "The message provides a revised total-hours requirement.",
      "Daily hours and capacity utilization will change.",
    );
  }

  if (requested.teamSize !== undefined) {
    addChange(
      changes,
      "planning.teamSize",
      "Worker count",
      metrics.teamSize,
      requested.teamSize,
      "The message provides a revised staffing requirement.",
      "Per-resource daily targets and available capacity will change.",
    );
  }

  if (requested.duration !== undefined) {
    addChange(
      changes,
      "planning.durationValue",
      "Project duration",
      metrics.workingDays,
      requested.duration.value,
      "The message provides a revised schedule duration.",
      "Schedule rows and daily targets will be rebuilt.",
    );
    addChange(
      changes,
      "planning.durationUnit",
      "Duration unit",
      "days",
      requested.duration.unit,
      "The message provides the duration unit.",
    );
  }

  if (requested.startDate !== undefined) {
    addChange(
      changes,
      "planning.startDate",
      "Start date",
      metrics.startDate,
      requested.startDate,
      "The message provides a revised project start date.",
      "Schedule dates and workbook rows will be rebuilt.",
    );
  }

  if (requested.weekdaysOnly !== undefined) {
    addChange(
      changes,
      "planning.weekdaysOnly",
      "Working-day rule",
      metrics.weekdaysOnly ? "weekdays only" : "calendar days",
      requested.weekdaysOnly ? "weekdays only" : "calendar days",
      "The message changes whether weekends are included.",
      "The schedule date set may change.",
    );
  }

  if (requested.totalQuantity !== undefined && metrics.isQuantityPlan) {
    addChange(
      changes,
      "planning.totalQuantity",
      "Total production target",
      metrics.totalTarget,
      requested.totalQuantity,
      "The message provides a revised production quantity.",
      "Daily production targets will be recalculated.",
    );
  }

  if (changes.length === 0) return null;

  const affectedSections = [
    ...new Set(
      changes.flatMap((change) => {
        if (change.field === "planning.teamSize")
          return ["Staffing", "Production Plan", "Workbook"];
        if (
          change.field === "planning.startDate" ||
          change.field === "planning.durationValue" ||
          change.field === "planning.weekdaysOnly"
        ) {
          return ["Schedule", "Production Plan", "Workbook"];
        }
        return ["Metrics", "Production Plan", "Workbook"];
      }),
    ),
  ];

  const proposal = {
    id: randomUUID(),
    planId,
    basedOnRevisionId,
    requestSummary: proposalSummary(message),
    interpretedRequest: perWorkerHours
      ? `Treat ${hoursNumber} hours as a per-resource requirement, not a whole-team total.`
      : `Apply the requested planning changes to the selected plan revision.`,
    reasonForChange:
      "The selected plan should reflect the corrected production-planning requirement before a new workbook is generated.",
    affectedSections,
    changes,
    recalculatedMetrics: estimateRecalculatedMetrics(metrics, changes),
    warnings: proposalWarnings(metrics, changes),
    clarificationQuestions: [],
    requiresConfirmation: changes.some((change) =>
      HIGH_IMPACT_FIELDS.has(change.field),
    ),
  };

  return planChangeProposalSchema.parse(proposal);
}

function normalizeWorkbookMode(mode: unknown): "dynamic" | "template" {
  return mode === "official_template" || mode === "template"
    ? "template"
    : "dynamic";
}

function canAccessPlan(plan: PlanRecord, user: WorkspaceUser): boolean {
  if (user.role === "admin") return true;
  return (
    plan.whatsapp_user_id === user.username ||
    plan.requested_by === user.username
  );
}

function requireSupabaseConfigured(): void {
  if (!config.supabaseConfigured) {
    throw new PlanWorkspaceError(
      503,
      "Supabase is required for plan workspace history.",
    );
  }
}

async function loadAuthorizedPlan(
  planId: string,
  user: WorkspaceUser,
): Promise<PlanRecord> {
  requireSupabaseConfigured();
  const plan = await getPlanById(planId);
  if (!plan) throw new PlanWorkspaceError(404, "Plan not found.");
  if (!canAccessPlan(plan, user)) {
    throw new PlanWorkspaceError(
      403,
      "You are not authorized to access this plan.",
    );
  }
  return plan;
}

async function ensureInitialRevision(plan: PlanRecord): Promise<PlanRevision> {
  const existing = await getLatestPlanRevision(plan.id!);
  if (existing) return existing;
  const files = await listPlanFiles(plan.id!).catch(
    () => [] as PlanFileRecord[],
  );
  const latestFile = files[0];
  return createPlanRevision({
    planId: plan.id!,
    revisionNumber: 1,
    createdBy: plan.requested_by ?? plan.whatsapp_user_id,
    createdByRole: "system",
    revisionSource: "initial_generation",
    changeSummary: "Initial production plan imported from saved plan history.",
    planData: plan.raw_plan,
    validationResult: {
      status: "passed",
      importedAt: new Date().toISOString(),
    },
    workbookMode: normalizeWorkbookMode(plan.workbook_mode),
    workbookFilename: latestFile?.file_name ?? null,
    workbookStoragePath: latestFile?.storage_path ?? null,
  });
}

export async function loadPlanWorkspace(planId: string, user: WorkspaceUser) {
  const plan = await loadAuthorizedPlan(planId, user);
  const currentRevision = await ensureInitialRevision(plan);
  const [conversation, revisions, files] = await Promise.all([
    listPlanConversationMessages(planId),
    listPlanRevisions(planId),
    listPlanFiles(planId).catch(() => [] as PlanFileRecord[]),
  ]);

  return {
    success: true,
    configured: true,
    plan,
    currentRevision,
    currentPlanData: currentRevision.plan_data,
    conversation,
    revisions,
    workbookFiles: files,
    permissions: {
      canMessage: true,
      canApplyProposal: true,
      canRestoreRevision: canAccessPlan(plan, user),
      canDeleteRevision: canAccessPlan(plan, user),
      canDownloadWorkbook: true,
      role: user.role,
    },
  };
}

function assistantMessageType(
  response: PlanAssistantResponse,
): "assistant" | "proposal" | "clarification" {
  if (response.proposal) return "proposal";
  if (response.clarificationQuestions?.length) return "clarification";
  return "assistant";
}

function buildAssistantResponse(
  planId: string,
  currentRevision: PlanRevision,
  plan: ProductionPlan,
  message: string,
): PlanAssistantResponse {
  const intent = classifyPlanConversationIntent(message);
  if (intent === "unrelated_request") {
    return planAssistantResponseSchema.parse({
      intent,
      message:
        "I can only help with the selected production plan in this workspace.",
      requiresConfirmation: false,
      canApply: false,
      warnings: [
        "Select another plan if you need context for a different project.",
      ],
    });
  }

  if (intent === "explain_plan" || intent === "explain_calculation") {
    return buildPlanExplanation(plan, intent);
  }

  if (intent === "compare_revisions") {
    return planAssistantResponseSchema.parse({
      intent,
      message:
        "I can compare two saved revisions when you select the revision pair from the revision history.",
      clarificationQuestions: ["Which two revision numbers should I compare?"],
      requiresConfirmation: false,
      canApply: false,
    });
  }

  if (intent === "restore_revision") {
    return planAssistantResponseSchema.parse({
      intent,
      message:
        "Restoring is available from the revision history. It creates a new revision instead of overwriting history.",
      clarificationQuestions: ["Which revision should be restored?"],
      requiresConfirmation: false,
      canApply: false,
    });
  }

  const proposal = buildPlanChangeProposal(
    planId,
    currentRevision.id,
    plan,
    message,
  );
  if (!proposal) {
    return planAssistantResponseSchema.parse({
      intent,
      message:
        "I need one more detail before I can safely prepare a revision proposal.",
      clarificationQuestions: [
        "Should the deadline stay fixed, or should the system change the schedule length?",
        "Should staffing change, daily workload change, or both?",
      ],
      requiresConfirmation: false,
      canApply: false,
      warnings: ["No production values were changed yet."],
    });
  }

  return planAssistantResponseSchema.parse({
    intent,
    message:
      `I found ${proposal.changes.length} change(s) that affect ${proposal.affectedSections.join(", ")}. ` +
      "Review the proposal, then click Apply Changes to create the revised plan and workbook.",
    proposal,
    requiresConfirmation: proposal.requiresConfirmation,
    canApply: true,
    warnings: proposal.warnings,
  });
}

export async function sendPlanWorkspaceMessage(
  planId: string,
  user: WorkspaceUser,
  input: SendPlanMessageInput,
) {
  const text = input.message.trim();
  if (!text) throw new PlanWorkspaceError(400, "Message is required.");
  if (text.length > 4_000)
    throw new PlanWorkspaceError(
      400,
      "Message must be 4,000 characters or fewer.",
    );

  const plan = await loadAuthorizedPlan(planId, user);
  const currentRevision = await ensureInitialRevision(plan);
  if (input.revisionId && input.revisionId !== currentRevision.id) {
    throw new PlanWorkspaceError(
      409,
      "This plan has a newer revision. Reload the workspace before sending another message.",
      "revision_conflict",
    );
  }

  const existingMessages = await listPlanConversationMessages(planId);

  const userMessage = await createPlanConversationMessage({
    planId,
    revisionId: currentRevision.id,
    userId: user.id ?? user.username,
    role: "user",
    messageType: "user",
    content: text,
    metadata: { revisionNumber: currentRevision.revision_number },
  });

  const previousUserTexts = existingMessages
    .filter((m) => m.role === "user")
    .map((m) => m.content);
  const combinedContext = [...previousUserTexts, text].join("\n");

  const assistantResponse = buildAssistantResponse(
    planId,
    currentRevision,
    asProductionPlan(currentRevision.plan_data),
    combinedContext,
  );

  if (assistantResponse.proposal) {
    await createPlanChangeProposal(
      assistantResponse.proposal,
      user.id ?? user.username,
    );
  }

  const assistantMessage = await createPlanConversationMessage({
    planId,
    revisionId: currentRevision.id,
    userId: user.id ?? user.username,
    role: "assistant",
    messageType: assistantMessageType(assistantResponse),
    content: assistantResponse.message,
    metadata: {
      assistantResponse,
      intent: assistantResponse.intent,
      proposalId: assistantResponse.proposal?.id,
      model: "deterministic-plan-workspace-v1",
    },
  });

  return {
    success: true,
    userMessage,
    assistantMessage,
    assistantResponse,
    proposal: assistantResponse.proposal ?? null,
  };
}

function baseSettingsFromPlan(plan: ProductionPlan): RevisionPlanningSettings {
  const metrics = extractPlanWorkspaceMetrics(plan);
  return {
    startDate: metrics.startDate || plan.project.startDate,
    durationValue: Math.max(metrics.workingDays, 1),
    durationUnit: "days",
    totalHours: metrics.totalHours || metrics.totalTarget || 1,
    teamSize: Math.max(metrics.teamSize, 1),
    weekdaysOnly: metrics.weekdaysOnly,
    unitOfMeasure: metrics.isQuantityPlan ? metrics.unitLabel : undefined,
    totalQuantity: metrics.isQuantityPlan ? metrics.totalTarget : undefined,
  };
}

function applyChangesToSettings(
  settings: RevisionPlanningSettings,
  changes: PlanChangeProposal["changes"],
): RevisionPlanningSettings {
  const next = { ...settings };
  for (const change of changes) {
    if (change.field === "planning.totalHours")
      next.totalHours = Number(change.proposedValue);
    if (change.field === "planning.teamSize")
      next.teamSize = Number(change.proposedValue);
    if (change.field === "planning.durationValue")
      next.durationValue = Number(change.proposedValue);
    if (change.field === "planning.durationUnit")
      next.durationUnit = String(change.proposedValue) as DurationUnit;
    if (change.field === "planning.startDate")
      next.startDate = String(change.proposedValue);
    if (change.field === "planning.weekdaysOnly")
      next.weekdaysOnly =
        String(change.proposedValue) === "weekdays only" ||
        change.proposedValue === true;
    if (change.field === "planning.totalQuantity")
      next.totalQuantity = Number(change.proposedValue);
  }
  return next;
}

function validationDescription(settings: RevisionPlanningSettings): string {
  const workload = settings.totalQuantity
    ? `${settings.totalQuantity} ${settings.unitOfMeasure ?? "units"} and ${settings.totalHours} total hours`
    : `${settings.totalHours} total hours`;
  return [
    `Revision plan for ${settings.teamSize} workers over ${settings.durationValue} ${settings.durationUnit}.`,
    `Use ${workload}.`,
    `Start ${settings.startDate}.`,
    settings.weekdaysOnly
      ? "Use weekdays only."
      : "Use calendar days including weekends.",
    "Historical plan revision is allowed if start date is before the validation date.",
  ].join(" ");
}

function cellValue(value: unknown): ProductionPlanCellValue {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }
  return "";
}

function applyDefaultPlanningModel(plan: ProductionPlan): void {
  const modelAssumption = `Requested planning model preserved: ${DEFAULT_PLANNING_MODEL}.`;
  const assumptions = [...(plan.project.assumptions ?? [])];
  if (!assumptions.some((item) => /LPB Model/i.test(item)))
    assumptions.push(modelAssumption);
  plan.project.assumptions = assumptions;

  const projectInfo = plan.workbook.sheets.find(
    (sheet) => sheet.sheetName === "Project Information",
  );
  if (!projectInfo) return;

  const planningModelRow = projectInfo.rows.find(
    (row) => String(row.Field ?? "").toLowerCase() === "planning model",
  );
  if (planningModelRow) {
    planningModelRow.Value = DEFAULT_PLANNING_MODEL;
    return;
  }

  projectInfo.rows.push({
    Field: "Planning model",
    Value: DEFAULT_PLANNING_MODEL,
  });
}

export function applyProposalToPlanData(
  basePlan: ProductionPlan,
  proposal: PlanChangeProposal,
  nextRevisionNumber: number,
  currentDate = new Date().toISOString().slice(0, 10),
): ProductionPlan {
  const plan = JSON.parse(JSON.stringify(basePlan)) as ProductionPlan;
  const sheet = findProductionSheet(plan);
  if (!sheet)
    throw new PlanWorkspaceError(
      422,
      "Plan does not contain a Production Plan sheet.",
    );

  const columns = sheetColumns(sheet);
  const metrics = extractPlanWorkspaceMetrics(plan);
  const baseSettings = baseSettingsFromPlan(plan);
  const settings = applyChangesToSettings(baseSettings, proposal.changes);
  if (!Number.isFinite(settings.totalHours) || settings.totalHours <= 0) {
    throw new PlanWorkspaceError(
      422,
      "Revised total hours must be greater than zero.",
    );
  }
  if (!Number.isInteger(settings.teamSize) || settings.teamSize <= 0) {
    throw new PlanWorkspaceError(
      422,
      "Revised worker count must be a positive whole number.",
    );
  }

  const dates = buildScheduleDates({
    startDate: settings.startDate,
    duration: { value: settings.durationValue, unit: settings.durationUnit },
    totalHours: settings.totalHours,
    teamSize: settings.teamSize,
    weekdaysOnly: settings.weekdaysOnly,
    unitOfMeasure: settings.unitOfMeasure,
    totalQuantity: settings.totalQuantity,
  });
  const target = metrics.targetColumn;
  const targetHours = metrics.targetHoursColumn ?? target;
  const teamColumn = metrics.teamColumn ?? "Target Active Annotators";
  const perWorkerColumn = metrics.perWorkerColumn;
  const targetTotal = settings.totalQuantity ?? settings.totalHours;
  const targetDecimals = settings.totalQuantity ? 0 : 2;
  const targetValues = distributeAmount(
    targetTotal,
    dates.length,
    targetDecimals,
  );
  const hourValues = distributeAmount(settings.totalHours, dates.length, 2);

  sheet.columns = columns;
  sheet.rows = dates.map((date, index) => {
    const row: ProductionPlanRow = {};
    for (const column of columns) row[column] = "";
    if (columns.includes("No.")) row["No."] = index + 1;
    if (columns.includes("Date")) row.Date = date;
    if (columns.includes("Month")) row.Month = monthName(date);
    if (columns.includes("Day")) row.Day = weekDayName(date);
    if (columns.includes(teamColumn)) row[teamColumn] = settings.teamSize;
    if (columns.includes(target)) row[target] = targetValues[index]!;
    if (perWorkerColumn && columns.includes(perWorkerColumn)) {
      row[perWorkerColumn] = settings.totalQuantity
        ? Math.round(targetValues[index]! / settings.teamSize)
        : round2(targetValues[index]! / settings.teamSize);
    }
    if (columns.includes(targetHours)) row[targetHours] = hourValues[index]!;
    if (columns.includes("Actual Active Annotators"))
      row["Actual Active Annotators"] = "";
    if (columns.includes("Actual Total Hours")) row["Actual Total Hours"] = "";
    if (columns.includes("Actual Total Hours per Annotator"))
      row["Actual Total Hours per Annotator"] = "";
    if (columns.includes("Actual Hours")) row["Actual Hours"] = "";
    if (columns.includes("Total Variance")) row["Total Variance"] = "";
    if (columns.includes("Completion Rate (%)"))
      row["Completion Rate (%)"] = "";
    if (columns.includes("Status")) row.Status = "Not Started";
    if (columns.includes("Notes"))
      row.Notes = cellValue(
        sheet.rows[index]?.Notes ??
          `Revision ${nextRevisionNumber} recalculated target.`,
      );
    return row;
  });

  const revisionNote = `Revision ${nextRevisionNumber}: ${proposal.requestSummary}`;
  const assumptions = [...(plan.project.assumptions ?? [])];
  if (!assumptions.includes(revisionNote)) assumptions.push(revisionNote);
  const utilization =
    settings.teamSize * dates.length * 8 > 0
      ? round2(
          (settings.totalHours / (settings.teamSize * dates.length * 8)) * 100,
        )
      : 0;
  plan.project = {
    ...plan.project,
    startDate: dates[0]!,
    deadline: dates.at(-1)!,
    totalAssets: settings.totalQuantity ?? targetTotal,
    assumptions,
    productionUnit:
      settings.unitOfMeasure ?? plan.project.productionUnit ?? "hours",
    requiredDailyOutput: round2(targetTotal / dates.length),
    utilizationPercent: utilization,
  };

  const taskSheet = plan.workbook.sheets.find(
    (item) => item.sheetName === "Task Breakdown",
  );
  if (taskSheet) {
    const oldBaseStart = basePlan.project?.startDate
      ? new Date(`${basePlan.project.startDate}T00:00:00Z`).getTime()
      : null;
    const newBaseStart = new Date(`${dates[0]!}T00:00:00Z`);

    taskSheet.rows = taskSheet.rows.map((row) => {
      const taskObj = { ...row };
      const rawStart =
        typeof row["Planned Start"] === "string"
          ? row["Planned Start"].trim()
          : "";
      const rawEnd =
        typeof row["Planned End"] === "string" ? row["Planned End"].trim() : "";
      if (
        /^\d{4}-\d{2}-\d{2}$/.test(rawStart) &&
        /^\d{4}-\d{2}-\d{2}$/.test(rawEnd)
      ) {
        const startDateObj = new Date(`${rawStart}T00:00:00Z`);
        const endDateObj = new Date(`${rawEnd}T00:00:00Z`);
        const durationMs = endDateObj.getTime() - startDateObj.getTime();

        let dayOffset = 0;
        if (oldBaseStart && !Number.isNaN(oldBaseStart)) {
          dayOffset = Math.round(
            (startDateObj.getTime() - oldBaseStart) / (1000 * 60 * 60 * 24),
          );
        }
        if (dayOffset < 0) dayOffset = 0;

        let newStart = new Date(newBaseStart);
        newStart.setUTCDate(newStart.getUTCDate() + dayOffset);
        let newEnd = new Date(newStart.getTime() + durationMs);

        if (settings.weekdaysOnly) {
          while (newStart.getUTCDay() === 0 || newStart.getUTCDay() === 6) {
            newStart.setUTCDate(newStart.getUTCDate() + 1);
          }
          while (newEnd.getUTCDay() === 0 || newEnd.getUTCDay() === 6) {
            newEnd.setUTCDate(newEnd.getUTCDate() + 1);
          }
        }

        const projectEndObj = new Date(`${dates.at(-1)!}T00:00:00Z`);
        if (newEnd > projectEndObj) {
          taskObj["Planned End"] = dates.at(-1)!;
          if (newStart > projectEndObj)
            taskObj["Planned Start"] = dates.at(-1)!;
          else taskObj["Planned Start"] = newStart.toISOString().slice(0, 10);
        } else {
          taskObj["Planned Start"] = newStart.toISOString().slice(0, 10);
          taskObj["Planned End"] = newEnd.toISOString().slice(0, 10);
        }
      }
      return taskObj;
    });
  }

  applyDefaultPlanningModel(plan);
  plan.summary =
    `${plan.project.projectName || "Production plan"} revision ${nextRevisionNumber}: ${proposal.requestSummary}. ` +
    `Planned workload: ${targetTotal.toLocaleString()} ${plan.project.productionUnit ?? "hours"} ` +
    `from ${dates[0]} to ${dates.at(-1)} with ${settings.teamSize} resource(s).`;

  const validationDate = dates[0]! < currentDate ? dates[0]! : currentDate;
  return planRulesService.validate(plan, {
    currentDate: validationDate,
    input: { projectDescription: validationDescription(settings) },
  });
}

function extractPhases(plan: ProductionPlan): DynamicPhase[] {
  const stageSheet = plan.workbook.sheets.find((sheet) =>
    /workflow|stage|phase/i.test(sheet.sheetName),
  );
  const rows = stageSheet?.rows ?? [];
  const phases = rows
    .slice(0, 8)
    .map((row) => ({
      name: String(
        row["Stage Name"] ?? row.Phase ?? row.Milestone ?? "Production",
      ),
      objective: String(
        row.Purpose ??
          row.Objective ??
          row["Completion Criteria"] ??
          "Complete planned production work.",
      ),
    }))
    .filter((phase) => phase.name.trim());
  return phases.length
    ? phases
    : [{ name: "Production", objective: "Complete planned production work." }];
}

function extractRisks(plan: ProductionPlan): DynamicRisk[] {
  const riskSheet = plan.workbook.sheets.find((sheet) =>
    /risk/i.test(sheet.sheetName),
  );
  const rows = riskSheet?.rows ?? [];
  return rows
    .slice(0, 12)
    .map((row) => ({
      risk: String(row.Description ?? row.Item ?? row.Risk ?? "Delivery risk"),
      impact: String(
        row.Impact ??
          row.Severity ??
          "May affect schedule, quality, or capacity.",
      ),
      mitigation: String(
        row.Mitigation ??
          row["Mitigation / Note"] ??
          row.Contingency ??
          "Monitor and adjust the plan promptly.",
      ),
    }))
    .filter((risk) => risk.risk.trim());
}

function dynamicResultFromPlan(plan: ProductionPlan): DynamicPlanResult {
  const metrics = extractPlanWorkspaceMetrics(plan);
  const settings: ResolvedPlanningSettings = {
    startDate: metrics.startDate,
    duration: { value: Math.max(metrics.workingDays, 1), unit: "days" },
    totalHours: metrics.totalHours || metrics.totalTarget || 1,
    teamSize: Math.max(metrics.teamSize, 1),
    weekdaysOnly: metrics.weekdaysOnly,
    unitOfMeasure: metrics.isQuantityPlan ? metrics.unitLabel : undefined,
    totalQuantity: metrics.isQuantityPlan ? metrics.totalTarget : undefined,
  };

  return {
    plan,
    settings,
    phases: extractPhases(plan),
    risks: extractRisks(plan),
    unitLabel: metrics.isQuantityPlan
      ? metrics.unitLabel.charAt(0).toUpperCase() + metrics.unitLabel.slice(1)
      : undefined,
    totalQuantity: metrics.isQuantityPlan ? metrics.totalTarget : undefined,
  };
}

async function generateRevisionWorkbook(
  plan: ProductionPlan,
  workbookMode: "dynamic" | "template",
  revisionNumber: number,
) {
  const filename = `lifeplan-${safeSlug(plan.project.projectName)}-revision-${revisionNumber}.xlsx`;
  const outputPath = path.resolve("outputs", "revisions", filename);
  if (workbookMode === "template") {
    const template = await templateService.loadDefinition();
    return excelService.writeProductionPlan(plan, template, outputPath);
  }
  return dynamicExcelService.writeDynamicProductionPlan(
    dynamicResultFromPlan(plan),
    outputPath,
  );
}

async function saveRevisionWorkbook(
  planId: string,
  workbookPath: string,
  createdBy: string,
) {
  const upload = await uploadWorkbookAndCreateSignedUrl(
    workbookPath,
    createdBy,
  ).catch((error) => {
    console.error(
      "[planWorkspaceService] Workbook upload failed:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  });
  if (upload) {
    await recordPlanFile(planId, upload, createdBy);
  }
  return upload;
}

export async function applyPlanWorkspaceProposal(
  planId: string,
  user: WorkspaceUser,
  input: ApplyPlanProposalInput,
) {
  const plan = await loadAuthorizedPlan(planId, user);
  const currentRevision = await ensureInitialRevision(plan);
  const storedProposal = await getPlanChangeProposal(planId, input.proposalId);
  if (!storedProposal) throw new PlanWorkspaceError(404, "Proposal not found.");
  if (storedProposal.status !== "pending") {
    throw new PlanWorkspaceError(
      409,
      `Proposal is already ${storedProposal.status}.`,
      "proposal_not_pending",
    );
  }
  const proposal = planChangeProposalSchema.parse(storedProposal.proposal);
  if (
    proposal.basedOnRevisionId !== input.basedOnRevisionId ||
    proposal.basedOnRevisionId !== currentRevision.id
  ) {
    throw new PlanWorkspaceError(
      409,
      "This proposal is based on an older revision. Reload the plan before applying it.",
      "revision_conflict",
    );
  }

  if (!input.confirmed) {
    await updatePlanChangeProposalStatus(planId, input.proposalId, "cancelled");
    const systemMessage = await createPlanConversationMessage({
      planId,
      revisionId: currentRevision.id,
      userId: user.id ?? user.username,
      role: "system",
      messageType: "system",
      content: "Proposal cancelled. No plan values were changed.",
      metadata: { proposalId: input.proposalId },
    });
    return { success: true, cancelled: true, systemMessage };
  }

  const nextRevisionNumber = currentRevision.revision_number + 1;
  const workbookMode = normalizeWorkbookMode(plan.workbook_mode);
  const revisedPlan = applyProposalToPlanData(
    asProductionPlan(currentRevision.plan_data),
    proposal,
    nextRevisionNumber,
  );
  const workbookPath = await generateRevisionWorkbook(
    revisedPlan,
    workbookMode,
    nextRevisionNumber,
  );
  const upload = await saveRevisionWorkbook(
    planId,
    workbookPath,
    user.id ?? user.username,
  );
  const newRevision = await createPlanRevision({
    planId,
    revisionNumber: nextRevisionNumber,
    parentRevisionId: currentRevision.id,
    createdBy: user.id ?? user.username,
    createdByRole: user.role,
    revisionSource: user.role === "admin" ? "admin_edit" : "user_modification",
    userInstruction: proposal.requestSummary,
    changeSummary: proposal.requestSummary,
    planData: revisedPlan,
    validationResult: {
      status: "passed",
      validatedAt: new Date().toISOString(),
    },
    workbookMode,
    workbookFilename: upload?.filename ?? path.basename(workbookPath),
    workbookStoragePath: upload?.objectPath ?? null,
    workbookSignedUrl: upload?.signedUrl ?? null,
  });

  await updatePlanFromRevision(planId, plan.project_description, revisedPlan, {
    workbookMode: plan.workbook_mode,
    generationSource: plan.generation_source,
    requestedBy: plan.whatsapp_user_id,
  });
  await updatePlanChangeProposalStatus(
    planId,
    input.proposalId,
    "applied",
    newRevision.id,
  );
  await createPlanConversationMessage({
    planId,
    revisionId: newRevision.id,
    userId: user.id ?? user.username,
    role: "system",
    messageType: "system",
    content: `Revision ${newRevision.revision_number} created and workbook regenerated.`,
    metadata: {
      proposalId: input.proposalId,
      revisionId: newRevision.id,
      workbookFilename: upload?.filename ?? path.basename(workbookPath),
    },
  });

  return {
    success: true,
    revision: newRevision,
    workbook: {
      filename: upload?.filename ?? path.basename(workbookPath),
      signedUrl: upload?.signedUrl ?? null,
      storagePath: upload?.objectPath ?? null,
    },
    workspace: await loadPlanWorkspace(planId, user),
  };
}

export async function comparePlanWorkspaceRevisions(
  planId: string,
  user: WorkspaceUser,
  fromRevisionId: string,
  toRevisionId: string,
) {
  await loadAuthorizedPlan(planId, user);
  const [fromRevision, toRevision] = await Promise.all([
    getPlanRevision(planId, fromRevisionId),
    getPlanRevision(planId, toRevisionId),
  ]);
  if (!fromRevision || !toRevision)
    throw new PlanWorkspaceError(404, "One or both revisions were not found.");
  const fromPlan = asProductionPlan(fromRevision.plan_data);
  const toPlan = asProductionPlan(toRevision.plan_data);
  const fromMetrics = extractPlanWorkspaceMetrics(fromPlan);
  const toMetrics = extractPlanWorkspaceMetrics(toPlan);
  const changes = [
    ["Total target", fromMetrics.totalTarget, toMetrics.totalTarget],
    ["Total hours", fromMetrics.totalHours, toMetrics.totalHours],
    ["Worker count", fromMetrics.teamSize, toMetrics.teamSize],
    ["Working days", fromMetrics.workingDays, toMetrics.workingDays],
    ["Start date", fromMetrics.startDate, toMetrics.startDate],
    ["End date", fromMetrics.endDate, toMetrics.endDate],
  ]
    .filter(([, previous, next]) => previous !== next)
    .map(([label, previousValue, proposedValue]) => ({
      label,
      previousValue,
      proposedValue,
    }));

  return {
    success: true,
    fromRevision,
    toRevision,
    changes,
    summary: changes.length
      ? `${changes.length} tracked value(s) changed between revision ${fromRevision.revision_number} and revision ${toRevision.revision_number}.`
      : "No tracked metric changes were detected between these revisions.",
  };
}

export async function restorePlanWorkspaceRevision(
  planId: string,
  user: WorkspaceUser,
  revisionId: string,
) {
  const plan = await loadAuthorizedPlan(planId, user);
  const currentRevision = await ensureInitialRevision(plan);
  const selectedRevision = await getPlanRevision(planId, revisionId);
  if (!selectedRevision)
    throw new PlanWorkspaceError(404, "Revision not found.");
  const nextRevisionNumber = currentRevision.revision_number + 1;
  const workbookMode = normalizeWorkbookMode(selectedRevision.workbook_mode);
  const restoredPlan = asProductionPlan(selectedRevision.plan_data);
  const workbookPath = await generateRevisionWorkbook(
    restoredPlan,
    workbookMode,
    nextRevisionNumber,
  );
  const upload = await saveRevisionWorkbook(
    planId,
    workbookPath,
    user.id ?? user.username,
  );
  const newRevision = await createPlanRevision({
    planId,
    revisionNumber: nextRevisionNumber,
    parentRevisionId: selectedRevision.id,
    createdBy: user.id ?? user.username,
    createdByRole: user.role,
    revisionSource: "revision_restore",
    userInstruction: `Restore revision ${selectedRevision.revision_number}`,
    changeSummary: `Restored from revision ${selectedRevision.revision_number}.`,
    planData: restoredPlan,
    validationResult: {
      status: "passed",
      restoredAt: new Date().toISOString(),
    },
    workbookMode,
    workbookFilename: upload?.filename ?? path.basename(workbookPath),
    workbookStoragePath: upload?.objectPath ?? null,
    workbookSignedUrl: upload?.signedUrl ?? null,
  });
  await updatePlanFromRevision(planId, plan.project_description, restoredPlan, {
    workbookMode: plan.workbook_mode,
    generationSource: plan.generation_source,
    requestedBy: plan.whatsapp_user_id,
  });
  await createPlanConversationMessage({
    planId,
    revisionId: newRevision.id,
    userId: user.id ?? user.username,
    role: "system",
    messageType: "system",
    content: `Revision ${selectedRevision.revision_number} restored as revision ${newRevision.revision_number}.`,
    metadata: {
      restoredRevisionId: selectedRevision.id,
      newRevisionId: newRevision.id,
    },
  });

  return {
    success: true,
    revision: newRevision,
    workspace: await loadPlanWorkspace(planId, user),
  };
}

export async function deletePlanWorkspaceRevision(
  planId: string,
  user: WorkspaceUser,
  revisionId: string,
) {
  const plan = await loadAuthorizedPlan(planId, user);
  const currentRevision = await ensureInitialRevision(plan);
  if (currentRevision.id === revisionId) {
    throw new PlanWorkspaceError(
      409,
      "The current revision cannot be deleted. Restore another revision first, or delete an older revision.",
      "current_revision_delete_blocked",
    );
  }

  const selectedRevision = await getPlanRevision(planId, revisionId);
  if (!selectedRevision)
    throw new PlanWorkspaceError(404, "Revision not found.");

  await deletePlanRevision(planId, revisionId);
  await createPlanConversationMessage({
    planId,
    revisionId: currentRevision.id,
    userId: user.id ?? user.username,
    role: "system",
    messageType: "system",
    content: `Revision ${selectedRevision.revision_number} deleted from history.`,
    metadata: { deletedRevisionId: selectedRevision.id },
  });

  return {
    success: true,
    deletedRevisionId: revisionId,
    workspace: await loadPlanWorkspace(planId, user),
  };
}

export async function createRevisionWorkbookDownload(fileId: string) {
  return createSignedPlanFileDownload(fileId);
}
