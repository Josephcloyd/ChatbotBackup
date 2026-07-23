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
    /** Working hours per person per day (default 8). */
    hoursPerDay?: number;
    /** AI-proposed throughput in units per person per hour (only for quantity plans). */
    throughputRate?: number;
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
  /** Capitalized unit label when quantity profile is active (e.g. "Images"). Undefined for hour plans. */
  unitLabel?: string;
  /** Total planned quantity for quantity-profile plans. */
  totalQuantity?: number;
  /** Throughput rate used for quantity plans (units per person per hour). */
  throughputRate?: number;
  /** Working hours per person per day used in scheduling. */
  hoursPerDay?: number;
}

// Hour-based column profile (default — unchanged from original).
const HOUR_COLUMNS = [
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

/** Quantity-based column profile (images, records, etc.).
 *  Positions 6-10 use the named unit; positions 11-12 keep hours for capacity reference. */
function buildQuantityColumns(unitLabel: string): string[] {
  return [
    "No.", "Date", "Month", "Day",
    "Target Active Annotators",
    `Target ${unitLabel}`,
    `Target ${unitLabel} per Annotator`,
    "Actual Active Annotators",
    `Actual ${unitLabel}`,
    `Actual ${unitLabel} per Annotator`,
    "Target Hours",   // capacity reference — kept for Excel formula compat
    "Actual Hours",
    "Total Variance",
    "Completion Rate (%)",
    "Status",
    "Notes",
  ];
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Returns the column list and metadata for the active profile. */
function selectColumnProfile(
  unitOfMeasure: string | undefined,
): { columns: string[]; isQuantity: boolean; unitLabel: string } {
  if (unitOfMeasure && unitOfMeasure !== "hours") {
    const unitLabel = capitalize(unitOfMeasure);
    return { columns: buildQuantityColumns(unitLabel), isQuantity: true, unitLabel };
  }
  return { columns: HOUR_COLUMNS, isQuantity: false, unitLabel: "Hours" };
}

/** Distribute an integer quantity evenly across N days. Sum is exact. */
function distributeQuantity(total: number, count: number): number[] {
  const rounded = Math.round(total);
  const base = Math.floor(rounded / count);
  const extra = rounded - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

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
  const isQuantityPlan = requested.unitOfMeasure !== undefined && requested.unitOfMeasure !== "hours";

  // Precompute conditional sections to avoid invalid newlines inside string literals.
  const quantityRule = isQuantityPlan
    ? `- This is a QUANTITY-based plan (unit: ${requested.unitOfMeasure}). Propose a realistic throughputRate: the number of ${requested.unitOfMeasure} one person can produce per working hour. Base it on typical industry rates for this kind of work.\n`
    : "";
  const throughputField = isQuantityPlan ? ',\n    "throughputRate": 50' : "";

  return `/no_think
You are an expert production-planning consultant and operations analyst. Propose the context for a professional, fully dynamic, template-free production plan. Application code will create the detailed dates, workload allocation, capacity formulas, validation, and Excel formatting.

Planning date: ${currentDate}

CURRENT DATE
${currentDate}

USER REQUEST
${projectDescription}

DETERMINISTICALLY EXTRACTED CONSTRAINTS
${JSON.stringify(requested, null, 2)}

Rules:
- Preserve every extracted constraint exactly.
- You are a production planning AI. You do not simply generate schedules. You help the backend calculate feasibility, enforce dependencies, preserve actual progress, forecast completion, compare scenarios, and recommend the most realistic plan.
- Always validate the plan before presenting it; application code performs deterministic validation after your proposal.
- Never allow downstream work to exceed upstream completed work.
- Never restart an active project unless the user explicitly asks for a new plan.
- Never ignore staffing changes, leave, training, holidays, overtime limits, or labor budget constraints.
- If the plan is infeasible, make sure assumptions expose why in measurable terms.
- If multiple solutions are possible, provide enough context for the backend to compare and recommend the best option.
- Always separate planned values, actual values, and revised forecast values.
- Always support structured output that can be used for Excel workbook generation.
- If a value was not extracted, choose a conservative realistic default.
- Adapt to the project category. Do not force annotation language onto software, document-processing, manufacturing, content, support, training, logistics, or admin projects.
- Preserve the production unit from the request when present (images, records, documents, features, modules, tickets, articles, videos, batches, units, participants, transactions, hours, or tasks).
- If the user names a planning or operating model such as LPB Model, preserve it as an explicit assumption and align phases/risks with that model when safely possible.
- Separate confirmed facts from assumptions.
- Include quality-control work as real effort; do not treat review as free.
- Propose workflow phases, risks, and assumptions specific to the project domain.
- Include project-specific KPIs and chart ideas in the summary/assumptions when useful; application code will create workbook datasets.
- Never use a start date earlier than the current date.
- durationUnit must be days, weeks, or months.
- teamSize and durationValue must be positive whole numbers.
- totalHours must be positive.
- hoursPerDay is the working hours per person per day (almost always 8).
- Provide practical phases, risks, mitigations, and assumptions specific to the request.
- Natural-language dates have already been normalized when possible; use those ISO values.
- Do not create daily schedule rows. The application creates those deterministically.
- Return structured JSON only. No markdown, comments, or extra prose.
${quantityRule}

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
    "teamSize": 1,
    "hoursPerDay": 8${throughputField}
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
      hoursPerDay: typeof rawSettings.hoursPerDay === "number" && rawSettings.hoursPerDay > 0
        ? rawSettings.hoursPerDay : undefined,
      throughputRate: typeof rawSettings.throughputRate === "number" && rawSettings.throughputRate > 0
        ? rawSettings.throughputRate : undefined,
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
  if (/\b(?:capture|collection|collect|text\s+capture|data\s+collection)\b/i.test(description)) return "data collection";
  if (/\b(?:software|app|application|dashboard|website|web\s+site|web\s+development|hris|system|feature|module|developers?)\b/i.test(description)) return "software development";
  if (/\b(?:receipt|invoice|document|ocr|forms?|pages?|manual\s+verification|document\s+processing)\b/i.test(description)) return "document processing";
  if (/\b(?:manufactur(?:e|ing)|machines?|factory|assembly|units?|production\s+line)\b/i.test(description)) return "manufacturing";
  if (/\b(?:content|articles?|posts?|social\s+media|marketing|campaign|videos?|media\s+production)\b/i.test(description)) return "content production";
  if (/\b(?:customer\s+support|tickets?|service\s+desk|helpdesk|calls?|cases?)\b/i.test(description)) return "customer support";
  if (/\b(?:training|workshop|participants?|learners?|curriculum)\b/i.test(description)) return "training";
  if (/\b(?:event|venue|logistics|inventory|shipments?|stock|batches?)\b/i.test(description)) return "operations";
  if (/\bonboarding|new hires?\b/i.test(description)) return "onboarding";
  if (/\bannotat(?:e|ion|ors?)|label(?:ing|lers?)\b/i.test(description)) return "annotation";
  if (/\bdata\s+encoding|encode|encoder|enrollment\s+records?\b/i.test(description)) return "data encoding";
  if (/\bresearch|study|survey\b/i.test(description)) return "research";
  if (/\bvalidation|validate|verification\b/i.test(description)) return "validation";
  return "production";
}

function defaultPhases(kind: string): DynamicPhase[] {
  if (kind === "data collection") {
    return [
      { name: "Collection Design", objective: "Confirm capture rules, image requirements, naming conventions, and acceptance criteria." },
      { name: "Source Preparation", objective: "Prepare collection sources, tools, access, and operator instructions." },
      { name: "Pilot Collection", objective: "Collect a small batch to confirm image quality and throughput." },
      { name: "Main Collection", objective: "Collect planned images at target pace with traceable batches." },
      { name: "Quality Review & Handoff", objective: "Review collected images, resolve rejected items, and package accepted output." },
    ];
  }
  if (kind === "software development") {
    return [
      { name: "Requirements & Backlog", objective: "Confirm goals, users, acceptance criteria, and prioritized scope." },
      { name: "Solution Design", objective: "Design architecture, data flow, interfaces, and implementation plan." },
      { name: "Build", objective: "Implement features in usable increments with code review." },
      { name: "Testing & QA", objective: "Run functional, integration, and acceptance tests; fix defects." },
      { name: "Deployment & Handoff", objective: "Release the solution, document usage, and close handoff items." },
    ];
  }
  if (kind === "document processing") {
    return [
      { name: "Document Intake", objective: "Receive, classify, and prepare source documents or images." },
      { name: "OCR / Extraction", objective: "Extract target fields using OCR or structured entry." },
      { name: "Manual Verification", objective: "Verify extracted data against source documents." },
      { name: "Exception Rework", objective: "Resolve unreadable, duplicate, or inconsistent records." },
      { name: "Final Export", objective: "Validate totals and deliver clean output files." },
    ];
  }
  if (kind === "manufacturing") {
    return [
      { name: "Materials & Setup", objective: "Confirm materials, machine readiness, and production parameters." },
      { name: "Pilot Run", objective: "Produce a small batch to confirm quality and throughput." },
      { name: "Main Production", objective: "Produce planned units at target cycle time." },
      { name: "Inspection & Rework", objective: "Inspect output, isolate defects, and rework where feasible." },
      { name: "Packaging & Delivery", objective: "Package, count, and release finished units." },
    ];
  }
  if (kind === "content production") {
    return [
      { name: "Content Planning", objective: "Define topics, channels, calendar, and approval criteria." },
      { name: "Draft Production", objective: "Produce planned content assets in batches." },
      { name: "Editorial Review", objective: "Review, revise, and approve content for publication." },
      { name: "Publishing Prep", objective: "Prepare final assets, captions, metadata, and schedule." },
      { name: "Reporting", objective: "Track output, quality, and campaign performance indicators." },
    ];
  }
  if (kind === "customer support") {
    return [
      { name: "Queue Setup", objective: "Confirm ticket categories, SLAs, ownership, and escalation rules." },
      { name: "Triage", objective: "Classify incoming work and prioritize urgent cases." },
      { name: "Resolution", objective: "Resolve tickets or route them to the correct owner." },
      { name: "Quality Review", objective: "Review sampled responses and coaching opportunities." },
      { name: "SLA Reporting", objective: "Report completion, backlog, and service-quality metrics." },
    ];
  }
  if (kind === "training") {
    return [
      { name: "Training Design", objective: "Define learning goals, materials, participants, and schedule." },
      { name: "Preparation", objective: "Prepare facilitators, tools, rooms, and participant communications." },
      { name: "Delivery", objective: "Run training sessions and track attendance." },
      { name: "Assessment", objective: "Evaluate learning outcomes and collect feedback." },
      { name: "Closeout", objective: "Summarize completion, gaps, and follow-up actions." },
    ];
  }
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
    { name: "Recording", objective: "Capture or produce the primary work items with traceable daily batches." },
    { name: "Validation", objective: "Validate upstream output before it is released to quality review." },
    { name: "QA", objective: "Perform quality assurance, exception handling, and correction checks." },
    { name: "Delivery", objective: "Package accepted output, verify totals, and complete client handoff." },
  ];
}

function roleForKind(kind: string): string {
  if (kind === "data collection") return "Collection operator";
  if (kind === "software development") return "Delivery team";
  if (kind === "document processing") return "Processing operator";
  if (kind === "manufacturing") return "Machine/operator";
  if (kind === "content production") return "Content producer";
  if (kind === "customer support") return "Support agent";
  if (kind === "training") return "Facilitator";
  if (kind === "annotation") return "Annotator";
  if (kind === "data encoding") return "Encoder";
  if (kind === "research") return "Researcher";
  if (kind === "validation") return "Validator";
  return "Production resource";
}

function defaultRisks(kind: string): DynamicRisk[] {
  const common = { impact: "MEDIUM", mitigation: "Track progress daily and escalate blockers early." };
  if (kind === "data collection") {
    return [
      { risk: "Collected images may fail quality, duplication, or naming requirements.", impact: "HIGH", mitigation: "Run pilot review and enforce batch-level QC before scaling collection." },
      { risk: "Source availability may limit daily collection volume.", impact: "MEDIUM", mitigation: "Prepare alternate sources and track accepted images separately from raw captures." },
    ];
  }
  if (kind === "software development") {
    return [
      { risk: "Scope changes may expand the backlog beyond planned capacity.", impact: "HIGH", mitigation: "Freeze priority scope and route changes through backlog triage." },
      { risk: "Integration defects may appear late in testing.", impact: "HIGH", mitigation: "Schedule early integration checks and reserve rework capacity." },
    ];
  }
  if (kind === "document processing") {
    return [
      { risk: "Poor scan quality may slow OCR and manual verification.", impact: "HIGH", mitigation: "Separate low-quality documents into an exception queue." },
      { risk: "Duplicate or missing documents may distort completion counts.", impact: "MEDIUM", mitigation: "Use intake reconciliation before final export." },
    ];
  }
  if (kind === "manufacturing") {
    return [
      { risk: "Machine downtime may reduce daily output.", impact: "HIGH", mitigation: "Confirm preventive maintenance and backup production options." },
      { risk: "Defects may require rework or scrap.", impact: "HIGH", mitigation: "Run pilot inspection and monitor defect rate by batch." },
    ];
  }
  if (kind === "content production") {
    return [
      { risk: "Approval delays may block publishing.", impact: "MEDIUM", mitigation: "Set review deadlines and approve templates early." },
      { risk: "Content quality may vary across producers.", impact: "MEDIUM", mitigation: "Use editorial standards and sample review." },
    ];
  }
  return [
    { risk: "Actual productivity may differ from planning assumptions.", ...common },
    { risk: "Quality findings may require rework near the deadline.", impact: "HIGH", mitigation: "Reserve explicit review and correction time." },
  ];
}

function feasibilityStatus(requiredHours: number, availableHours: number, assumedRate: boolean): string {
  if (!Number.isFinite(availableHours) || availableHours <= 0) return "INSUFFICIENT_DATA";
  const utilization = requiredHours / availableHours;
  if (utilization > 1) return "NOT_FEASIBLE";
  if (utilization >= 0.85 || assumedRate) return "FEASIBLE_WITH_RISK";
  return "FEASIBLE";
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

function groupWeeks(
  rows: ProductionPlanRow[],
  targetColumn = "Target Total Hours",
  volumeKey = "Planned Hours",
): ProductionPlanRow[] {
  const weeks: ProductionPlanRow[] = [];
  for (let index = 0; index < rows.length; index += 5) {
    const chunk = rows.slice(index, index + 5);
    const plannedVolume = chunk.reduce((sum, row) => sum + Number(row[targetColumn] ?? 0), 0);
    weeks.push({
      Week: weeks.length + 1,
      "Start Date": String(chunk[0]?.Date ?? ""),
      "End Date": String(chunk.at(-1)?.Date ?? ""),
      [volumeKey]: Number(plannedVolume.toFixed(2)),
      Focus: String(chunk[0]?.Notes ?? "Production"),
      "Review Checkpoint": weeks.length % 2 === 1 ? "Progress review and issue clearing" : "Team lead check-in",
    });
  }
  return weeks;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function safeDate(value: ProductionPlanRow | undefined): string {
  return String(value?.Date ?? "");
}

function scheduledDay(date: Date, settings: ResolvedPlanningSettings): boolean {
  const iso = date.toISOString().slice(0, 10);
  if (settings.holidays?.includes(iso)) return false;
  if (settings.workingDays?.length) return settings.workingDays.includes(date.getUTCDay());
  const day = date.getUTCDay();
  return !settings.weekdaysOnly || (day >= 1 && day <= 5);
}

function addScheduledDays(startDate: string, additionalDays: number, settings: ResolvedPlanningSettings): string {
  if (additionalDays <= 0) return startDate;
  const cursor = new Date(`${startDate}T00:00:00Z`);
  let counted = 0;
  while (counted < additionalDays) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (scheduledDay(cursor, settings)) counted += 1;
  }
  return cursor.toISOString().slice(0, 10);
}

interface StaffingChangeAnalysis {
  isReplan: boolean;
  effectiveMonth: number;
  effectiveDate: string;
  effectiveIndex: number;
  removedEmployees: number;
  addedJuniorEmployees: number;
  addedExperiencedEmployees: number;
  originalHeadcount: number;
  revisedHeadcount: number;
  effectiveStaffingUnits: number;
  completedRows: ProductionPlanRow[];
  remainingRows: ProductionPlanRow[];
  staffingRows: ProductionPlanRow[];
}

function analyzeStaffingChanges(
  description: string,
  rows: ProductionPlanRow[],
  settings: ResolvedPlanningSettings,
): StaffingChangeAnalysis {
  const effectiveMonth = Number(description.match(/\bmonth\s+(\d{1,2})\b/i)?.[1] ?? 1);
  const removedEmployees = Number(description.match(/\bremove\s+(\d+)\s+(?:employees?|staff|people|workers?|annotators?|recorders?)\b/i)?.[1] ?? 0);
  const addedJuniorEmployees = Number(description.match(/\badd\s+(\d+)\s+(?:new\s+)?junior\s+(?:employees?|staff|people|workers?|annotators?|recorders?)\b/i)?.[1] ?? 0);
  const addedExperiencedEmployees = Number(
    description.match(/\badd\s+(\d+)\s+(?:new\s+)?(?:experienced|senior|regular)\s+(?:employees?|staff|people|workers?|annotators?|recorders?)\b/i)?.[1] ?? 0,
  );
  const isReplan = /\b(?:recalculate|replan|remaining|during\s+month|staffing\s+changes?|actual\s+progress|already\s+started|in\s+progress)\b/i.test(description) ||
    removedEmployees > 0 ||
    addedJuniorEmployees > 0 ||
    addedExperiencedEmployees > 0;
  const originalHeadcount = settings.teamSize;
  const revisedHeadcount = Math.max(1, originalHeadcount - removedEmployees + addedJuniorEmployees + addedExperiencedEmployees);
  const effectiveStaffingUnits = Math.max(
    0.25,
    originalHeadcount - removedEmployees + addedExperiencedEmployees + addedJuniorEmployees * 0.65,
  );

  let effectiveIndex = 0;
  if (isReplan && rows.length > 0) {
    const firstDate = new Date(`${safeDate(rows[0])}T00:00:00Z`);
    effectiveIndex = rows.findIndex((row) => {
      const date = new Date(`${safeDate(row)}T00:00:00Z`);
      const monthOffset = (date.getUTCFullYear() - firstDate.getUTCFullYear()) * 12 +
        date.getUTCMonth() - firstDate.getUTCMonth() + 1;
      return monthOffset >= Math.max(1, effectiveMonth);
    });
    if (effectiveIndex < 0) {
      effectiveIndex = Math.min(rows.length - 1, Math.floor(((Math.max(1, effectiveMonth) - 1) / 6) * rows.length));
    }
  }

  const completedRows = isReplan ? rows.slice(0, effectiveIndex) : [];
  const remainingRows = isReplan ? rows.slice(effectiveIndex) : rows;
  const effectiveDate = safeDate(rows[effectiveIndex]) || settings.startDate;
  const staffingRows: ProductionPlanRow[] = isReplan
    ? [
        {
          "Effective Date": settings.startDate,
          Change: "Original staffing baseline",
          "Removed Employees": 0,
          "Added Junior Employees": 0,
          "Added Experienced Employees": 0,
          "Planned Headcount": originalHeadcount,
          "Effective Capacity Units": originalHeadcount,
          Reason: "Original production plan",
        },
        {
          "Effective Date": effectiveDate,
          Change: "Revised staffing after reported change",
          "Removed Employees": removedEmployees,
          "Added Junior Employees": addedJuniorEmployees,
          "Added Experienced Employees": addedExperiencedEmployees,
          "Planned Headcount": revisedHeadcount,
          "Effective Capacity Units": round2(effectiveStaffingUnits),
          Reason: removedEmployees > 0 ? "Leave / staffing reduction" : "Staffing update",
        },
      ]
    : [];

  return {
    isReplan,
    effectiveMonth: Math.max(1, effectiveMonth),
    effectiveDate,
    effectiveIndex,
    removedEmployees,
    addedJuniorEmployees,
    addedExperiencedEmployees,
    originalHeadcount,
    revisedHeadcount,
    effectiveStaffingUnits,
    completedRows,
    remainingRows,
    staffingRows,
  };
}

function buildForecast(
  rows: ProductionPlanRow[],
  targetColumn: string,
  settings: ResolvedPlanningSettings,
  staffing: StaffingChangeAnalysis,
  hoursPerDay: number,
): {
  rows: ProductionPlanRow[];
  revisedCompletionDate: string;
  scheduleVarianceDays: number;
  laborVarianceHours: number;
  bottleneckPhase: string;
  capacityShortfall: number;
  effectiveCapacity: number;
} {
  const plannedDeadline = safeDate(rows.at(-1));
  const completedWork = staffing.completedRows.reduce((sum, row) => sum + Number(row[targetColumn] ?? 0), 0);
  const remainingWork = staffing.remainingRows.reduce((sum, row) => sum + Number(row[targetColumn] ?? 0), 0);
  const remainingHours = staffing.remainingRows.reduce((sum, row) => sum + Number(row["Target Hours"] ?? row[targetColumn] ?? 0), 0);
  const dailyEffectiveHours = (staffing.isReplan ? staffing.effectiveStaffingUnits : settings.teamSize) * hoursPerDay;
  const remainingCapacityHours = staffing.remainingRows.length * dailyEffectiveHours;
  const capacityShortfall = round2(Math.max(0, remainingHours - remainingCapacityHours));
  const extraDays = dailyEffectiveHours > 0 ? Math.ceil(capacityShortfall / dailyEffectiveHours) : 0;
  const revisedCompletionDate = addScheduledDays(plannedDeadline, extraDays, settings);
  const scheduleVarianceDays = extraDays;
  const laborVarianceHours = round2(capacityShortfall);
  const bottleneckPhase = capacityShortfall > 0
    ? "Remaining production capacity"
    : staffing.isReplan && staffing.addedJuniorEmployees > 0
      ? "Junior employee ramp-up"
      : "No critical bottleneck";

  return {
    rows: [
      { Metric: "Original deadline", Value: plannedDeadline, Unit: "date" },
      { Metric: "Revised completion date", Value: revisedCompletionDate, Unit: "date" },
      { Metric: "Completed work preserved", Value: round2(completedWork), Unit: targetColumn.replace(/^Target\s+/i, "").toLowerCase() },
      { Metric: "Remaining workload", Value: round2(remainingWork), Unit: targetColumn.replace(/^Target\s+/i, "").toLowerCase() },
      { Metric: "Remaining labor hours", Value: round2(remainingHours), Unit: "hours" },
      { Metric: "Remaining effective capacity", Value: round2(remainingCapacityHours), Unit: "hours" },
      { Metric: "Capacity shortfall", Value: capacityShortfall, Unit: "hours" },
      { Metric: "Schedule variance", Value: scheduleVarianceDays, Unit: "working days" },
      { Metric: "Labor budget variance", Value: laborVarianceHours, Unit: "hours" },
      { Metric: "Bottleneck phase", Value: bottleneckPhase, Unit: "phase" },
    ],
    revisedCompletionDate,
    scheduleVarianceDays,
    laborVarianceHours,
    bottleneckPhase,
    capacityShortfall,
    effectiveCapacity: round2(remainingCapacityHours),
  };
}

function buildScenarioRows(
  settings: ResolvedPlanningSettings,
  plannedWorkingDays: number,
  plannedDeadline: string,
  hoursPerDay: number,
): ProductionPlanRow[] {
  const overtimeLimit = settings.overtimeLimitHoursPerPersonPerDay ?? 2;
  const scenarios = [
    { name: "Conservative", staff: Math.max(1, Math.floor(settings.teamSize * 0.8)), hourlyRate: 14, overtime: 0, risk: "MEDIUM-HIGH" },
    { name: "Balanced", staff: settings.teamSize, hourlyRate: 15, overtime: Math.min(1, overtimeLimit), risk: "MEDIUM" },
    { name: "Accelerated", staff: Math.max(settings.teamSize + 1, Math.ceil(settings.teamSize * 1.25)), hourlyRate: 18, overtime: Math.min(2, overtimeLimit), risk: "MEDIUM" },
  ];
  const rawRows = scenarios.map((scenario) => {
    const dailyCapacity = scenario.staff * (hoursPerDay + scenario.overtime);
    const requiredDays = Math.max(1, Math.ceil(settings.totalHours / Math.max(dailyCapacity, 0.01)));
    const completionDate = addScheduledDays(settings.startDate, requiredDays - 1, settings);
    const feasible = completionDate <= plannedDeadline;
    const baseCapacity = scenario.staff * plannedWorkingDays * hoursPerDay;
    const overtimeRequirement = round2(Math.max(0, settings.totalHours - baseCapacity));
    const totalLaborHours = round2(settings.totalHours + overtimeRequirement);
    const cost = round2(settings.totalHours * scenario.hourlyRate + overtimeRequirement * scenario.hourlyRate * 1.5);
    const utilization = round2((settings.totalHours / Math.max(scenario.staff * plannedWorkingDays * (hoursPerDay + scenario.overtime), 0.01)) * 100);
    return {
      Scenario: scenario.name,
      "Staffing Requirement": scenario.staff,
      "Overtime Hours/Person/Day": scenario.overtime,
      "Total Labor Hours": totalLaborHours,
      "Estimated Cost": cost,
      "Expected Completion Date": completionDate,
      "Deadline Feasible": feasible,
      "Utilization Rate": utilization,
      "Overtime Requirement": overtimeRequirement,
      "Risk Level": scenario.risk,
      Pros: scenario.name === "Balanced" ? "Balances deadline reliability, cost, and utilization" : scenario.name === "Accelerated" ? "Fastest completion and strongest deadline buffer" : "Lowest staffing footprint and simplest operations",
      Cons: scenario.name === "Balanced" ? "May need light overtime if actual productivity slips" : scenario.name === "Accelerated" ? "Highest labor cost and onboarding load" : "Highest schedule risk if productivity slips",
    };
  });
  const cheapest = Math.min(...rawRows.map((row) => Number(row["Estimated Cost"])));
  return rawRows.map((row) => {
    const deadlineScore = row["Deadline Feasible"] ? 100 : 35;
    const costScore = Math.max(0, 100 * (cheapest / Number(row["Estimated Cost"])));
    const utilizationScore = Math.max(0, 100 - Math.abs(85 - Number(row["Utilization Rate"])));
    const riskScore = String(row["Risk Level"]).includes("HIGH") ? 45 : 75;
    const scenarioScore = round2(deadlineScore * 0.4 + costScore * 0.25 + utilizationScore * 0.2 + riskScore * 0.15);
    return { ...row, "Scenario Score": scenarioScore };
  });
}

function bestScenario(scenarios: ProductionPlanRow[]): ProductionPlanRow {
  return scenarios.reduce((best, row) =>
    Number(row["Scenario Score"] ?? 0) > Number(best["Scenario Score"] ?? 0) ? row : best,
  );
}

function buildSupportSheets(
  planRows: ProductionPlanRow[],
  phases: DynamicPhase[],
  risks: DynamicRisk[],
  settings: ResolvedPlanningSettings,
  requested: RequestedConstraints,
  kind: string,
  unitLabel = "Hours",
  totalQuantity?: number,
): Array<{ sheetName: string; columns: string[]; rows: ProductionPlanRow[] }> {
  const isQuantity = unitLabel !== "Hours";
  const targetColumn = isQuantity ? `Target ${unitLabel}` : "Target Total Hours";
  const volumeKey = isQuantity ? `Planned ${unitLabel}` : "Planned Hours";
  const actualVolumeKey = isQuantity ? `Actual ${unitLabel}` : "Actual Hours";

  const weeklyRows = groupWeeks(planRows, targetColumn, volumeKey);
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
  const effectiveRisks = risks.length ? risks : defaultRisks(kind);
  const riskRows: ProductionPlanRow[] = [
    ...effectiveRisks.map((risk) => ({
      Type: "Risk",
      Item: risk.risk,
      Impact: risk.impact,
      "Mitigation / Note": risk.mitigation,
    })),
    {
      Type: "Assumption",
      Item: settings.weekdaysOnly ? "Weekends excluded" : "Weekend work allowed",
      Impact: `Controls available workdays and daily target ${unitLabel.toLowerCase()}`,
      "Mitigation / Note": "Schedule generated from normalized planning constraints.",
    },
  ];

  const summaryRows: ProductionPlanRow[] = [
    { Metric: "Project type", Value: kind },
    { Metric: "Production unit", Value: unitLabel.toLowerCase() },
    { Metric: "Start date", Value: settings.startDate },
    { Metric: "End date", Value: String(planRows.at(-1)?.Date ?? "") },
    { Metric: "Total planned hours", Value: settings.totalHours },
    { Metric: "Team size", Value: settings.teamSize },
    { Metric: "Schedule mode", Value: settings.weekdaysOnly ? "Weekdays only" : "Calendar days" },
  ];
  if (isQuantity && totalQuantity != null) {
    summaryRows.push({ Metric: `Total planned ${unitLabel.toLowerCase()}`, Value: totalQuantity });
  }

  const productiveHoursPerResourcePerDay = 8;
  const availableHours = Number((settings.teamSize * planRows.length * productiveHoursPerResourcePerDay).toFixed(2));
  const overtimeLimit = settings.overtimeLimitHoursPerPersonPerDay ?? 0;
  const maxOvertimeHours = Number((settings.teamSize * planRows.length * overtimeLimit).toFixed(2));
  const qualityReviewHours = Number(Math.max(settings.totalHours * 0.12, planRows.length * 0.25).toFixed(2));
  const productionHours = Number(Math.max(settings.totalHours - qualityReviewHours, 0).toFixed(2));
  const utilization = availableHours > 0 ? Number(((settings.totalHours / availableHours) * 100).toFixed(2)) : 0;
  const assumedProductivity = isQuantity && requested.totalHours === undefined;
  const feasibility = feasibilityStatus(settings.totalHours, availableHours, assumedProductivity);
  const requiredDailyOutput = isQuantity && totalQuantity
    ? Number((totalQuantity / planRows.length).toFixed(2))
    : Number((settings.totalHours / planRows.length).toFixed(2));
  const requiredOutputPerResourcePerDay = Number((requiredDailyOutput / settings.teamSize).toFixed(2));
  const role = roleForKind(kind);
  const phaseRows = phases.map((phase, index) => {
    const startIndex = Math.floor((index / phases.length) * planRows.length);
    const endIndex = Math.min(
      planRows.length - 1,
      Math.floor(((index + 1) / phases.length) * planRows.length) - 1,
    );
    const plannedStart = String(planRows[Math.max(startIndex, 0)]?.Date ?? planRows[0]?.Date ?? "");
    const plannedEnd = String(planRows[Math.max(endIndex, startIndex)]?.Date ?? planRows.at(-1)?.Date ?? "");
    return {
      "Stage ID": `STG-${String(index + 1).padStart(2, "0")}`,
      "Stage Name": phase.name,
      Purpose: phase.objective,
      "Owner Role": role,
      Inputs: index === 0 ? "Project request and confirmed constraints" : `${phases[index - 1]?.name} outputs`,
      Outputs: `${phase.name} deliverables`,
      "Planned Start": plannedStart,
      "Planned End": plannedEnd,
      "Estimated Hours": Number((settings.totalHours / phases.length).toFixed(2)),
      Dependencies: index === 0 ? "" : `STG-${String(index).padStart(2, "0")}`,
      "Completion Criteria": phase.objective,
    };
  });
  const taskRows = phaseRows.map((phase, index) => {
    const isQualityTask = /qa|quality|test|review|inspection|verification/i.test(String(phase["Stage Name"]));
    return {
      "Task ID": `TASK-${String(index + 1).padStart(3, "0")}`,
      "Task Name": taskFor(kind, phases[index]!, requested),
      Description: String(phase.Purpose),
      "Workflow Stage": String(phase["Stage ID"]),
      "Assigned Role": isQualityTask ? "Quality reviewer" : role,
      Priority: index === phaseRows.length - 1 ? "HIGH" : "MEDIUM",
      "Planned Start": String(phase["Planned Start"]),
      "Planned End": String(phase["Planned End"]),
      "Estimated Hours": Number(phase["Estimated Hours"]),
      "Planned Quantity": isQuantity && totalQuantity ? Math.round(totalQuantity / phaseRows.length) : Number(phase["Estimated Hours"]),
      "Production Unit": unitLabel.toLowerCase(),
      "Daily Target": requiredDailyOutput,
      Dependencies: index === 0 ? "" : `TASK-${String(index).padStart(3, "0")}`,
      "Expected Deliverable": `${phase["Stage Name"]} completed`,
      "Completion Criteria": String(phase["Completion Criteria"]),
      "Initial Status": "NOT_STARTED",
    };
  });
  const capacityRows: ProductionPlanRow[] = [
    { Metric: "Available person-hours", Formula: "teamSize × workingDays × productiveHoursPerDay", Value: availableHours, Unit: "hours" },
    { Metric: "Required hours", Formula: "planned production hours + quality review hours", Value: settings.totalHours, Unit: "hours" },
    { Metric: "Production hours", Formula: "requiredHours - qualityReviewHours", Value: productionHours, Unit: "hours" },
    { Metric: "Quality review hours", Formula: "max(requiredHours × 12%, scheduledDays × 0.25)", Value: qualityReviewHours, Unit: "hours" },
    { Metric: "Overtime limit", Formula: "max overtime hours/person/day from request", Value: overtimeLimit, Unit: "hours/person/day" },
    { Metric: "Maximum overtime capacity", Formula: "teamSize × workingDays × overtimeLimit", Value: maxOvertimeHours, Unit: "hours" },
    { Metric: "Utilization", Formula: "requiredHours ÷ availablePersonHours × 100", Value: utilization, Unit: "%" },
    { Metric: "Buffer hours", Formula: "availablePersonHours - requiredHours", Value: Number((availableHours - settings.totalHours).toFixed(2)), Unit: "hours" },
    { Metric: "Required daily output", Formula: "planned workload ÷ workingDays", Value: requiredDailyOutput, Unit: unitLabel.toLowerCase() },
    { Metric: "Required output per resource per day", Formula: "requiredDailyOutput ÷ teamSize", Value: requiredOutputPerResourcePerDay, Unit: unitLabel.toLowerCase() },
    { Metric: "Feasibility status", Formula: "deterministic utilization and assumption check", Value: feasibility, Unit: "status" },
  ];
  const qualityRows: ProductionPlanRow[] = [
    { Area: "Review coverage", Method: kind === "software development" ? "Code review, test execution, and acceptance testing" : kind === "manufacturing" ? "Batch inspection and defect isolation" : "Sampling, validation, and correction queue", Target: kind === "software development" ? "All critical features reviewed/tested" : "Material sample reviewed before completion", "Planned Hours": qualityReviewHours },
    { Area: "Rework handling", Method: "Track exceptions separately and recheck corrected output", Target: "No unresolved critical exceptions at closeout", "Planned Hours": Number((qualityReviewHours * 0.35).toFixed(2)) },
  ];
  const kpiRows: ProductionPlanRow[] = [
    { "KPI ID": "KPI-001", Name: "Planned output", Description: "Total planned workload", Formula: "SUM primary target column", Unit: unitLabel.toLowerCase(), Target: isQuantity && totalQuantity ? totalQuantity : settings.totalHours, "Warning Threshold": "Below daily target", "Critical Threshold": "Below 85% of target", "Source Data": "Production Plan" },
    { "KPI ID": "KPI-002", Name: "Capacity utilization", Description: "Required hours as percentage of available person-hours", Formula: "requiredHours / availablePersonHours", Unit: "%", Target: utilization, "Warning Threshold": "85%", "Critical Threshold": "100%", "Source Data": "Capacity Analysis" },
    { "KPI ID": "KPI-003", Name: "Quality review allocation", Description: "Hours reserved for quality-control work", Formula: "qualityReviewHours", Unit: "hours", Target: qualityReviewHours, "Warning Threshold": "Below 10% of required hours", "Critical Threshold": "No quality allocation", "Source Data": "Quality Plan" },
  ];
  const chartRows: ProductionPlanRow[] = [
    { "Chart ID": "CHART-001", "Chart Title": `Planned ${unitLabel} by Day`, "Chart Type": "line", Purpose: "Show daily production targets", "Source Worksheet": "Production Plan", "Category Field": "Date", "Value Fields": targetColumn, Aggregation: "sum", Filters: "", "Display Target": "BOTH" },
    { "Chart ID": "CHART-002", "Chart Title": "Capacity vs Required Hours", "Chart Type": "bar", Purpose: "Compare available and required hours", "Source Worksheet": "Capacity Analysis", "Category Field": "Metric", "Value Fields": "Value", Aggregation: "none", Filters: "Available person-hours, Required hours, Buffer hours", "Display Target": "BOTH" },
    { "Chart ID": "CHART-003", "Chart Title": "Risk Distribution", "Chart Type": "bar", Purpose: "Summarize risks by impact", "Source Worksheet": "Risk Register", "Category Field": "Impact", "Value Fields": "Risk ID", Aggregation: "count", Filters: "", "Display Target": "DASHBOARD" },
  ];

  return [
    {
      sheetName: "Weekly Schedule",
      columns: ["Week", "Start Date", "End Date", volumeKey, "Focus", "Review Checkpoint"],
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
      columns: ["Period", volumeKey, actualVolumeKey, "Variance", "Completion %", "Status", "Notes"],
      rows: weeklyRows.map((row) => ({
        Period: `Week ${row.Week}`,
        [volumeKey]: row[volumeKey],
        [actualVolumeKey]: "",
        Variance: "",
        "Completion %": "",
        Status: "Not Started",
        Notes: "",
      })),
    },
    {
      sheetName: "Summary",
      columns: ["Metric", "Value"],
      rows: summaryRows,
    },
    {
      sheetName: "Project Information",
      columns: ["Field", "Value"],
      rows: [
        { Field: "Project category", Value: kind },
        { Field: "Production unit", Value: unitLabel.toLowerCase() },
        { Field: "Planning model", Value: requested.planningModel ?? "Not specified" },
        { Field: "Feasibility status", Value: feasibility },
        { Field: "Requires clarification", Value: assumedProductivity ? "true" : "false" },
        { Field: "Clarification questions", Value: assumedProductivity ? `What confirmed productivity rate should be used for ${unitLabel.toLowerCase()} per hour?` : "" },
      ],
    },
    {
      sheetName: "Capacity Analysis",
      columns: ["Metric", "Formula", "Value", "Unit"],
      rows: capacityRows,
    },
    {
      sheetName: "Workflow Stages",
      columns: ["Stage ID", "Stage Name", "Purpose", "Owner Role", "Inputs", "Outputs", "Planned Start", "Planned End", "Estimated Hours", "Dependencies", "Completion Criteria"],
      rows: phaseRows,
    },
    {
      sheetName: "Task Breakdown",
      columns: ["Task ID", "Task Name", "Description", "Workflow Stage", "Assigned Role", "Priority", "Planned Start", "Planned End", "Estimated Hours", "Planned Quantity", "Production Unit", "Daily Target", "Dependencies", "Expected Deliverable", "Completion Criteria", "Initial Status"],
      rows: taskRows,
    },
    {
      sheetName: "Quality Plan",
      columns: ["Area", "Method", "Target", "Planned Hours"],
      rows: qualityRows,
    },
    {
      sheetName: "Risk Register",
      columns: ["Risk ID", "Description", "Category", "Probability", "Impact", "Severity", "Trigger", "Mitigation", "Contingency", "Owner Role"],
      rows: effectiveRisks.map((risk, index) => ({
        "Risk ID": `RISK-${String(index + 1).padStart(3, "0")}`,
        Description: risk.risk,
        Category: kind,
        Probability: "MEDIUM",
        Impact: risk.impact.toUpperCase().includes("HIGH") ? "HIGH" : "MEDIUM",
        Severity: risk.impact.toUpperCase().includes("HIGH") ? "HIGH" : "MODERATE",
        Trigger: "Progress, quality, or resource indicator moves outside threshold",
        Mitigation: risk.mitigation,
        Contingency: feasibility === "NOT_FEASIBLE" ? "Extend deadline, reduce scope, or add resources." : "Use buffer and prioritize critical deliverables.",
        "Owner Role": "Project lead",
      })),
    },
    {
      sheetName: "KPI Tracker",
      columns: ["KPI ID", "Name", "Description", "Formula", "Unit", "Target", "Warning Threshold", "Critical Threshold", "Source Data"],
      rows: kpiRows,
    },
    {
      sheetName: "Chart Specs",
      columns: ["Chart ID", "Chart Title", "Chart Type", "Purpose", "Source Worksheet", "Category Field", "Value Fields", "Aggregation", "Filters", "Display Target"],
      rows: chartRows,
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
  const effectiveRisks = proposal.risks.length ? proposal.risks : defaultRisks(kind);
  const totalQuantity = settings.totalQuantity ?? (settings.unitOfMeasure && proposal.totalAssets > 0 ? Math.round(proposal.totalAssets) : undefined);
  const unitOfMeasure = settings.unitOfMeasure ?? requested.unitOfMeasure;

  // Select column profile based on detected unit of measure.
  const { columns: planColumns, isQuantity, unitLabel } = selectColumnProfile(totalQuantity != null ? unitOfMeasure : undefined);

  // ── Throughput-aware quantity distribution ───────────────────────────────────
  const hoursPerDay = Math.max(1, proposal.planningSettings.hoursPerDay ?? 8);

  // Priority order for throughput rate (units per person per hour):
  //   1. Explicitly stated in prompt ("50 images per hour") — highest confidence
  //   2. Per-day rate converted to per-hour ("400 images per day" / hoursPerDay)
  //   3. AI-proposed rate from proposal.planningSettings.throughputRate
  //   4. Back-calculated from totalQuantity / scheduledDays / hoursPerDay / teamSize (implied)
  let effectiveThroughputRate: number | undefined;
  let throughputSource: "explicit" | "perDay" | "proposed" | "implied" | undefined;

  if (isQuantity && totalQuantity != null) {
    if (requested.throughputRate !== undefined) {
      effectiveThroughputRate = requested.throughputRate;
      throughputSource = "explicit";
    } else if (requested.throughputPerDay !== undefined) {
      effectiveThroughputRate = requested.throughputPerDay / hoursPerDay;
      throughputSource = "perDay";
    } else if (proposal.planningSettings.throughputRate !== undefined) {
      effectiveThroughputRate = proposal.planningSettings.throughputRate;
      throughputSource = "proposed";
    } else {
      // Option A: back-calculate implied rate from totalQuantity / scheduledDays / hoursPerDay / teamSize
      effectiveThroughputRate = totalQuantity / (dates.length * hoursPerDay * settings.teamSize);
      throughputSource = "implied";
    }
  }

  // Distribute the total quantity evenly across scheduled days (always exact sum).
  const quantities = isQuantity && totalQuantity != null
    ? distributeQuantity(totalQuantity, dates.length)
    : null;
  const availableHours = settings.teamSize * dates.length * 8;
  const assumedRate = isQuantity && requested.totalHours === undefined;
  const feasibility = feasibilityStatus(settings.totalHours, availableHours, assumedRate);
  const requiredDailyOutput = Number(((isQuantity && totalQuantity ? totalQuantity : settings.totalHours) / dates.length).toFixed(2));
  const utilizationPercent = availableHours > 0
    ? Number(((settings.totalHours / availableHours) * 100).toFixed(2))
    : 0;

  // Pre-compute dynamic column key names for the active profile.
  const targetKey = isQuantity ? `Target ${unitLabel}` : "Target Total Hours";
  const targetPerAnnotKey = isQuantity ? `Target ${unitLabel} per Annotator` : "Target Total Hours per Annotator";
  const actualKey = isQuantity ? `Actual ${unitLabel}` : "Actual Total Hours";
  const actualPerAnnotKey = isQuantity ? `Actual ${unitLabel} per Annotator` : "Actual Total Hours per Annotator";

  const rows: ProductionPlanRow[] = dates.map((date, index) => {
    const targetVal = quantities != null ? quantities[index]! : hours[index]!;
    const perAnnotVal = quantities != null
      ? Math.round(quantities[index]! / settings.teamSize)
      : Number((hours[index]! / settings.teamSize).toFixed(2));
    return {
      "No.": index + 1,
      Date: date,
      Month: monthName(date),
      Day: new Date(`${date}T00:00:00Z`).toLocaleString("en-US", { weekday: "short", timeZone: "UTC" }),
      "Target Active Annotators": settings.teamSize,
      [targetKey]: targetVal,
      [targetPerAnnotKey]: perAnnotVal,
      "Actual Active Annotators": "",
      [actualKey]: "",
      [actualPerAnnotKey]: "",
      "Target Hours": hours[index]!,   // capacity reference — always present
      "Actual Hours": "",
      "Total Variance": "",
      "Completion Rate (%)": "",
      Status: "Not Started",
      Notes: taskFor(kind, phaseForIndex(phases, index, dates.length), requested),
    };
  });

  const staffing = analyzeStaffingChanges(input.projectDescription, rows, settings);
  if (staffing.isReplan) {
    rows.forEach((row, index) => {
      if (index < staffing.effectiveIndex) {
        row.Status = "Completed - preserved";
        row.Notes = `${String(row.Notes)}; historical assignment preserved`;
        return;
      }
      row["Target Active Annotators"] = staffing.revisedHeadcount;
      const targetValue = Number(row[targetKey] ?? 0);
      row[targetPerAnnotKey] = isQuantity
        ? Math.round(targetValue / Math.max(staffing.revisedHeadcount, 1))
        : round2(targetValue / Math.max(staffing.revisedHeadcount, 1));
      row.Notes = `${String(row.Notes)}; revised staffing effective ${staffing.effectiveDate}`;
    });
  }

  const forecast = buildForecast(rows, targetKey, settings, staffing, hoursPerDay);
  const scenarioRows = buildScenarioRows(settings, dates.length, dates.at(-1)!, hoursPerDay);
  const recommendedScenarioRow = bestScenario(scenarioRows);
  const recommendedScenario = {
    name: String(recommendedScenarioRow.Scenario ?? ""),
    reason: `${String(recommendedScenarioRow.Scenario)} has the strongest weighted score using deadline feasibility, cost efficiency, utilization, and operational risk.`,
    costImpact: `${Number(recommendedScenarioRow["Estimated Cost"] ?? 0).toLocaleString()} estimated labor cost`,
    scheduleImpact: `Expected completion ${String(recommendedScenarioRow["Expected Completion Date"] ?? dates.at(-1))}`,
    riskLevel: String(recommendedScenarioRow["Risk Level"] ?? "MEDIUM"),
  };

  // ── Assumptions ───────────────────────────────────────────────────────────
  const distributionNote = isQuantity && totalQuantity != null
    ? `${totalQuantity.toLocaleString()} ${unitLabel.toLowerCase()} distributed across ${dates.length} scheduled days.`
    : `Total target hours are distributed across ${dates.length} scheduled days.`;

  const throughputAssumption =
    isQuantity && effectiveThroughputRate !== undefined
      ? (() => {
          const rateStr = effectiveThroughputRate % 1 === 0
            ? effectiveThroughputRate.toFixed(0)
            : effectiveThroughputRate.toFixed(1);
          const dailyTeam = Math.round(settings.teamSize * hoursPerDay * effectiveThroughputRate);
          const sourceLabel =
            throughputSource === "explicit" ? "stated in prompt" :
            throughputSource === "perDay" ? "derived from per-day rate" :
            throughputSource === "proposed" ? "proposed by AI" :
            "back-calculated from total quantity";
          return `Throughput: ${rateStr} ${unitLabel.toLowerCase()}/person/hour (${sourceLabel}). Daily team target: ~${dailyTeam.toLocaleString()} ${unitLabel.toLowerCase()}/day.`;
        })()
      : undefined;

  const assumptions = [
    ...proposal.assumptions,
    ...(requested.planningModel ? [`Requested planning model preserved: ${requested.planningModel}.`] : []),
    settings.workingDays?.length
      ? `Custom working days were used: ${settings.workingDays.join(", ")} where Sunday is 0.`
      : `${settings.weekdaysOnly ? "Weekdays only" : "Calendar days"} scheduling was used.`,
    distributionNote,
    ...(throughputAssumption ? [throughputAssumption] : []),
    ...((requested.dateInterpretations ?? []).map(
      (item) => `Interpreted "${item.source}" as ${item.normalized}.`,
    )),
  ];
  const supportSheets = buildSupportSheets(
    rows, phases, effectiveRisks, settings, requested, kind,
    unitLabel, totalQuantity,
  );
  const plannedDeadline = dates.at(-1)!;
  const currentActualRows = staffing.completedRows.length
    ? staffing.completedRows.map((row, index) => ({
        Period: String(row.Date),
        "Historical Assignment": `Original ${String(row["Target Active Annotators"])} resource(s)`,
        "Planned Work": Number(row[targetKey] ?? 0),
        "Actual Work Preserved": Number(row[targetKey] ?? 0),
        Status: "Completed",
        Notes: "Preserved from active project history; remaining plan recalculated separately.",
      }))
    : [{ Period: "Not reported", "Historical Assignment": "", "Planned Work": 0, "Actual Work Preserved": 0, Status: "No actuals supplied", Notes: "No completed work was inferred from the prompt." }];
  const remainingWorkRows = groupWeeks(staffing.remainingRows, targetKey, `Revised ${unitLabel}`);
  const recoveryRows: ProductionPlanRow[] = [
    {
      Option: "Protect scope and extend completion",
      "Schedule Impact": forecast.scheduleVarianceDays > 0 ? `Extend by ${forecast.scheduleVarianceDays} working day(s)` : "No extension required",
      "Cost Impact": "Lowest incremental cost",
      "Resource Impact": "Uses revised staffing only",
      Risk: forecast.capacityShortfall > 0 ? "Deadline miss risk remains visible" : "Low",
      Recommendation: forecast.capacityShortfall > 0 ? "Use only if deadline is flexible" : "Acceptable",
    },
    {
      Option: "Add temporary experienced staff",
      "Schedule Impact": "Recovers capacity shortfall fastest",
      "Cost Impact": "Moderate to high",
      "Resource Impact": "Requires recruiting or reassignment",
      Risk: "Medium onboarding risk",
      Recommendation: forecast.capacityShortfall > 0 ? "Recommended recovery if deadline is fixed" : "Keep as contingency",
    },
    {
      Option: "Use controlled overtime",
      "Schedule Impact": "Partial recovery within overtime limit",
      "Cost Impact": "Overtime premium applies",
      "Resource Impact": "Raises fatigue and quality risk",
      Risk: "Medium",
      Recommendation: settings.overtimeLimitHoursPerPersonPerDay ? "Use within stated overtime limit" : "Not recommended without an approved overtime limit",
    },
  ];
  const advancedSheets: Array<{ sheetName: string; columns: string[]; rows: ProductionPlanRow[] }> = [
    {
      sheetName: "Executive Summary",
      columns: ["Section", "Finding", "Value"],
      rows: [
        { Section: "Feasibility", Finding: "Deterministic feasibility result", Value: feasibility },
        { Section: "Forecast", Finding: "Revised completion date", Value: forecast.revisedCompletionDate },
        { Section: "Variance", Finding: "Schedule variance in working days", Value: forecast.scheduleVarianceDays },
        { Section: "Recommendation", Finding: "Best staffing scenario", Value: recommendedScenario.name },
      ],
    },
    {
      sheetName: "Input Assumptions",
      columns: ["Assumption", "Source", "Impact"],
      rows: assumptions.map((assumption) => ({ Assumption: assumption, Source: "Prompt / deterministic parser", Impact: "Used in schedule, capacity, or forecast calculation" })),
    },
    {
      sheetName: "Production Schedule",
      columns: planColumns,
      rows,
    },
    {
      sheetName: "Dependency Timeline",
      columns: ["Phase", "Depends On", "Dependency Rule", "Planned Start", "Planned End"],
      rows: phases.map((phase, index) => {
        const startIndex = Math.floor((index / phases.length) * rows.length);
        const endIndex = Math.min(rows.length - 1, Math.floor(((index + 1) / phases.length) * rows.length) - 1);
        return {
          Phase: phase.name,
          "Depends On": index === 0 ? "Project inputs" : phases[index - 1]!.name,
          "Dependency Rule": index === 0 ? "Inputs must be available before work starts" : "Downstream work cannot exceed upstream completed work",
          "Planned Start": safeDate(rows[Math.max(startIndex, 0)]),
          "Planned End": safeDate(rows[Math.max(endIndex, startIndex)]),
        };
      }),
    },
    {
      sheetName: "Staffing Changes",
      columns: ["Effective Date", "Change", "Removed Employees", "Added Junior Employees", "Added Experienced Employees", "Planned Headcount", "Effective Capacity Units", "Reason"],
      rows: staffing.staffingRows.length
        ? staffing.staffingRows
        : [{ "Effective Date": settings.startDate, Change: "No staffing change reported", "Removed Employees": 0, "Added Junior Employees": 0, "Added Experienced Employees": 0, "Planned Headcount": settings.teamSize, "Effective Capacity Units": settings.teamSize, Reason: "Baseline plan" }],
    },
    {
      sheetName: "Current Actuals",
      columns: ["Period", "Historical Assignment", "Planned Work", "Actual Work Preserved", "Status", "Notes"],
      rows: currentActualRows,
    },
    {
      sheetName: "Revised Forecast",
      columns: ["Metric", "Value", "Unit"],
      rows: forecast.rows,
    },
    {
      sheetName: "Revised Monthly Targets",
      columns: ["Week", "Start Date", "End Date", `Revised ${unitLabel}`, "Focus", "Review Checkpoint"],
      rows: remainingWorkRows,
    },
    {
      sheetName: "Scenario Comparison",
      columns: ["Scenario", "Staffing Requirement", "Overtime Hours/Person/Day", "Total Labor Hours", "Estimated Cost", "Expected Completion Date", "Deadline Feasible", "Utilization Rate", "Overtime Requirement", "Risk Level", "Pros", "Cons", "Scenario Score"],
      rows: scenarioRows,
    },
    {
      sheetName: "Cost Optimization",
      columns: ["Scenario", "Estimated Cost", "Total Labor Hours", "Cost Efficiency Note"],
      rows: scenarioRows.map((row) => ({
        Scenario: row.Scenario,
        "Estimated Cost": row["Estimated Cost"],
        "Total Labor Hours": row["Total Labor Hours"],
        "Cost Efficiency Note": row.Scenario === recommendedScenario.name ? "Best weighted option" : "Lower score after deadline, utilization, and risk weighting",
      })),
    },
    {
      sheetName: "Bottleneck Analysis",
      columns: ["Bottleneck", "Measured Impact", "Cause", "Corrective Action"],
      rows: [
        {
          Bottleneck: forecast.bottleneckPhase,
          "Measured Impact": `${forecast.capacityShortfall} hour shortfall; ${forecast.scheduleVarianceDays} working day variance`,
          Cause: staffing.isReplan ? "Staffing change applied to remaining work only" : "Capacity compared with required work",
          "Corrective Action": forecast.capacityShortfall > 0 ? "Add staff, reduce scope, approve overtime, or move deadline" : "Monitor actual progress against planned targets",
        },
      ],
    },
    {
      sheetName: "Recommended Recovery Plan",
      columns: ["Option", "Schedule Impact", "Cost Impact", "Resource Impact", "Risk", "Recommendation"],
      rows: recoveryRows,
    },
    {
      sheetName: "KPI Dashboard",
      columns: ["KPI", "Planned", "Actual", "Forecast", "Status"],
      rows: [
        { KPI: "Target workload", Planned: isQuantity && totalQuantity ? totalQuantity : settings.totalHours, Actual: staffing.completedRows.reduce((sum, row) => sum + Number(row[targetKey] ?? 0), 0), Forecast: isQuantity && totalQuantity ? totalQuantity : settings.totalHours, Status: "Tracked" },
        { KPI: "Completion date", Planned: plannedDeadline, Actual: "", Forecast: forecast.revisedCompletionDate, Status: forecast.scheduleVarianceDays > 0 ? "At risk" : "On track" },
        { KPI: "Capacity shortfall", Planned: 0, Actual: "", Forecast: forecast.capacityShortfall, Status: forecast.capacityShortfall > 0 ? "Action required" : "OK" },
        { KPI: "Recommended scenario", Planned: "", Actual: "", Forecast: recommendedScenario.name, Status: "Selected" },
      ],
    },
    {
      sheetName: "Revision History",
      columns: ["Revision", "Date", "Trigger", "Change Summary"],
      rows: [
        { Revision: 1, Date: currentDate, Trigger: staffing.isReplan ? "Dynamic staffing change" : "Initial plan generation", "Change Summary": staffing.isReplan ? "Completed work preserved and remaining schedule recalculated." : "Initial deterministic production plan created." },
      ],
    },
  ];
  const workbookSheets = [
    { sheetName: "Production Plan", columns: planColumns, rows },
    ...supportSheets,
    ...advancedSheets,
  ];
  const structuredPlan = {
    projectSummary: {
      targetRecords: totalQuantity ?? settings.totalHours,
      duration: `${dates.length} working day(s)`,
      deadline: plannedDeadline,
      laborBudgetHours: settings.totalHours,
      feasible: feasibility !== "NOT_FEASIBLE" && forecast.capacityShortfall === 0,
    },
    parsedInputs: {
      roles: [roleForKind(kind), "Quality reviewer", "Project lead"],
      dependencies: phases.map((phase, index) => index === 0 ? `${phase.name}: inputs confirmed` : `${phase.name}: after ${phases[index - 1]!.name}`),
      constraints: [
        settings.weekdaysOnly ? "Weekdays only" : "Calendar days allowed",
        ...(settings.holidays ?? []).map((holiday) => `Holiday excluded: ${holiday}`),
        settings.overtimeLimitHoursPerPersonPerDay !== undefined ? `Overtime limit: ${settings.overtimeLimitHoursPerPersonPerDay} hours/person/day` : "No overtime limit provided",
      ],
      productivityRates: [
        `${hoursPerDay} base hours/person/day`,
        ...(effectiveThroughputRate ? [`${round2(effectiveThroughputRate)} ${unitLabel.toLowerCase()}/person/hour`] : []),
      ],
    },
    capacityAnalysis: {
      workingDays: dates.length,
      availableHours: round2(availableHours),
      effectiveCapacity: staffing.isReplan ? forecast.effectiveCapacity : round2(availableHours),
      capacityShortfall: forecast.capacityShortfall,
    },
    schedule: rows,
    resourceAllocation: supportSheets.find((sheet) => sheet.sheetName === "Resource Allocation")?.rows ?? [],
    forecast: {
      revisedCompletionDate: forecast.revisedCompletionDate,
      scheduleVarianceDays: forecast.scheduleVarianceDays,
      laborVarianceHours: forecast.laborVarianceHours,
      bottleneckPhase: forecast.bottleneckPhase,
    },
    replanning: {
      isReplan: staffing.isReplan,
      preservedCompletedWork: staffing.isReplan,
      staffingChanges: staffing.staffingRows,
      remainingWork: staffing.remainingRows,
    },
    scenarios: scenarioRows,
    recommendedScenario,
    risks: supportSheets.find((sheet) => sheet.sheetName === "Risk Register")?.rows ?? [],
    excelWorkbook: {
      sheets: workbookSheets.map((sheet) => sheet.sheetName),
    },
  };
  const plan: ProductionPlan = {
    project: {
      projectName: proposal.projectName,
      projectDescription: input.projectDescription,
      client: proposal.client,
      startDate: dates[0]!,
      deadline: dates.at(-1)!,
      totalAssets: totalQuantity ?? proposal.totalAssets,
      assumptions,
      projectCategory: kind,
      productionUnit: unitLabel.toLowerCase(),
      feasibilityStatus: feasibility,
      requiredDailyOutput,
      utilizationPercent,
    },
    workbook: {
      sheets: workbookSheets,
    },
    structuredPlan,
    summary:
      `${proposal.summary} Feasibility: ${feasibility}. ` +
      `Planned workload: ${isQuantity && totalQuantity ? totalQuantity.toLocaleString() : settings.totalHours} ${unitLabel.toLowerCase()} ` +
      `from ${dates[0]} to ${dates.at(-1)} with ${settings.teamSize} resource(s). ` +
      `Required daily output: ${requiredDailyOutput} ${unitLabel.toLowerCase()}; utilization: ${utilizationPercent}%. ` +
      `Forecast completion: ${forecast.revisedCompletionDate}. Recommended scenario: ${recommendedScenario.name}.`,
  };
  return {
    plan, settings, phases, risks: effectiveRisks,
    unitLabel: isQuantity ? unitLabel : undefined,
    totalQuantity: isQuantity ? totalQuantity : undefined,
    throughputRate: isQuantity ? effectiveThroughputRate : undefined,
    hoursPerDay: isQuantity ? hoursPerDay : undefined,
  };

}
