import {
  addDays,
  extractNormalizedDateConstraints,
  formatIsoDate,
  isIsoDate,
  isWeekday,
  nextBusinessDay,
  parseIsoDate,
  type DateInterpretation,
} from "./dateNormalizationService.js";

export type DurationUnit = "days" | "weeks" | "months";

export interface DurationConstraint {
  value: number;
  unit: DurationUnit;
}

export interface RequestedConstraints {
  durationDays?: number;
  duration?: DurationConstraint;
  totalHours?: number;
  teamSize?: number;
  weekdaysOnly?: boolean;
  startDate?: string;
  endDate?: string;
  allowPastDates?: boolean;
  dateInterpretations?: DateInterpretation[];
  projectType?: string;
  priority?: string;
  deliverables?: string[];
  needsQa?: boolean;
  needsReview?: boolean;
  needsBuffer?: boolean;
  needsWeeklyTracking?: boolean;
  workingDays?: number[];
  /** Unit of measure extracted from the prompt (e.g. "images", "records"). */
  unitOfMeasure?: string;
  /** Total quantity of units extracted from the prompt (e.g. 350000). */
  totalQuantity?: number;
  /** Named planning model or operating model requested by the user (e.g. "LPB Model"). */
  planningModel?: string;
  /** Throughput rate in units per person per hour (e.g. 50 for "50 images/hour"). */
  throughputRate?: number;
  /** Throughput rate in units per person per day (e.g. 400 for "400 images/day"). */
  throughputPerDay?: number;
}

export interface PlanningDefaults {
  startDate?: string;
  durationValue?: number;
  durationUnit?: DurationUnit;
  totalHours?: number;
  teamSize?: number;
  weekdaysOnly?: boolean;
  workingDays?: number[];
  unitOfMeasure?: string;
  totalQuantity?: number;
}

export interface ResolvedPlanningSettings {
  startDate: string;
  endDate?: string;
  duration: DurationConstraint;
  totalHours: number;
  teamSize: number;
  weekdaysOnly: boolean;
  workingDays?: number[];
  unitOfMeasure?: string;
  totalQuantity?: number;
  holidays?: string[];
  overtimeLimitHoursPerPersonPerDay?: number;
}

