import type { ProductionPlan, ProductionPlanRow } from "../types/productionPlan.js";
import {
  buildScheduleDates,
  extractRequestedConstraints,
  resolvePlanningSettings,
  type DurationUnit,
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
  const requested = extractRequestedConstraints(projectDescription);
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

export function buildDynamicPlan(
  input: { projectDescription: string },
  proposal: DynamicPlanProposal,
  currentDate: string,
): DynamicPlanResult {
  const settings = resolvePlanningSettings(input.projectDescription, currentDate, proposal.planningSettings);
  const dates = buildScheduleDates(settings);
  const hours = distributeHours(settings.totalHours, dates.length);
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
    Notes: "",
  }));

  const assumptions = [
    ...proposal.assumptions,
    `${settings.weekdaysOnly ? "Weekdays only" : "Calendar days"} scheduling was used.`,
    `Total target hours are distributed across ${dates.length} scheduled days.`,
  ];
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
      sheets: [{ sheetName: "Production Plan", columns: DYNAMIC_COLUMNS, rows }],
    },
    summary: proposal.summary,
  };
  return { plan, settings, phases: proposal.phases, risks: proposal.risks };
}
