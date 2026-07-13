import type { ProductionPlan, ProductionPlanRow } from "../types/productionPlan.js";
import {
  buildScheduleDates,
  extractRequestedConstraints,
  resolvePlanningSettings,
  type DurationUnit,
  type RequestedConstraints,
  type ResolvedPlanningSettings,
} from "./planningConstraintsService.js";

export interface DynamicPhase {
  name: string;
  objective: string;
}

export interface DynamicRisk {
  risk: string;
  impact: string;
  mitigation: string;
}

export interface DynamicPlanProposal {
  projectName: string;
  client: string;
  totalAssets: number;
  planningSettings: {
    startDate: string;
    durationValue: number;
    durationUnit: DurationUnit;
    weekdaysOnly: boolean;
    totalHours: number;
    teamSize: number;
  };
  assumptions: string[];
  phases: DynamicPhase[];
  risks: DynamicRisk[];
  summary: string;
}

export interface DynamicPlanResult {
  plan: ProductionPlan;
  settings: ResolvedPlanningSettings;
  phases: DynamicPhase[];
  risks: DynamicRisk[];
}

const DYNAMIC_COLUMNS = [
  "No.",
  "Date",
  "Month",
  "Day",
  "Target Active Annotators",
  "Target Total Hours",
  "Target Total Hours per Annotator",
  "Actual Active Annotators",
  "Actual Total Hours",
  "Actual Total Hours per Annotator",
  "Target Hours",
  "Actual Hours",
  "Total Variance",
  "Completion Rate (%)",
  "Status",
  "Notes",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

export function buildDynamicPrompt(projectDescription: string, currentDate: string): string {
  const requested = extractRequestedConstraints(projectDescription, currentDate);
  return `/no_think
You are a senior production planning manager. Propose the context for a professional, template-free production plan. Application code will create the detailed dates, hour allocation, formulas, and Excel formatting.

CURRENT DATE
${currentDate}

USER REQUEST
${projectDescription}

DETERMINISTICALLY EXTRACTED CONSTRAINTS
${JSON.stringify(requested, null, 2)}

Rules:
- Preserve every extracted constraint exactly.
- If a value was not extracted, choose a conservative realistic default.
- Never use a start date earlier than the current date.
- durationUnit must be days, weeks, or months.
- teamSize and durationValue must be positive whole numbers.
- totalHours must be positive.
- Provide practical phases, risks, mitigations, and assumptions specific to the request.
- Natural-language dates have already been normalized when possible; use those ISO values.
- Do not create daily schedule rows. The application creates those deterministically.

Return only valid JSON matching this structure:
{
  "projectName": "string",
  "client": "string or empty string",
  "totalAssets": 0,
  "planningSettings": {
    "startDate": "YYYY-MM-DD",
    "durationValue": 30,
    "durationUnit": "days",
    "weekdaysOnly": true,
    "totalHours": 160,
    "teamSize": 1
  },
  "assumptions": ["string"],
  "phases": [{ "name": "string", "objective": "string" }],
  "risks": [{ "risk": "string", "impact": "string", "mitigation": "string" }],
  "summary": "string"
}`;
}

export function validateDynamicProposal(value: unknown, currentDate: string): DynamicPlanProposal {
  if (!isRecord(value)) throw new Error("Dynamic plan proposal must be an object");
  const rawSettings = isRecord(value.planningSettings) ? value.planningSettings : {};
  const unit = rawSettings.durationUnit;
  const durationUnit: DurationUnit = unit === "weeks" || unit === "months" ? unit : "days";
  const phases = Array.isArray(value.phases)
    ? value.phases.filter(isRecord).map((phase) => ({
        name: text(phase.name, "Delivery phase"),
        objective: text(phase.objective, "Complete the planned production work."),
      }))
    : [];
  const risks = Array.isArray(value.risks)
    ? value.risks.filter(isRecord).map((risk) => ({
        risk: text(risk.risk, "Delivery risk"),
        impact: text(risk.impact, "May affect schedule or quality."),
        mitigation: text(risk.mitigation, "Monitor and address promptly."),
      }))
    : [];

  return {
    projectName: text(value.projectName, "Production Plan"),
    client: text(value.client),
    totalAssets: number(value.totalAssets, 0),
    planningSettings: {
      startDate: text(rawSettings.startDate, currentDate),
      durationValue: Math.round(number(rawSettings.durationValue, 30)),
      durationUnit,
      weekdaysOnly: typeof rawSettings.weekdaysOnly === "boolean" ? rawSettings.weekdaysOnly : true,
      totalHours: number(rawSettings.totalHours, 160),
      teamSize: Math.round(number(rawSettings.teamSize, 1)),
    },
    assumptions: stringArray(value.assumptions),
    phases: phases.length ? phases : [{ name: "Production", objective: "Complete planned work." }],
    risks,
    summary: text(value.summary, "A structured production plan with auditable targets."),
  };
}

function monthName(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function distributeHours(totalHours: number, rowCount: number): number[] {
  const totalHundredths = Math.round(totalHours * 100);
  const base = Math.floor(totalHundredths / rowCount);
  const remainder = totalHundredths - base * rowCount;
  return Array.from({ length: rowCount }, (_, index) =>
    (base + (index < remainder ? 1 : 0)) / 100,
  );
}

function projectKind(description: string, requested: RequestedConstraints): string {
  if (requested.projectType) return requested.projectType;
  if (/\bonboarding|new hires?|employees?\b/i.test(description)) return "onboarding";
  if (/\bannotat(?:e|ion|ors?)|label(?:ing|lers?)\b/i.test(description)) return "annotation";
  if (/\bdata\s+encoding|encode|encoder\b/i.test(description)) return "data encoding";
  if (/\bresearch|study|survey\b/i.test(description)) return "research";
  if (/\bvalidation|validate|verification\b/i.test(description)) return "validation";
  return "production";
}

function defaultPhases(kind: string): DynamicPhase[] {
  if (kind === "onboarding") {
    return [
      { name: "Preparation", objective: "Confirm role expectations, materials, access, and onboarding schedule." },
      { name: "Orientation", objective: "Introduce company context, tools, policies, and team workflows." },
      { name: "Role Training", objective: "Complete guided training and supervised practice." },
      { name: "Shadowing", objective: "Pair new employees with experienced staff for applied work." },
      { name: "Readiness Review", objective: "Review progress, close gaps, and approve handoff to regular operations." },
    ];
  }
  if (kind === "annotation") {
    return [
      { name: "Guideline Setup", objective: "Finalize annotation rules, examples, and acceptance criteria." },
      { name: "Pilot Annotation", objective: "Run a small batch to calibrate annotators and detect ambiguity." },
      { name: "Production Annotation", objective: "Complete the main annotation workload at target throughput." },
      { name: "QA Sampling", objective: "Sample completed work and resolve quality issues." },
      { name: "Review & Delivery", objective: "Review metrics, apply corrections, and package outputs." },
    ];
  }
  if (kind === "data encoding") {
    return [
      { name: "Batch Preparation", objective: "Prepare source files, rules, and batch assignments." },
      { name: "Encoding Production", objective: "Encode planned batches with daily target tracking." },
      { name: "Validation", objective: "Validate encoded records against source data and rules." },
      { name: "Corrections", objective: "Fix exceptions and recheck corrected items." },
      { name: "Final Checking", objective: "Confirm completion, quality, and handoff readiness." },
    ];
  }
  if (kind === "research") {
    return [
      { name: "Preparation", objective: "Confirm scope, research questions, sources, and workplan." },
      { name: "Data Collection", objective: "Collect inputs and maintain traceable research notes." },
      { name: "Validation", objective: "Cross-check evidence, assumptions, and source quality." },
      { name: "Reporting", objective: "Synthesize findings into the required deliverables." },
      { name: "Final Review", objective: "Review outputs, resolve gaps, and finalize the package." },
    ];
  }
  if (kind === "validation") {
    return [
      { name: "Intake", objective: "Confirm scope, validation rules, and source availability." },
      { name: "Validation Pass", objective: "Complete the primary validation workload." },
      { name: "Exception Review", objective: "Investigate exceptions and clarify edge cases." },
      { name: "Corrections", objective: "Apply accepted corrections and recheck affected records." },
      { name: "Signoff", objective: "Summarize findings and approve completion." },
    ];
  }
  return [
    { name: "Mobilization", objective: "Prepare resources, inputs, and delivery controls." },
    { name: "Production", objective: "Complete the planned work at sustainable daily targets." },
    { name: "QA Review", objective: "Check quality and correct exceptions before closure." },
    { name: "Buffer", objective: "Absorb slippage and complete remaining items." },
    { name: "Closure", objective: "Confirm completion and summarize results." },
  ];
}

function choosePhases(
  description: string,
  proposalPhases: DynamicPhase[],
  requested: RequestedConstraints,
): DynamicPhase[] {
  const kind = projectKind(description, requested);
  const specific = defaultPhases(kind);
  if (proposalPhases.length < 3 || kind !== "production") return specific;
  return proposalPhases;
}

function phaseForIndex(phases: DynamicPhase[], index: number, total: number): DynamicPhase {
  const phaseIndex = Math.min(
    phases.length - 1,
    Math.floor((index / Math.max(total, 1)) * phases.length),
  );
  return phases[phaseIndex] ?? phases[0]!;
}

function taskFor(kind: string, phase: DynamicPhase, requested: RequestedConstraints): string {
  if (kind === "onboarding") return `${phase.name} checkpoint for employee onboarding`;
  if (kind === "annotation") {
    return phase.name.includes("QA") ? "QA sample and adjudicate annotation output" : `${phase.name} batch annotation`;
  }
  if (kind === "data encoding") {
    return phase.name.includes("Validation") || phase.name.includes("Checking")
      ? "Validate encoded records and resolve exceptions"
      : `${phase.name} encoding batch`;
  }
  if (kind === "research") return `${phase.name} research deliverable`;
  if (kind === "validation") return `${phase.name} validation workload`;
  if (requested.needsQa && /qa|review/i.test(phase.name)) return "Quality check and review";
  return `${phase.name} work package`;
}

function groupWeeks(rows: ProductionPlanRow[]): ProductionPlanRow[] {
  const weeks: ProductionPlanRow[] = [];
  for (let index = 0; index < rows.length; index += 5) {
    const chunk = rows.slice(index, index + 5);
    const plannedHours = chunk.reduce((sum, row) => sum + Number(row["Target Total Hours"]), 0);
    weeks.push({
      Week: weeks.length + 1,
      "Start Date": String(chunk[0]?.Date ?? ""),
      "End Date": String(chunk.at(-1)?.Date ?? ""),
      "Planned Hours": Number(plannedHours.toFixed(2)),
      Focus: String(chunk[0]?.Notes ?? "Production"),
      "Review Checkpoint": weeks.length % 2 === 1 ? "Progress review and issue clearing" : "Team lead check-in",
    });
  }
  return weeks;
}

function buildSupportSheets(
  planRows: ProductionPlanRow[],
  phases: DynamicPhase[],
  risks: DynamicRisk[],
  settings: ResolvedPlanningSettings,
  requested: RequestedConstraints,
  kind: string,
): Array<{ sheetName: string; columns: string[]; rows: ProductionPlanRow[] }> {
  const weeklyRows = groupWeeks(planRows);
  const perResourceHours = Number((settings.totalHours / settings.teamSize).toFixed(2));
  const resources = Array.from({ length: settings.teamSize }, (_, index) => ({
    Resource: `Resource ${index + 1}`,
    Role: kind === "annotation" ? "Annotator" : kind === "onboarding" ? "Employee / Buddy" : "Production resource",
    "Planned Hours": perResourceHours,
    "Primary Focus": phases[index % phases.length]?.name ?? "Production",
    Notes: settings.weekdaysOnly ? "Weekday allocation" : "Calendar-day allocation",
  }));
  const milestoneRows = phases.map((phase, index) => {
    const dateIndex = Math.min(
      planRows.length - 1,
      Math.round(((index + 1) / phases.length) * planRows.length) - 1,
    );
    return {
      Milestone: `${phase.name} complete`,
      "Target Date": String(planRows[dateIndex]?.Date ?? planRows.at(-1)?.Date ?? ""),
      Owner: index === phases.length - 1 ? "Project lead" : `Resource ${(index % settings.teamSize) + 1}`,
      Dependency: index === 0 ? "Inputs confirmed" : `${phases[index - 1]?.name} complete`,
      "Acceptance Check": phase.objective,
    };
  });
  const qaRows = weeklyRows.map((row, index) => ({
    Checkpoint: index === weeklyRows.length - 1 ? "Final review" : `Week ${row.Week} quality review`,
    Date: row["End Date"],
    Scope: requested.needsQa || kind === "annotation"
      ? "QA sample, findings review, and correction queue"
      : "Progress review, blockers, and output completeness",
    Owner: "Project lead",
    Criteria: kind === "onboarding"
      ? "Readiness evidence, feedback, and action items are recorded"
      : "Output meets agreed rules before continuing",
  }));
  const riskRows: ProductionPlanRow[] = [
    ...risks.map((risk) => ({
      Type: "Risk",
      Item: risk.risk,
      Impact: risk.impact,
      "Mitigation / Note": risk.mitigation,
    })),
    {
      Type: "Assumption",
      Item: settings.weekdaysOnly ? "Weekends excluded" : "Weekend work allowed",
      Impact: "Controls available workdays and daily target hours",
      "Mitigation / Note": "Schedule generated from normalized planning constraints.",
    },
  ];

  return [
    {
      sheetName: "Weekly Schedule",
      columns: ["Week", "Start Date", "End Date", "Planned Hours", "Focus", "Review Checkpoint"],
      rows: weeklyRows,
    },
    {
      sheetName: "Resource Allocation",
      columns: ["Resource", "Role", "Planned Hours", "Primary Focus", "Notes"],
      rows: resources,
    },
    {
      sheetName: "Milestones",
      columns: ["Milestone", "Target Date", "Owner", "Dependency", "Acceptance Check"],
      rows: milestoneRows,
    },
    {
      sheetName: "QA Review",
      columns: ["Checkpoint", "Date", "Scope", "Owner", "Criteria"],
      rows: qaRows,
    },
    {
      sheetName: "Risks and Assumptions",
      columns: ["Type", "Item", "Impact", "Mitigation / Note"],
      rows: riskRows,
    },
    {
      sheetName: "Progress Tracker",
      columns: ["Period", "Planned Hours", "Actual Hours", "Variance", "Completion %", "Status", "Notes"],
      rows: weeklyRows.map((row) => ({
        Period: `Week ${row.Week}`,
        "Planned Hours": row["Planned Hours"],
        "Actual Hours": "",
        Variance: "",
        "Completion %": "",
        Status: "Not Started",
        Notes: "",
      })),
    },
    {
      sheetName: "Summary",
      columns: ["Metric", "Value"],
      rows: [
        { Metric: "Project type", Value: kind },
        { Metric: "Start date", Value: settings.startDate },
        { Metric: "End date", Value: String(planRows.at(-1)?.Date ?? "") },
        { Metric: "Total planned hours", Value: settings.totalHours },
        { Metric: "Team size", Value: settings.teamSize },
        { Metric: "Schedule mode", Value: settings.weekdaysOnly ? "Weekdays only" : "Calendar days" },
      ],
    },
  ];
}

export function buildDynamicPlan(
  input: { projectDescription: string },
  proposal: DynamicPlanProposal,
  currentDate: string,
): DynamicPlanResult {
  const settings = resolvePlanningSettings(input.projectDescription, currentDate, proposal.planningSettings);
  const dates = buildScheduleDates(settings);
  const hours = distributeHours(settings.totalHours, dates.length);
  const requested = extractRequestedConstraints(input.projectDescription, currentDate);
  const kind = projectKind(input.projectDescription, requested);
  const phases = choosePhases(input.projectDescription, proposal.phases, requested);
  const rows: ProductionPlanRow[] = dates.map((date, index) => ({
    "No.": index + 1,
    Date: date,
    Month: monthName(date),
    Day: new Date(`${date}T00:00:00Z`).toLocaleString("en-US", { weekday: "short", timeZone: "UTC" }),
    "Target Active Annotators": settings.teamSize,
    "Target Total Hours": hours[index]!,
    "Target Total Hours per Annotator": Number((hours[index]! / settings.teamSize).toFixed(2)),
    "Actual Active Annotators": "",
    "Actual Total Hours": "",
    "Actual Total Hours per Annotator": "",
    "Target Hours": hours[index]!,
    "Actual Hours": "",
    "Total Variance": "",
    "Completion Rate (%)": "",
    Status: "Not Started",
    Notes: taskFor(kind, phaseForIndex(phases, index, dates.length), requested),
  }));

  const assumptions = [
    ...proposal.assumptions,
    `${settings.weekdaysOnly ? "Weekdays only" : "Calendar days"} scheduling was used.`,
    `Total target hours are distributed across ${dates.length} scheduled days.`,
    ...((requested.dateInterpretations ?? []).map(
      (item) => `Interpreted "${item.source}" as ${item.normalized}.`,
    )),
  ];
  const supportSheets = buildSupportSheets(rows, phases, proposal.risks, settings, requested, kind);
  const plan: ProductionPlan = {
    project: {
      projectName: proposal.projectName,
      projectDescription: input.projectDescription,
      client: proposal.client,
      startDate: dates[0]!,
      deadline: dates.at(-1)!,
      totalAssets: proposal.totalAssets,
      assumptions,
    },
    workbook: {
      sheets: [
        { sheetName: "Production Plan", columns: DYNAMIC_COLUMNS, rows },
        ...supportSheets,
      ],
    },
    summary: proposal.summary,
  };
  return { plan, settings, phases, risks: proposal.risks };
}