function toIsoDate(value: string): string | undefined {
  if (isIsoDate(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return undefined;
  const iso = date.toISOString().slice(0, 10);
  return isIsoDate(iso) ? iso : undefined;
}

function positive(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new Error(`${name} must be greater than zero`);
  }
  return resolved;
}

function inferProjectType(description: string): string | undefined {
  if (/\b(?:capture|collection|collect|text\s+capture|data\s+collection)\b/i.test(description)) return "data collection";
  if (/\b(?:software|app|application|dashboard|website|web\s+site|web\s+development|hris|system|feature|module|developers?)\b/i.test(description)) return "software development";
  if (/\b(?:receipt|invoice|document|ocr|forms?|pages?|manual\s+verification|document\s+processing)\b/i.test(description)) return "document processing";
  if (/\b(?:manufactur(?:e|ing)|machines?|factory|assembly|units?|production\s+line)\b/i.test(description)) return "manufacturing";
  if (/\b(?:content|articles?|posts?|social\s+media|marketing|campaign|videos?|media\s+production)\b/i.test(description)) return "content production";
  if (/\b(?:customer\s+support|tickets?|service\s+desk|helpdesk|calls?|cases?)\b/i.test(description)) return "customer support";
  if (/\b(?:training|workshop|participants?|learners?|curriculum)\b/i.test(description)) return "training";
  if (/\b(?:event|venue|logistics|inventory|shipments?|stock|batches?)\b/i.test(description)) return "operations";
  if (/\bonboarding|new hires?|employees?\b/i.test(description)) return "onboarding";
  if (/\bannotat(?:e|ion|ors?)|label(?:ing|lers?)\b/i.test(description)) return "annotation";
  if (/\bdata\s+encoding|encode|encoder|enrollment\s+records?\b/i.test(description)) return "data encoding";
  if (/\bresearch|study|survey\b/i.test(description)) return "research";
  if (/\bvalidation|validate|verification\b/i.test(description)) return "validation";
  return undefined;
}

function inferDefaultWeekdaysOnly(description: string): boolean {
  return /\b(?:office|company|team|employee|employees|staff|people|annotators?|workers?|agents?|members?|onboarding|encoding|encode|records?|validation|production|work|software|developers?|manufacturing|machines?|documents?|receipts?)\b/i
    .test(description);
}

function extractDeliverables(description: string): string[] {
  const requested = [
    ["QA", /\bqa|quality\s+assurance|quality\s+checks?\b/i],
    ["Review", /\breview|sign-?off|approval\b/i],
    ["Buffer", /\bbuffer|contingency\b/i],
    ["Weekly progress tracking", /\bweekly\s+(?:progress\s+)?tracking|weekly\s+summary|weekly\s+report\b/i],
    ["Milestones", /\bmilestones?\b/i],
  ] as const;
  return requested.filter(([, pattern]) => pattern.test(description)).map(([label]) => label);
}

function extractWorkingDays(description: string): number[] | undefined {
  const days = [
    ["sunday", 0],
    ["monday", 1],
    ["tuesday", 2],
    ["wednesday", 3],
    ["thursday", 4],
    ["friday", 5],
    ["saturday", 6],
  ] as const;
  if (
    !/\b(?:on|only|every)\s+(?:mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?)\b/i.test(description) &&
    !/\b(?:working|work)\s+days?\s+(?:are|:)\b/i.test(description)
  ) {
    return undefined;
  }
  const matched = days
    .filter(([name]) => new RegExp(`\\b${name}s?\\b`, "i").test(description))
    .map(([, value]) => value);
  return matched.length ? [...new Set(matched)].sort((a, b) => a - b) : undefined;
}

const productionUnitPattern =
  /(images?|records?|documents?|receipts?|invoices?|forms?|items?|files?|responses?|entries?|clips?|pages?|units?|samples?|videos?|tasks?|features?|modules?|tickets?|articles?|posts?|engagements?|likes?|views?|shares?|impressions?|clicks?|leads?|batches?|participants?|transactions?)/i;

function normalizeQuantity(rawNumber: string, suffix: string | undefined): number {
  const raw = Number(rawNumber.replace(/,/g, ""));
  const normalizedSuffix = (suffix ?? "").toLowerCase();
  const multiplier = normalizedSuffix === "k" ? 1_000 : normalizedSuffix === "m" ? 1_000_000 : 1;
  return Math.round(raw * multiplier);
}

export function extractRequestedConstraints(
  description: string,
  currentDate = new Date().toISOString().slice(0, 10),
): RequestedConstraints {
  const numberWordMap: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
  };
  const numberToken = String.raw`(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)`;
  const tokenNumber = (value: string | undefined): number | undefined => {
    if (!value) return undefined;
    const normalized = value.toLowerCase();
    return numberWordMap[normalized] ?? Number(normalized);
  };
  const durationMatch =
    description.match(new RegExp(String.raw`\b(?:within|for|over|during)?\s*${numberToken}\s*[- ]?(?:calendar\s+)?(days?|weeks?|months?)\b`, "i")) ??
    description.match(new RegExp(String.raw`\bnext\s+${numberToken}\s+(weekdays?|business\s+days?)\b`, "i"));
  const weekdayDurationMatch = description.match(new RegExp(String.raw`\b(?:for\s+)?(?:the\s+)?next\s+${numberToken}\s+(weekdays?|business\s+days?)\b`, "i")) ??
    description.match(new RegExp(String.raw`\bfor\s+${numberToken}\s+(weekdays?|business\s+days?)\b`, "i"));
  const hoursMatch = description.match(new RegExp(String.raw`\b${numberToken}\s+(?:total\s+|working\s+|productive\s+)?hours?\b`, "i"));
  const teamMatch =
    description.match(new RegExp(String.raw`\b(?:class|team|group|crew)\s+of\s+${numberToken}\b`, "i")) ??
    description.match(new RegExp(String.raw`\b${numberToken}\s+(?:active\s+)?(?:annotators?|workers?|agents?|people|members?|employees?|staff|encoders?|resources?|developers?|engineers?|testers?|reviewers?|designers?|writers?|editors?|machines?|operators?)\b`, "i"));
  const normalizedDates = extractNormalizedDateConstraints(description, currentDate);
  const workingDays = extractWorkingDays(description);

  const constraints: RequestedConstraints = {};
  if (weekdayDurationMatch) {
    const value = tokenNumber(weekdayDurationMatch[1]) ?? 1;
    constraints.duration = { value, unit: "days" };
    constraints.durationDays = value;
    constraints.weekdaysOnly = true;
  } else if (durationMatch) {
    const unitText = durationMatch[2]!.toLowerCase();
    const unit: DurationUnit = unitText.startsWith("day")
      ? "days"
      : unitText.startsWith("week")
        ? "weeks"
        : "months";
    const value = tokenNumber(durationMatch[1]) ?? 1;
    constraints.duration = { value, unit };
    if (unit === "days") constraints.durationDays = value;
  }
  if (hoursMatch) {
    const tail = description.slice((hoursMatch.index ?? 0) + hoursMatch[0].length, (hoursMatch.index ?? 0) + hoursMatch[0].length + 24);
    if (!/^\s*(?:per|\/)\s*(?:weekday|day|worker|resource|person|machine|shift)/i.test(tail)) {
      constraints.totalHours = tokenNumber(hoursMatch[1]);
    }
  }
  if (teamMatch) constraints.teamSize = tokenNumber(teamMatch[1]);
  if (/\b(?:weekdays?\s+only|business\s+days?|monday\s+(?:through|to|-)\s+friday|avoid\s+weekends?|excluding\s+weekends?|no\s+weekends?)\b/i.test(description)) {
    constraints.weekdaysOnly = true;
  } else if (/\b(?:calendar\s+(?:days?|weeks?|months?)|including\s+weekends?|weekends?\s+included|seven\s+days\s+a\s+week)\b/i.test(description)) {
    constraints.weekdaysOnly = false;
  }
  if (workingDays) {
    constraints.workingDays = workingDays;
    constraints.weekdaysOnly = workingDays.every((day) => day >= 1 && day <= 5);
  }
  if (normalizedDates.startDate) {
    constraints.startDate = normalizedDates.startDate;
    if (normalizedDates.startDate < currentDate) constraints.allowPastDates = true;
  } else if (/\b(?:starting|starts?|from)(?:\s+date\s+of)?\s+today\b/i.test(description)) {
    constraints.startDate = currentDate;
  }
  if (normalizedDates.endDate) constraints.endDate = normalizedDates.endDate;
  if (normalizedDates.interpretations.length) {
    constraints.dateInterpretations = normalizedDates.interpretations;
  }
  if (/\b(?:historical|backdated|in the past|past plan)\b/i.test(description)) {
    constraints.allowPastDates = true;
  }
  const projectType = inferProjectType(description);
  if (projectType) constraints.projectType = projectType;
  if (/\bhigh\s+priority|urgent|rush\b/i.test(description)) constraints.priority = "high";
  else if (/\blow\s+priority\b/i.test(description)) constraints.priority = "low";
  const deliverables = extractDeliverables(description);
  if (deliverables.length) constraints.deliverables = deliverables;
  if (/\bqa|quality\s+assurance|quality\s+checks?\b/i.test(description)) constraints.needsQa = true;
  if (/\breview|sign-?off|approval\b/i.test(description)) constraints.needsReview = true;
  if (/\bbuffer|contingency\b/i.test(description)) constraints.needsBuffer = true;
  if (/\bweekly\s+(?:progress\s+)?tracking|weekly\s+summary|weekly\s+report\b/i.test(description)) {
    constraints.needsWeeklyTracking = true;
  }
  const modelMatch = description.match(/\b(?:apply|use|using|under)\s+([A-Z][A-Z0-9]{1,12})\s+model\b/i) ??
    description.match(/\b([A-Z][A-Z0-9]{1,12})\s+model\b/i);
  if (modelMatch) constraints.planningModel = `${modelMatch[1]!.toUpperCase()} Model`;

  // ── Quantity extraction (multi-pass) ─────────────────────────────────────────
  // Matches: "350,000 images", "1M records", "target of 350000 images",
  //          "images to be collected is 350000", "total number images... 350000", "target number of post engaged is 10000"
  const UNIT_PAT = "(?:audio\\s+clips?|video\\s+clips?|video\\s+frames?|images?|records?|documents?|receipts?|items?|files?|responses?|entries?|clips?|pages?|units?|samples?|videos?|tasks?|frames?|utterances?|segments?|prompts?|queries?|articles?|captions?|audios?|photos?|labels?|annotations?|rows?|posts?|engagements?|likes?|views?|shares?|impressions?|clicks?|leads?|conversions?)";
  const NUM_PAT = "([\\d,]+)(?:\\s*([kKmM]))?";

  function parseQuantityNum(raw: string, suffix: string | undefined): number {
    const n = Number(raw.replace(/,/g, ""));
    const mult = (suffix ?? "").toLowerCase() === "k" ? 1_000 : (suffix ?? "").toLowerCase() === "m" ? 1_000_000 : 1;
    return Math.round(n * mult);
  }

  // Pass 1 — NUMBER directly adjacent to UNIT: "350000 images"
  const p1 = new RegExp(`\\b${NUM_PAT}\\s+(${UNIT_PAT})\\b`, "i").exec(description);
  if (p1) {
    constraints.totalQuantity = parseQuantityNum(p1[1]!, p1[2]);
    constraints.unitOfMeasure = p1[3]!.toLowerCase();
  } else {
    // Pass 2 — NUMBER then UNIT (number first, unit within ~80 chars, no sentence boundary between)
    const p2 = new RegExp(`\\b${NUM_PAT}\\b[^.!?\\n]{0,80}?\\b(${UNIT_PAT})\\b`, "i").exec(description);
    if (p2) {
      constraints.totalQuantity = parseQuantityNum(p2[1]!, p2[2]);
      constraints.unitOfMeasure = p2[3]!.toLowerCase();
    } else {
      // Pass 3 — UNIT then NUMBER (unit first, e.g. "images to be collected is 350000")
      const p3 = new RegExp(`\\b(${UNIT_PAT})\\b[^.!?\\n]{0,80}?\\b${NUM_PAT}\\b`, "i").exec(description);
      if (p3) {
        constraints.totalQuantity = parseQuantityNum(p3[2]!, p3[3]);
        constraints.unitOfMeasure = p3[1]!.toLowerCase();
      }
    }
  }

  // Pass 4 — "target number of post engaged is 10000" or "target of 10000"
  if (!constraints.totalQuantity) {
    const p4 = new RegExp(String.raw`\btarget\s+(?:number\s+of\s+)?(?:(${UNIT_PAT})\s*(?:engaged|collected|processed|done|annotated)?\s+is\s+)?${NUM_PAT}\b`, "i").exec(description);
    if (p4 && p4[2]) {
      constraints.totalQuantity = parseQuantityNum(p4[2]!, p4[3]);
      constraints.unitOfMeasure = (p4[1] ?? "posts").toLowerCase();
    }
  }

  // ── Throughput extraction ──────────────────────────────────────────────────────
  // "50 images per hour", "50 images/hour", "50 images per person per hour"
  const tpHour = new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s+${UNIT_PAT}\\s*(?:\\/|per)\\s*(?:person\\s*(?:\\/|per)\\s*)?hour`, "i").exec(description);
  if (tpHour) constraints.throughputRate = Number(tpHour[1]);

  // "400 images per day", "400 images/day", "400 images per person per day"
  const tpDay = new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s+${UNIT_PAT}\\s*(?:\\/|per)\\s*(?:person\\s*(?:\\/|per)\\s*)?day`, "i").exec(description);
  if (tpDay) constraints.throughputPerDay = Number(tpDay[1]);

  return constraints;
}

