import type {
  ProductionPlan,
  ProductionPlanColumnDataType,
  ProductionPlanColumnDefinition,
  ProductionPlanColumnSemantic,
  ProductionPlanRow,
} from "../types/productionPlan.js";
import {
  buildScheduleDates,
  DEFAULT_PLANNING_MODEL,
  extractRequestedConstraints,
  resolvePlanningSettings,
  type DurationUnit,
  type RequestedConstraints,
  type ResolvedPlanningSettings,
} from "./planningConstraintsService.js";
import {
  buildLpbDistribution,
  type LpbDistribution,
} from "./lpbModelService.js";

export interface DynamicPhase {
  name: string;
  objective: string;
}

export interface DynamicRisk {
  risk: string;
  impact: string;
  mitigation: string;
}

export interface DynamicRole {
  roleName: string;
  headcount: number;
}

export interface DynamicScenario {
  scenarioName: string;
  description: string;
}

export interface DynamicColumnProposal {
  key?: string;
  label: string;
  semantic: ProductionPlanColumnSemantic;
  dataType?: ProductionPlanColumnDataType;
  editable?: boolean;
  role?: string;
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
  roles?: DynamicRole[];
  scenarios?: DynamicScenario[];
  workbookDesign?: {
    columns: DynamicColumnProposal[];
  };
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

/** Quantity-based column profile (images, records, etc.).
 *  Positions 6-10 use the named unit; positions 11-12 keep hours for capacity reference. */
function buildQuantityColumns(unitLabel: string, resourceLabel: string, resourcePlural: string): string[] {
  return [
    "No.", "Date", "Month", "Day",
    `Target Active ${resourcePlural}`,
    `Target ${unitLabel}`,
    `Target ${unitLabel} per ${resourceLabel}`,
    `Actual Active ${resourcePlural}`,
    `Actual ${unitLabel}`,
    `Actual ${unitLabel} per ${resourceLabel}`,
    "Target Hours",   // capacity reference — kept for Excel formula compat
    "Actual Hours",
    "Total Variance",
    "Completion Rate (%)",
    "Status",
    "Notes",
  ];
}

function capitalize(s: string): string {
  return s.split(/\s+/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

type CoreColumnSemantic = Exclude<
  ProductionPlanColumnSemantic,
  "phase" | "role_headcount" | "custom"
>;

const CORE_COLUMN_SEMANTICS: CoreColumnSemantic[] = [
  "sequence",
  "date",
  "month",
  "day",
  "planned_staff",
  "planned_output",
  "planned_output_per_person",
  "actual_staff",
  "actual_output",
  "actual_output_per_person",
  "planned_hours",
  "actual_hours",
  "variance",
  "completion_rate",
  "status",
  "notes",
];

const PROPOSABLE_COLUMN_SEMANTICS = new Set<ProductionPlanColumnSemantic>([
  ...CORE_COLUMN_SEMANTICS,
  "phase",
  "role_headcount",
  "custom",
]);

function safeColumnKey(value: string, fallback: string): string {
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return key || fallback;
}

function safeColumnLabel(value: string, fallback: string): string {
  const label = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return label && !/^[=+\-@]/.test(label) ? label : fallback;
}

function baseColumnDefinitions(
  unitLabel: string,
  isQuantity: boolean,
): ProductionPlanColumnDefinition[] {
  const outputType: ProductionPlanColumnDataType = isQuantity ? "integer" : "decimal";
  const labels: Record<CoreColumnSemantic, string> = {
    sequence: "No.",
    date: "Date",
    month: "Month",
    day: "Day",
    planned_staff: "Target Active Annotators",
    planned_output: isQuantity ? `Target ${unitLabel}` : "Target Total Hours",
    planned_output_per_person: isQuantity
      ? `Target ${unitLabel} per Annotator`
      : "Target Total Hours per Annotator",
    actual_staff: "Actual Active Annotators",
    actual_output: isQuantity ? `Actual ${unitLabel}` : "Actual Total Hours",
    actual_output_per_person: isQuantity
      ? `Actual ${unitLabel} per Annotator`
      : "Actual Total Hours per Annotator",
    planned_hours: "Target Hours",
    actual_hours: "Actual Hours",
    variance: "Total Variance",
    completion_rate: "Completion Rate (%)",
    status: "Status",
    notes: "Notes",
  };
  const dataTypes: Record<CoreColumnSemantic, ProductionPlanColumnDataType> = {
    sequence: "integer",
    date: "date",
    month: "text",
    day: "text",
    planned_staff: "integer",
    planned_output: outputType,
    planned_output_per_person: outputType,
    actual_staff: "integer",
    actual_output: outputType,
    actual_output_per_person: outputType,
    planned_hours: "decimal",
    actual_hours: "decimal",
    variance: outputType,
    completion_rate: "percentage",
    status: "text",
    notes: "text",
  };

  return CORE_COLUMN_SEMANTICS.map((semantic) => ({
    key: semantic,
    label: labels[semantic],
    semantic,
    dataType: dataTypes[semantic],
    editable:
      semantic === "actual_staff" ||
      semantic === "actual_output" ||
      semantic === "actual_hours" ||
      semantic === "notes",
  }));
}

function buildColumnProfile(
  unitOfMeasure: string | undefined,
  proposals: DynamicColumnProposal[] = [],
  roles: DynamicRole[] = [],
): {
  definitions: ProductionPlanColumnDefinition[];
  columns: string[];
  isQuantity: boolean;
  unitLabel: string;
} {
  const isQuantity = Boolean(unitOfMeasure && unitOfMeasure !== "hours");
  const unitLabel = isQuantity ? capitalize(unitOfMeasure!) : "Hours";
  const proposedBySemantic = new Map<ProductionPlanColumnSemantic, DynamicColumnProposal>();

  for (const proposal of proposals) {
    if (
      CORE_COLUMN_SEMANTICS.includes(proposal.semantic as CoreColumnSemantic) &&
      !proposedBySemantic.has(proposal.semantic)
    ) {
      proposedBySemantic.set(proposal.semantic, proposal);
    }
  }

  const definitions = baseColumnDefinitions(unitLabel, isQuantity).map((definition) => {
    const proposed = proposedBySemantic.get(definition.semantic);
    if (!proposed) {
      if (definition.semantic === "planned_staff" && roles.length > 0) {
        const roleLabel = roles.length === 1
          ? `${roles[0]!.roleName}${/s$/i.test(roles[0]!.roleName) ? "" : "s"} Scheduled`
          : "Total Staff Scheduled";
        return { ...definition, label: safeColumnLabel(roleLabel, definition.label) };
      }
      if (
        roles.length > 0 &&
        (
          definition.semantic === "planned_output_per_person" ||
          definition.semantic === "actual_output_per_person"
        )
      ) {
        const prefix =
          definition.semantic === "planned_output_per_person" ? "Target" : "Actual";
        return {
          ...definition,
          label: `${prefix} ${unitLabel} per Person`,
        };
      }
      return definition;
    }
    return {
      ...definition,
      key: safeColumnKey(proposed.key ?? definition.key, definition.key),
      label: safeColumnLabel(proposed.label, definition.label),
    };
  });

  const optionalProposals = proposals
    .filter((proposal) =>
      proposal.semantic === "phase" ||
      proposal.semantic === "role_headcount" ||
      proposal.semantic === "custom",
    );
  if (roles.length > 1) {
    for (const role of roles) {
      const alreadyProposed = optionalProposals.some(
        (proposal) =>
          proposal.semantic === "role_headcount" &&
          proposal.role?.toLowerCase() === role.roleName.toLowerCase(),
      );
      if (!alreadyProposed) {
        optionalProposals.push({
          key: `scheduled_${safeColumnKey(role.roleName, "role")}`,
          label: `${role.roleName}${/s$/i.test(role.roleName) ? "" : "s"} Scheduled`,
          semantic: "role_headcount",
          dataType: "integer",
          editable: false,
          role: role.roleName,
        });
      }
    }
  }

  const optional = optionalProposals
    .slice(0, 6)
    .map((proposal, index): ProductionPlanColumnDefinition => {
      const fallbackLabel =
        proposal.semantic === "phase"
          ? "Workflow Phase"
          : proposal.semantic === "role_headcount"
            ? `${proposal.role || "Role"} Scheduled`
            : `Custom Field ${index + 1}`;
      return {
        key: safeColumnKey(proposal.key ?? proposal.label, `custom_${index + 1}`),
        label: safeColumnLabel(proposal.label, fallbackLabel),
        semantic: proposal.semantic,
        dataType:
          proposal.semantic === "role_headcount"
            ? "integer"
            : proposal.dataType ?? "text",
        editable: proposal.semantic === "custom" ? Boolean(proposal.editable) : false,
        role: proposal.semantic === "role_headcount" ? text(proposal.role) || undefined : undefined,
      };
    });

  const notesIndex = definitions.findIndex((column) => column.semantic === "notes");
  definitions.splice(notesIndex, 0, ...optional);

  const usedLabels = new Map<string, number>();
  const usedKeys = new Map<string, number>();
  for (const definition of definitions) {
    const normalized = definition.label.toLowerCase();
    const count = (usedLabels.get(normalized) ?? 0) + 1;
    usedLabels.set(normalized, count);
    if (count > 1) definition.label = `${definition.label} (${count})`;

    const keyCount = (usedKeys.get(definition.key) ?? 0) + 1;
    usedKeys.set(definition.key, keyCount);
    if (keyCount > 1) definition.key = `${definition.key}_${keyCount}`;
  }

  return {
    definitions,
    columns: definitions.map((definition) => definition.label),
    isQuantity,
    unitLabel,
  };
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

function assumptionsForPlanningModel(assumptions: string[], planningModel: string): string[] {
  const withoutConflictingModelClaims = assumptions.filter((assumption) =>
    !/\bmodel\b/i.test(assumption) ||
    assumption.toLowerCase().includes(planningModel.toLowerCase())
  );
  const modelAssumption = `Required planning model applied: ${planningModel}.`;
  return [
    ...withoutConflictingModelClaims.filter((assumption) =>
      !assumption.toLowerCase().includes(planningModel.toLowerCase())
    ),
    modelAssumption,
  ];
}

function summaryForPlanningModel(summary: string, planningModel: string): string {
  if (/\bmodel\b/i.test(summary) && !summary.toLowerCase().includes(planningModel.toLowerCase())) {
    return "A structured production plan with auditable targets.";
  }
  return summary;
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
- Use the deterministically extracted constraints as a baseline, but you MUST override them in your proposed settings and provide multiple scenarios if the user asks for optimization, trade-offs, or if the baseline is infeasible.
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
- Always apply ${DEFAULT_PLANNING_MODEL}. Preserve it as an explicit assumption and align phases/risks with that model when safely possible.
- Separate confirmed facts from assumptions.
- Include quality-control work as real effort; do not treat review as free.
- Propose workflow phases, risks, and assumptions specific to the project domain.
- Include project-specific KPIs and chart ideas in the summary/assumptions when useful; application code will create workbook datasets.
- Propose concise schedule column labels that use the user's domain language. For example, use Recorders, Validators, Records, Tickets, Developers, or Machines when those terms appear in the request.
- Every proposed core column must include one semantic from: sequence, date, month, day, planned_staff, planned_output, planned_output_per_person, actual_staff, actual_output, actual_output_per_person, planned_hours, actual_hours, variance, completion_rate, status, notes.
- You may add phase, role_headcount, or custom columns when they materially help this specific plan. role_headcount columns must name the corresponding role.
- Do not return spreadsheet formulas. Application code owns all formulas and calculations.
- Never use a start date earlier than the current date.
- durationUnit must be days, weeks, or months.
- teamSize must be a positive whole number.
- durationValue must be positive. Days and weeks must be whole numbers; months may use decimals such as 0.5.
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
  "roles": [{ "roleName": "string", "headcount": 1 }],
  "scenarios": [{ "scenarioName": "string", "description": "string" }],
  "workbookDesign": {
    "columns": [
      {
        "key": "short_stable_key",
        "label": "Prompt-specific Excel header",
        "semantic": "one of the supported semantics",
        "dataType": "text | integer | decimal | date | percentage",
        "editable": false,
        "role": "required only for role_headcount"
      }
    ]
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

  const dynamicRoles = Array.isArray(value.roles)
    ? value.roles.filter(isRecord).map((r) => ({
        roleName: text(r.roleName, "Production Resource"),
        headcount: Math.round(number(r.headcount, 1)),
      }))
    : [];
  const dynamicScenarios = Array.isArray(value.scenarios)
    ? value.scenarios.filter(isRecord).map((s) => ({
        scenarioName: text(s.scenarioName, "Alternative Scenario"),
        description: text(s.description, "Alternative approach to schedule or budget"),
      }))
    : [];
  const rawWorkbookDesign = isRecord(value.workbookDesign) ? value.workbookDesign : {};
  const dynamicColumns: DynamicColumnProposal[] = Array.isArray(rawWorkbookDesign.columns)
    ? rawWorkbookDesign.columns
        .filter(isRecord)
        .map((column): DynamicColumnProposal | null => {
          const semantic = text(column.semantic) as ProductionPlanColumnSemantic;
          const label = text(column.label);
          if (!label || !PROPOSABLE_COLUMN_SEMANTICS.has(semantic)) return null;
          const proposedDataType = text(column.dataType);
          const dataType: ProductionPlanColumnDataType | undefined =
            proposedDataType === "text" ||
            proposedDataType === "integer" ||
            proposedDataType === "decimal" ||
            proposedDataType === "date" ||
            proposedDataType === "percentage"
              ? proposedDataType
              : undefined;
          return {
            key: text(column.key) || undefined,
            label,
            semantic,
            dataType,
            editable: typeof column.editable === "boolean" ? column.editable : undefined,
            role: text(column.role) || undefined,
          };
        })
        .filter((column): column is DynamicColumnProposal => column !== null)
        .slice(0, 24)
    : [];

  const teamSize = dynamicRoles.length > 0
    ? dynamicRoles.reduce((sum, r) => sum + r.headcount, 0)
    : Math.round(number(rawSettings.teamSize, 1));
  const durationValue = number(rawSettings.durationValue, 30);

  return {
    projectName: text(value.projectName, "Production Plan"),
    client: text(value.client),
    totalAssets: number(value.totalAssets, 0),
    planningSettings: {
      startDate: text(rawSettings.startDate, currentDate),
      durationValue: durationUnit === "months" ? durationValue : Math.round(durationValue),
      durationUnit,
      weekdaysOnly: typeof rawSettings.weekdaysOnly === "boolean" ? rawSettings.weekdaysOnly : true,
      totalHours: number(rawSettings.totalHours, 160),
      teamSize,
      hoursPerDay: typeof rawSettings.hoursPerDay === "number" && rawSettings.hoursPerDay > 0
        ? rawSettings.hoursPerDay : undefined,
      throughputRate: typeof rawSettings.throughputRate === "number" && rawSettings.throughputRate > 0
        ? rawSettings.throughputRate : undefined,
    },
    assumptions: stringArray(value.assumptions),
    phases: phases.length ? phases : [{ name: "Production", objective: "Complete planned work." }],
    risks,
    roles: dynamicRoles,
    scenarios: dynamicScenarios,
    workbookDesign: { columns: dynamicColumns },
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

function distributeInteger(total: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  const extra = total - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < extra ? 1 : 0));
}

function allocateWeightedInteger(total: number, weights: number[]): number[] {
  const rounded = Math.round(total);
  const totalWeight = weights.reduce((sum, weight) => sum + Math.max(weight, 0), 0);
  if (totalWeight <= 0) return distributeInteger(rounded, weights.length);

  const exact = weights.map((weight) => (rounded * Math.max(weight, 0)) / totalWeight);
  const allocated = exact.map(Math.floor);
  let remainder = rounded - allocated.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; i < order.length && remainder > 0; i += 1, remainder -= 1) {
    allocated[order[i]!.index] += 1;
  }
  return allocated;
}

function distributeWeightedQuantity(total: number, counts: number[], weights: number[]): number[] {
  const activeWeights = weights.map((weight, index) => counts[index]! > 0 ? weight : 0);
  const phaseTargets = allocateWeightedInteger(total, activeWeights);
  return counts.flatMap((count, index) => distributeInteger(phaseTargets[index] ?? 0, count));
}

function distributeWeightedHours(totalHours: number, counts: number[], weights: number[]): number[] {
  const totalHundredths = Math.round(totalHours * 100);
  const activeWeights = weights.map((weight, index) => counts[index]! > 0 ? weight : 0);
  const phaseTargets = allocateWeightedInteger(totalHundredths, activeWeights);
  return counts.flatMap((count, index) =>
    distributeInteger(phaseTargets[index] ?? 0, count).map((value) => value / 100),
  );
}

const LPB_WEIGHTS = [0.2, 0.5, 0.3] as const;

function isLpbModel(requested: RequestedConstraints): boolean {
  return /\bLPB\b/i.test(requested.planningModel ?? "");
}

function lpbPhases(): DynamicPhase[] {
  return [
    {
      name: "Learning",
      objective: "Train the team, confirm workflow rules, calibrate quality expectations, and ramp production gradually.",
    },
    {
      name: "Performing",
      objective: "Run the main production workload at the highest stable target while maintaining quality standards.",
    },
    {
      name: "Breakthrough",
      objective: "Complete remaining production, resolve backlogs, perform maintenance, rework exceptions, and validate final output.",
    },
  ];
}

function projectKind(description: string, requested: RequestedConstraints): string {
  if (requested.projectType) return requested.projectType;
  if (/\b(?:capture|collection|collect|text\s+capture|data\s+collection)\b/i.test(description)) return "data collection";
  if (/\b(?:software|app|application|dashboard|website|web\s+site|web\s+development|hris|system|feature|module|developers?)\b/i.test(description)) return "software development";
  if (/\b(?:receipt|invoice|document|ocr|forms?|pages?|manual\s+verification|document\s+processing)\b/i.test(description)) return "document processing";
  if (/\b(?:manufactur(?:e|ing)|machines?|factory|assembly|units?|production\s+line)\b/i.test(description)) return "manufacturing";
  if (/\b(?:content|articles?|posts?|social\s+media|marketing|campaign|videos?|video[-\s]?recording|recordings?|media\s+production)\b/i.test(description)) return "content production";
  if (/\b(?:customer\s+support|tickets?|service\s+desk|helpdesk|calls?|cases?)\b/i.test(description)) return "customer support";
  if (/\b(?:training|workshop|participants?|learners?|curriculum)\b/i.test(description)) return "training";
  if (/\b(?:event|venue|logistics|inventory|shipments?|stock|batches?)\b/i.test(description)) return "operations";
  if (/\bonboarding|new hires?|employees?\b/i.test(description)) return "onboarding";
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
    { name: "Mobilization", objective: "Prepare resources, inputs, and delivery controls." },
    { name: "Production", objective: "Complete the planned work at sustainable daily targets." },
    { name: "QA Review", objective: "Check quality and correct exceptions before closure." },
    { name: "Buffer", objective: "Absorb slippage and complete remaining items." },
    { name: "Closure", objective: "Confirm completion and summarize results." },
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
  if (isLpbModel(requested)) return lpbPhases();
  const kind = projectKind(description, requested);
  const specific = defaultPhases(kind);
  if (proposalPhases.length < 3 || kind !== "production") return specific;
  return proposalPhases;
}

function phaseIndexForIndex(phaseCount: number, index: number, total: number): number {
  return Math.min(
    phaseCount - 1,
    Math.floor((index / Math.max(total, 1)) * phaseCount),
  );
}

function phaseForIndex(phases: DynamicPhase[], index: number, total: number): DynamicPhase {
  const phaseIndex = phaseIndexForIndex(phases.length, index, total);
  return phases[phaseIndex] ?? phases[0]!;
}

function phaseDayCounts(phaseCount: number, total: number): number[] {
  const counts = Array.from({ length: phaseCount }, () => 0);
  for (let index = 0; index < total; index += 1) {
    counts[phaseIndexForIndex(phaseCount, index, total)] += 1;
  }
  return counts;
}

function phasePositionForIndex(phaseCount: number, index: number, total: number): {
  phaseIndex: number;
  phaseDayIndex: number;
  phaseDayCount: number;
} {
  const phaseIndex = phaseIndexForIndex(phaseCount, index, total);
  const counts = phaseDayCounts(phaseCount, total);
  const startIndex = counts.slice(0, phaseIndex).reduce((sum, count) => sum + count, 0);
  return {
    phaseIndex,
    phaseDayIndex: index - startIndex,
    phaseDayCount: counts[phaseIndex] ?? 0,
  };
}

function taskFor(
  kind: string,
  phase: DynamicPhase,
  requested: RequestedConstraints,
  phasePosition?: { phaseDayIndex: number; phaseDayCount: number },
): string {
  if (isLpbModel(requested)) {
    if (phase.name === "Learning") {
      return phasePosition?.phaseDayIndex === 0
        ? "Training day: onboarding, process familiarization, calibration, and coached starter production"
        : "Training day: coached production, error correction, quality review, and workflow adjustment";
    }
    if (phase.name === "Performing") {
      return "Full-production day: maximize planned output while monitoring quality and workforce utilization";
    }
    if (phase.name === "Breakthrough") {
      if (phasePosition && phasePosition.phaseDayIndex >= phasePosition.phaseDayCount - 1) {
        return "Final validation day: final QA, completion review, corrections signoff, and delivery preparation";
      }
      return phasePosition?.phaseDayIndex === 0
        ? "Review day: backlog clearing, quality checks, and rework triage"
        : "Maintenance day: corrections, validation, exception resolution, and remaining production";
    }
  }
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
  dateColumn = "Date",
  notesColumn = "Notes",
): ProductionPlanRow[] {
  const weeks: ProductionPlanRow[] = [];
  for (let index = 0; index < rows.length; index += 5) {
    const chunk = rows.slice(index, index + 5);
    const plannedVolume = chunk.reduce((sum, row) => sum + Number(row[targetColumn] ?? 0), 0);
    weeks.push({
      Week: weeks.length + 1,
      "Start Date": String(chunk[0]?.[dateColumn] ?? ""),
      "End Date": String(chunk.at(-1)?.[dateColumn] ?? ""),
      [volumeKey]: Number(plannedVolume.toFixed(2)),
      Focus: String(chunk[0]?.[notesColumn] ?? "Production"),
      "Review Checkpoint": weeks.length % 2 === 1 ? "Progress review and issue clearing" : "Team lead check-in",
    });
  }
  return weeks;
}

function summarizePhaseRows(
  planRows: ProductionPlanRow[],
  phases: DynamicPhase[],
  targetColumn: string,
  dateColumn: string,
  hoursColumn: string | undefined,
  phaseColumn: string | undefined,
): Array<{
  phase: DynamicPhase;
  rows: ProductionPlanRow[];
  plannedStart: string;
  plannedEnd: string;
  plannedOutput: number;
  plannedHours: number;
  completionPercent: number;
}> {
  const totalOutput = planRows.reduce((sum, row) => sum + Number(row[targetColumn] ?? 0), 0);
  let cumulativeOutput = 0;

  return phases.map((phase, phaseIndex) => {
    const fallbackIndexes = planRows.filter((_, rowIndex) =>
      phaseIndexForIndex(phases.length, rowIndex, planRows.length) === phaseIndex,
    );
    const phaseRows = phaseColumn
      ? planRows.filter((row) => String(row[phaseColumn] ?? "") === phase.name)
      : fallbackIndexes;
    const rows = phaseRows.length ? phaseRows : fallbackIndexes;
    const plannedOutput = rows.reduce((sum, row) => sum + Number(row[targetColumn] ?? 0), 0);
    const plannedHours = hoursColumn
      ? rows.reduce((sum, row) => sum + Number(row[hoursColumn] ?? 0), 0)
      : 0;
    cumulativeOutput += plannedOutput;

    return {
      phase,
      rows,
      plannedStart: String(rows[0]?.[dateColumn] ?? planRows[0]?.[dateColumn] ?? ""),
      plannedEnd: String(rows.at(-1)?.[dateColumn] ?? planRows.at(-1)?.[dateColumn] ?? ""),
      plannedOutput: Number(plannedOutput.toFixed(2)),
      plannedHours: Number(plannedHours.toFixed(2)),
      completionPercent: totalOutput > 0 ? Number(((cumulativeOutput / totalOutput) * 100).toFixed(2)) : 0,
    };
  });
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
  roles?: DynamicRole[],
  lpbDistribution?: LpbDistribution,
  scheduleColumns: {
    target: string;
    date: string;
    notes: string;
    hours?: string;
    phase?: string;
  } = {
    target: "Target Total Hours",
    date: "Date",
    notes: "Notes",
  },
): Array<{ sheetName: string; columns: string[]; rows: ProductionPlanRow[] }> {
  const isQuantity = unitLabel !== "Hours";
  const targetColumn = scheduleColumns.target;
  const volumeKey = isQuantity ? `Planned ${unitLabel}` : "Planned Hours";
  const actualVolumeKey = isQuantity ? `Actual ${unitLabel}` : "Actual Hours";

  const weeklyRows = groupWeeks(
    planRows,
    targetColumn,
    volumeKey,
    scheduleColumns.date,
    scheduleColumns.notes,
  );
  const perResourceHours = Number((settings.totalHours / Math.max(settings.teamSize, 1)).toFixed(2));
  let resources: ProductionPlanRow[] = [];
  if (roles && roles.length > 0) {
    roles.forEach(roleObj => {
      for (let i = 0; i < roleObj.headcount; i++) {
        resources.push({
          Resource: `${roleObj.roleName} ${i + 1}`,
          Role: roleObj.roleName,
          "Planned Hours": perResourceHours,
          "Primary Focus": phases[resources.length % phases.length]?.name ?? "Production",
          Notes: settings.weekdaysOnly ? "Weekday allocation" : "Calendar-day allocation",
        });
      }
    });
  } else {
    resources = Array.from({ length: settings.teamSize }, (_, index) => ({
      Resource: `Resource ${index + 1}`,
      Role: kind === "annotation" ? "Annotator" : kind === "onboarding" ? "Employee / Buddy" : "Production resource",
      "Planned Hours": perResourceHours,
      "Primary Focus": phases[index % phases.length]?.name ?? "Production",
      Notes: settings.weekdaysOnly ? "Weekday allocation" : "Calendar-day allocation",
    }));
  }
  const milestoneRows = phases.map((phase, index) => {
    const dateIndex = Math.min(
      planRows.length - 1,
      Math.round(((index + 1) / phases.length) * planRows.length) - 1,
    );
    return {
      Milestone: `${phase.name} complete`,
      "Target Date": String(
        planRows[dateIndex]?.[scheduleColumns.date] ??
        planRows.at(-1)?.[scheduleColumns.date] ??
        "",
      ),
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
    { Metric: "End date", Value: String(planRows.at(-1)?.[scheduleColumns.date] ?? "") },
    { Metric: "Total planned hours", Value: settings.totalHours },
    { Metric: "Team size", Value: settings.teamSize },
    { Metric: "Schedule mode", Value: settings.weekdaysOnly ? "Weekdays only" : "Calendar days" },
  ];
  if (isQuantity && totalQuantity != null) {
    summaryRows.push({ Metric: `Total planned ${unitLabel.toLowerCase()}`, Value: totalQuantity });
  }
  if (isLpbModel(requested)) {
    summaryRows.push({ Metric: "LPB output split", Value: "Learning 20%, Performing 50%, Breakthrough 30%" });
  }

  const productiveHoursPerResourcePerDay = 8;
  const availableHours = Number((settings.teamSize * planRows.length * productiveHoursPerResourcePerDay).toFixed(2));
  const qualityReviewHours = Number(Math.max(settings.totalHours * 0.12, planRows.length * 0.25).toFixed(2));
  const productionHours = Number(Math.max(settings.totalHours - qualityReviewHours, 0).toFixed(2));
  const utilization = availableHours > 0 ? Number(((settings.totalHours / availableHours) * 100).toFixed(2)) : 0;
  const hasDeterministicCapacity =
    isQuantity &&
    requested.totalHours === undefined &&
    requested.totalQuantity !== undefined &&
    requested.teamSize !== undefined &&
    requested.duration !== undefined;
  const assumedProductivity = isQuantity && requested.totalHours === undefined && !hasDeterministicCapacity;
  const feasibility = feasibilityStatus(settings.totalHours, availableHours, assumedProductivity);
  const requiredDailyOutput = isQuantity && totalQuantity
    ? Number((totalQuantity / planRows.length).toFixed(2))
    : Number((settings.totalHours / planRows.length).toFixed(2));
  const requiredOutputPerResourcePerDay = Number((requiredDailyOutput / settings.teamSize).toFixed(2));
  const role = roleForKind(kind);
  const phaseStats = summarizePhaseRows(
    planRows,
    phases,
    targetColumn,
    scheduleColumns.date,
    scheduleColumns.hours,
    scheduleColumns.phase,
  );
  const phaseRows = phaseStats.map((phaseStat, index) => {
    return {
      "Stage ID": `STG-${String(index + 1).padStart(2, "0")}`,
      "Stage Name": phaseStat.phase.name,
      Purpose: phaseStat.phase.objective,
      "Owner Role": role,
      Inputs: index === 0 ? "Project request and confirmed constraints" : `${phases[index - 1]?.name} outputs`,
      Outputs: `${phaseStat.phase.name} deliverables`,
      "Planned Start": phaseStat.plannedStart,
      "Planned End": phaseStat.plannedEnd,
      "Estimated Hours": phaseStat.plannedHours || Number((settings.totalHours / phases.length).toFixed(2)),
      Dependencies: index === 0 ? "" : `STG-${String(index).padStart(2, "0")}`,
      "Completion Criteria": phaseStat.phase.objective,
    };
  });
  const taskRows = phaseRows.map((phase, index) => {
    const isQualityTask = /qa|quality|test|review|inspection|verification/i.test(String(phase["Stage Name"]));
    const phaseStat = phaseStats[index]!;
    const phaseDailyTarget = phaseStat.rows.length > 0
      ? Number((phaseStat.plannedOutput / phaseStat.rows.length).toFixed(2))
      : requiredDailyOutput;
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
      "Planned Quantity": isQuantity && totalQuantity ? phaseStat.plannedOutput : Number(phase["Estimated Hours"]),
      "Production Unit": unitLabel.toLowerCase(),
      "Daily Target": phaseDailyTarget,
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
    { "Chart ID": "CHART-001", "Chart Title": `Planned ${unitLabel} by Day`, "Chart Type": "line", Purpose: "Show daily production targets", "Source Worksheet": "Production Plan", "Category Field": scheduleColumns.date, "Value Fields": targetColumn, Aggregation: "sum", Filters: "", "Display Target": "BOTH" },
    { "Chart ID": "CHART-002", "Chart Title": "Capacity vs Required Hours", "Chart Type": "bar", Purpose: "Compare available and required hours", "Source Worksheet": "Capacity Analysis", "Category Field": "Metric", "Value Fields": "Value", Aggregation: "none", Filters: "Available person-hours, Required hours, Buffer hours", "Display Target": "BOTH" },
    { "Chart ID": "CHART-003", "Chart Title": "Risk Distribution", "Chart Type": "bar", Purpose: "Summarize risks by impact", "Source Worksheet": "Risk Register", "Category Field": "Impact", "Value Fields": "Risk ID", Aggregation: "count", Filters: "", "Display Target": "DASHBOARD" },
  ];
  const lpbRows: ProductionPlanRow[] = phaseStats.map((phaseStat, index) => ({
    Phase: phaseStat.phase.name,
    "Duration Days": phaseStat.rows.length,
    "Target Share": `${Math.round((LPB_WEIGHTS[index] ?? 0) * 100)}%`,
    [volumeKey]: phaseStat.plannedOutput,
    "Target Employees": settings.teamSize,
    "Records per Employee": Number((phaseStat.plannedOutput / Math.max(settings.teamSize, 1)).toFixed(2)),
    "Target Hours": phaseStat.plannedHours,
    "Expected Completion %": phaseStat.completionPercent,
    Focus: phaseStat.phase.objective,
  }));

  return [
    ...(isLpbModel(requested)
      ? [{
          sheetName: "LPB Phase Summary",
          columns: ["Phase", "Duration Days", "Target Share", volumeKey, "Target Employees", "Records per Employee", "Target Hours", "Expected Completion %", "Focus"],
          rows: lpbRows,
        }]
      : []),
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
    ...(lpbDistribution ? [{
      sheetName: "LPB Allocation",
      columns: ["Stage", "Workload Share (%)", "Scheduled Days", "Start Date", "End Date", "Planned Workload", "Unit"],
      rows: lpbDistribution.stages.map((stage) => ({
        Stage: stage.stageLabel,
        "Workload Share (%)": stage.workloadPercentage,
        "Scheduled Days": stage.scheduledDays,
        "Start Date": String(planRows[stage.startIndex]?.Date ?? ""),
        "End Date": String(planRows[stage.endIndex]?.Date ?? ""),
        "Planned Workload": stage.target,
        Unit: unitLabel.toLowerCase(),
      })),
    }] : []),
    {
      sheetName: "Project Information",
      columns: ["Field", "Value"],
      rows: [
        { Field: "Project category", Value: kind },
        { Field: "Production unit", Value: unitLabel.toLowerCase() },
        { Field: "Planning model", Value: settings.planningModel },
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

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function safeDate(row: ProductionPlanRow | undefined, dateColumn = "Date"): string {
  return row ? String(row[dateColumn] ?? "") : "";
}

function analyzeStaffingChanges(
  description: string,
  rows: ProductionPlanRow[],
  settings: ResolvedPlanningSettings
) {
  return {
    isReplan: false,
    completedRows: [] as ProductionPlanRow[],
    remainingRows: rows,
    staffingRows: [] as Array<{
      "Effective Date": string;
      Change: string;
      "Removed Employees": number;
      "Added Junior Employees": number;
      "Added Experienced Employees": number;
      "Planned Headcount": number;
      "Effective Capacity Units": number;
      Reason: string;
    }>
  };
}

function buildForecast(
  rows: ProductionPlanRow[],
  targetKey: string,
  dateKey: string,
  settings: ResolvedPlanningSettings,
  staffing: ReturnType<typeof analyzeStaffingChanges>,
  hoursPerDay: number
) {
  return {
    scheduleVarianceDays: 0,
    capacityShortfall: 0,
    revisedCompletionDate:
      rows.length > 0 ? String(rows[rows.length - 1]![dateKey] ?? "") : "",
    laborVarianceHours: 0,
    bottleneckPhase: "None",
    effectiveCapacity: settings.totalHours,
    rows: [] as Array<{ Metric: string; Value: string | number; Unit: string }>
  };
}

function buildScenarioRows(
  settings: ResolvedPlanningSettings,
  durationDays: number,
  plannedDeadline: string,
  hoursPerDay: number
) {
  return [
    {
      Scenario: "Baseline",
      "Staffing Requirement": settings.teamSize,
      "Overtime Hours/Person/Day": 0,
      "Total Labor Hours": settings.totalHours,
      "Estimated Cost": "$0",
      "Expected Completion Date": plannedDeadline,
      "Deadline Feasible": "Yes",
      "Utilization Rate": "100%",
      "Overtime Requirement": "None",
      "Risk Level": "Low",
      Pros: "Baseline",
      Cons: "None",
      "Scenario Score": 100
    }
  ];
}

function bestScenario(scenarioRows: ReturnType<typeof buildScenarioRows>) {
  return { name: scenarioRows[0]?.Scenario ?? "Baseline" };
}

export function buildDynamicPlan(
  input: { projectDescription: string },
  proposal: DynamicPlanProposal,
  currentDate: string,
): DynamicPlanResult {
  const settings = resolvePlanningSettings(input.projectDescription, currentDate, proposal.planningSettings);
  const dates = buildScheduleDates(settings);
  const requested = extractRequestedConstraints(input.projectDescription, currentDate);
  const useLpbModel = isLpbModel(requested);
  const kind = projectKind(input.projectDescription, requested);
  const phases = choosePhases(input.projectDescription, proposal.phases, requested);
  const phaseCounts = phaseDayCounts(phases.length, dates.length);
  const hours = useLpbModel
    ? distributeWeightedHours(settings.totalHours, phaseCounts, [...LPB_WEIGHTS])
    : distributeHours(settings.totalHours, dates.length);
  const effectiveRisks = proposal.risks.length ? proposal.risks : defaultRisks(kind);
  const totalQuantity = settings.totalQuantity ?? (settings.unitOfMeasure && proposal.totalAssets > 0 ? Math.round(proposal.totalAssets) : undefined);
  const unitOfMeasure = settings.unitOfMeasure ?? requested.unitOfMeasure;
  const resourceLabel = resourceLabelFor(kind, unitOfMeasure);
  const resourcePlural = pluralResourceLabel(resourceLabel);

  // Select column profile based on detected unit of measure.
  const { columns: planColumns, isQuantity, unitLabel } = selectColumnProfile(totalQuantity != null ? unitOfMeasure : undefined, resourceLabel, resourcePlural);
  const lpbDistribution = buildLpbDistribution(
    isQuantity && totalQuantity != null ? totalQuantity : settings.totalHours,
    dates.length,
    isQuantity ? 0 : 2,
  );
  const hours = isQuantity
    ? distributeHours(settings.totalHours, dates.length)
    : lpbDistribution.daily.map((allocation) => allocation.target);
  const workbookColumns = proposal.workbookDesign?.columns ?? [];
  const lpbAutoColumns: DynamicColumnProposal[] = [];
  if (useLpbModel && !workbookColumns.some((column) => column.semantic === "phase")) {
    lpbAutoColumns.push({
      key: "lpb_phase",
      label: "LPB Phase",
      semantic: "phase",
      dataType: "text",
      editable: false,
    });
  }
  if (useLpbModel && !workbookColumns.some((column) => /expected\s+completion/i.test(column.label))) {
    lpbAutoColumns.push({
      key: "lpb_expected_completion",
      label: "Expected Completion %",
      semantic: "custom",
      dataType: "percentage",
      editable: false,
    });
  }
  const scheduleColumns = lpbAutoColumns.length
    ? [...lpbAutoColumns, ...workbookColumns]
    : workbookColumns;

  const {
    definitions: planColumnDefinitions,
    columns: planColumns,
    isQuantity,
    unitLabel,
  } = buildColumnProfile(
    totalQuantity != null ? unitOfMeasure : undefined,
    scheduleColumns,
    proposal.roles,
  );
  const labelFor = (semantic: ProductionPlanColumnSemantic): string => {
    const definition = planColumnDefinitions.find((column) => column.semantic === semantic);
    if (!definition) throw new Error(`Dynamic schedule is missing required ${semantic} column`);
    return definition.label;
  };

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

  // Apply the deterministic LPB 20%-50%-30% workload split across the schedule.
  const quantities = isQuantity && totalQuantity != null
    ? lpbDistribution.daily.map((allocation) => allocation.target)
    : null;
  const availableHours = settings.teamSize * dates.length * 8;
  const hasDeterministicCapacity =
    isQuantity &&
    requested.totalHours === undefined &&
    requested.totalQuantity !== undefined &&
    requested.teamSize !== undefined &&
    requested.duration !== undefined;
  const assumedRate = isQuantity && requested.totalHours === undefined && !hasDeterministicCapacity;
  const feasibility = feasibilityStatus(settings.totalHours, availableHours, assumedRate);
  const requiredDailyOutput = Number(((isQuantity && totalQuantity ? totalQuantity : settings.totalHours) / dates.length).toFixed(2));
  const utilizationPercent = availableHours > 0
    ? Number(((settings.totalHours / availableHours) * 100).toFixed(2))
    : 0;

  const targetKey = labelFor("planned_output");
  const plannedStaffKey = labelFor("planned_staff");
  const dateKey = labelFor("date");
  const notesKey = labelFor("notes");
  const plannedHoursKey = labelFor("planned_hours");
  const phaseKey = planColumnDefinitions.find((column) => column.semantic === "phase")?.label;

  let cumulativeTarget = 0;
  const rows: ProductionPlanRow[] = dates.map((date, index) => {
    const lpbDay = lpbDistribution.daily[index]!;
    const targetVal = quantities != null ? quantities[index]! : hours[index]!;
    cumulativeTarget += Number(targetVal);
    const perAnnotVal = quantities != null
      ? Math.round(quantities[index]! / settings.teamSize)
      : Number((hours[index]! / settings.teamSize).toFixed(2));
    return {
      "No.": index + 1,
      Date: date,
      Month: monthName(date),
      Day: new Date(`${date}T00:00:00Z`).toLocaleString("en-US", { weekday: "short", timeZone: "UTC" }),
      [teamKey]: settings.teamSize,
      [targetKey]: targetVal,
      [targetPerResourceKey]: perResourceVal,
      [actualTeamKey]: "",
      [actualKey]: "",
      [actualPerResourceKey]: "",
      "Target Hours": hours[index]!,   // capacity reference — always present
      "Actual Hours": "",
      "Total Variance": "",
      "Completion Rate (%)": "",
      Status: "Not Started",
      Notes: `[${lpbDay.stageLabel} ${lpbDay.workloadPercentage}%] ${taskFor(kind, phaseForIndex(phases, index, dates.length), requested)}`,
    };
    const phasePosition = phasePositionForIndex(phases.length, index, dates.length);
    const phase = phases[phasePosition.phaseIndex] ?? phaseForIndex(phases, index, dates.length);
    const row: ProductionPlanRow = {};

    for (const column of planColumnDefinitions) {
      if (column.semantic === "sequence") row[column.label] = index + 1;
      else if (column.semantic === "date") row[column.label] = date;
      else if (column.semantic === "month") row[column.label] = monthName(date);
      else if (column.semantic === "day") {
        row[column.label] = new Date(`${date}T00:00:00Z`).toLocaleString("en-US", {
          weekday: "short",
          timeZone: "UTC",
        });
      } else if (column.semantic === "phase") row[column.label] = phase.name;
      else if (column.semantic === "planned_staff") row[column.label] = settings.teamSize;
      else if (column.semantic === "role_headcount") {
        const matchingRole = proposal.roles?.find(
          (role) => role.roleName.toLowerCase() === column.role?.toLowerCase(),
        );
        row[column.label] = matchingRole?.headcount ?? 0;
      } else if (column.semantic === "planned_output") row[column.label] = targetVal;
      else if (column.semantic === "planned_output_per_person") row[column.label] = perAnnotVal;
      else if (
        column.semantic === "actual_staff" ||
        column.semantic === "actual_output" ||
        column.semantic === "actual_output_per_person" ||
        column.semantic === "actual_hours" ||
        column.semantic === "variance"
      ) {
        row[column.label] = "";
      } else if (column.semantic === "completion_rate") {
        row[column.label] = "";
      } else if (column.semantic === "planned_hours") row[column.label] = hours[index]!;
      else if (column.semantic === "status") row[column.label] = "Not Started";
      else if (column.semantic === "notes") {
        row[column.label] = taskFor(kind, phase, requested, phasePosition);
      } else if (column.semantic === "custom" && column.key === "lpb_expected_completion") {
        const denominator = isQuantity && totalQuantity ? totalQuantity : settings.totalHours;
        row[column.label] = denominator > 0
          ? Number(((cumulativeTarget / denominator) * 100).toFixed(2))
          : "";
      } else {
        row[column.label] = "";
      }
    }

    return row;
  });

  // ── Assumptions ───────────────────────────────────────────────────────────
  const distributionNote = isQuantity && totalQuantity != null
    ? `${totalQuantity.toLocaleString()} ${unitLabel.toLowerCase()} distributed using LPB workload shares: L 20%, P 50%, B 30%.`
    : `Total target hours are distributed using LPB workload shares: L 20%, P 50%, B 30%.`;

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
    ...assumptionsForPlanningModel(proposal.assumptions, settings.planningModel),
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
    unitLabel, totalQuantity, proposal.roles, lpbDistribution
  );
  const plannedDeadline = dates.at(-1)!;
  const staffing = analyzeStaffingChanges(input.projectDescription, rows, settings);
  const forecast = buildForecast(rows, targetKey, dateKey, settings, staffing, hoursPerDay);
  const scenarioRows = buildScenarioRows(settings, dates.length, plannedDeadline, hoursPerDay);
  const recommendedScenario = bestScenario(scenarioRows);
  const currentActualRows = staffing.completedRows.length
    ? staffing.completedRows.map((row, index) => ({
        Period: String(row[dateKey] ?? ""),
        "Historical Assignment": `Original ${String(row[plannedStaffKey] ?? 0)} resource(s)`,
        "Planned Work": Number(row[targetKey] ?? 0),
        "Actual Work Preserved": Number(row[targetKey] ?? 0),
        Status: "Completed",
        Notes: "Preserved from active project history; remaining plan recalculated separately.",
      }))
    : [{ Period: "Not reported", "Historical Assignment": "", "Planned Work": 0, "Actual Work Preserved": 0, Status: "No actuals supplied", Notes: "No completed work was inferred from the prompt." }];
  const remainingWorkRows = groupWeeks(
    staffing.remainingRows,
    targetKey,
    `Revised ${unitLabel}`,
    dateKey,
    notesKey,
  );
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
          "Planned Start": safeDate(rows[Math.max(startIndex, 0)], dateKey),
          "Planned End": safeDate(rows[Math.max(endIndex, startIndex)], dateKey),
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
    {
      sheetName: "Production Plan",
      columns: planColumns,
      columnDefinitions: planColumnDefinitions,
      rows,
    },
    ...supportSheets,
    ...advancedSheets,
  ];
  if (proposal.scenarios && proposal.scenarios.length > 0) {
    workbookSheets.push({
      sheetName: "AI Recommendations",
      columns: ["Scenario", "Description"],
      rows: proposal.scenarios.map(s => ({ Scenario: s.scenarioName, Description: s.description })),
    });
  }
  const structuredPlan = {
    projectSummary: {
      targetRecords: totalQuantity ?? settings.totalHours,
      duration: `${dates.length} working day(s)`,
      deadline: plannedDeadline,
      laborBudgetHours: settings.totalHours,
      feasible: feasibility !== "NOT_FEASIBLE" && forecast.capacityShortfall === 0,
    },
    parsedInputs: {
      roles: proposal.roles && proposal.roles.length ? proposal.roles.map(r => r.roleName) : [roleForKind(kind), "Quality reviewer", "Project lead"],
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
      planningModel: settings.planningModel,
      projectCategory: kind,
      productionUnit: unitLabel.toLowerCase(),
      feasibilityStatus: feasibility,
      requiredDailyOutput,
      utilizationPercent,
    },
    workbook: {
      sheets: [
        {
          sheetName: "Production Plan",
          columns: planColumns,
          columnDefinitions: planColumnDefinitions,
          rows,
        },
        ...supportSheets,
      ],
    },
    summary:
      `${summaryForPlanningModel(proposal.summary, settings.planningModel)} Planning model: ${settings.planningModel} with L/P/B workload shares of 20%/50%/30%. Feasibility: ${feasibility}. ` +
      `Planned workload: ${isQuantity && totalQuantity ? totalQuantity.toLocaleString() : settings.totalHours} ${unitLabel.toLowerCase()} ` +
      `from ${dates[0]} to ${dates.at(-1)} with ${settings.teamSize} resource(s). ` +
      `Required daily output: ${requiredDailyOutput} ${unitLabel.toLowerCase()}; utilization: ${utilizationPercent}%.`,
  };
  return {
    plan, settings, phases, risks: effectiveRisks,
    unitLabel: isQuantity ? unitLabel : undefined,
    totalQuantity: isQuantity ? totalQuantity : undefined,
    throughputRate: isQuantity ? effectiveThroughputRate : undefined,
    hoursPerDay: isQuantity ? hoursPerDay : undefined,
  };

}