export function resolvePlanningSettings(
  description: string,
  currentDate: string,
  defaults: PlanningDefaults = {},
): ResolvedPlanningSettings {
  const requested = extractRequestedConstraints(description, currentDate);
  const weekdaysOnly = requested.weekdaysOnly ?? defaults.weekdaysOnly ?? inferDefaultWeekdaysOnly(description);
  const workingDays = requested.workingDays ?? defaults.workingDays;
  const defaultStartDate = weekdaysOnly ? nextBusinessDay(currentDate) : currentDate;
  const duration = requested.duration ?? {
    value: positive(defaults.durationValue, 30, "durationValue"),
    unit: defaults.durationUnit ?? "days",
  };
  const startsToday = /\b(?:starting|starts?|from)\s+today\b/i.test(description);
  const startDate = startsToday ? currentDate : requested.startDate ?? defaultStartDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !toIsoDate(startDate)) {
    throw new Error("Planning start date must use YYYY-MM-DD format");
  }
  if (!requested.allowPastDates && startDate < currentDate) {
    throw new Error(`Planning start date ${startDate} is earlier than ${currentDate}`);
  }
  const endDate = requested.endDate;
  if (endDate !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || !toIsoDate(endDate))) {
    throw new Error("Planning end date must use YYYY-MM-DD format");
  }
  if (endDate !== undefined && endDate < startDate) {
    throw new Error(`Planning end date ${endDate} is earlier than start date ${startDate}`);
  }
  if (!Number.isInteger(duration.value) || duration.value <= 0 || duration.value > 730) {
    throw new Error("Duration must be a whole number between 1 and 730");
  }

  return {
    startDate,
    endDate,
    duration,
    totalHours: positive(requested.totalHours, positive(defaults.totalHours, 160, "totalHours"), "totalHours"),
    teamSize: Math.round(positive(requested.teamSize, positive(defaults.teamSize, 1, "teamSize"), "teamSize")),
    weekdaysOnly,
    workingDays,
    unitOfMeasure: requested.unitOfMeasure ?? defaults.unitOfMeasure,
    totalQuantity: requested.totalQuantity ?? defaults.totalQuantity,
  };
}

function parseIso(date: string): Date {
  return parseIsoDate(date);
}

function addMonthsClamped(date: Date, count: number): Date {
  const day = date.getUTCDate();
  const firstOfTarget = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1));
  const lastDay = new Date(
    Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0),
  ).getUTCDate();
  firstOfTarget.setUTCDate(Math.min(day, lastDay));
  return firstOfTarget;
}

export function buildScheduleDates(settings: ResolvedPlanningSettings): string[] {
  const start = parseIso(settings.startDate);
  const dates: string[] = [];
  const isScheduledDay = (date: Date): boolean => {
    if (settings.workingDays?.length) return settings.workingDays.includes(date.getUTCDay());
    return !settings.weekdaysOnly || isWeekday(date);
  };

  if (settings.endDate) {
    const end = parseIso(settings.endDate);
    for (let candidate = start; candidate <= end; candidate = addDays(candidate, 1)) {
      if (isScheduledDay(candidate)) dates.push(formatIsoDate(candidate));
    }
    if (dates.length === 0) throw new Error("The requested period contains no scheduled workdays");
    return dates;
  }

  if (settings.duration.unit === "days") {
    let candidate = start;
    while (dates.length < settings.duration.value) {
      if (isScheduledDay(candidate)) dates.push(formatIsoDate(candidate));
      candidate = addDays(candidate, 1);
    }
    return dates;
  }

  const end = settings.duration.unit === "weeks"
    ? addDays(start, settings.duration.value * 7)
    : addMonthsClamped(start, settings.duration.value);
  for (let candidate = start; candidate < end; candidate = addDays(candidate, 1)) {
    if (isScheduledDay(candidate)) dates.push(formatIsoDate(candidate));
  }
  if (dates.length === 0) throw new Error("The requested period contains no scheduled workdays");
  return dates;
}
