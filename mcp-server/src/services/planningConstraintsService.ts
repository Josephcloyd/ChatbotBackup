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
}

export interface PlanningDefaults {
  startDate?: string;
  durationValue?: number;
  durationUnit?: DurationUnit;
  totalHours?: number;
  teamSize?: number;
  weekdaysOnly?: boolean;
}

export interface ResolvedPlanningSettings {
  startDate: string;
  duration: DurationConstraint;
  totalHours: number;
  teamSize: number;
  weekdaysOnly: boolean;
}

function toIsoDate(value: string): string | undefined {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return undefined;
  return date.toISOString().slice(0, 10);
}

function positive(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new Error(`${name} must be greater than zero`);
  }
  return resolved;
}

export function extractRequestedConstraints(description: string): RequestedConstraints {
  const durationMatch = description.match(/\b(\d+)\s*[- ]?(?:calendar\s+)?(days?|weeks?|months?)\b/i);
  const hoursMatch = description.match(/\b(\d+(?:\.\d+)?)\s+(?:total\s+)?hours?\b/i);
  const teamMatch =
    description.match(/\b(?:class|team|group|crew)\s+of\s+(\d+)\b/i) ??
    description.match(/\b(\d+)\s+(?:active\s+)?(?:annotators?|workers?|agents?|people|members?)\b/i);
  const isoStart = description.match(
    /\b(?:starting|starts?|from)\s+(\d{4}-\d{2}-\d{2})\b/i,
  )?.[1];
  const namedStart = description.match(
    /\b(?:starting|starts?|from)\s+((?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:,)?\s+\d{4})\b/i,
  )?.[1];

  const constraints: RequestedConstraints = {};
  if (durationMatch) {
    const unitText = durationMatch[2]!.toLowerCase();
    const unit: DurationUnit = unitText.startsWith("day")
      ? "days"
      : unitText.startsWith("week")
        ? "weeks"
        : "months";
    constraints.duration = { value: Number(durationMatch[1]), unit };
    if (unit === "days") constraints.durationDays = Number(durationMatch[1]);
  }
  if (hoursMatch) constraints.totalHours = Number(hoursMatch[1]);
  if (teamMatch) constraints.teamSize = Number(teamMatch[1]);
  if (/\b(?:weekdays?\s+only|business\s+days?|monday\s+(?:through|to|-)\s+friday)\b/i.test(description)) {
    constraints.weekdaysOnly = true;
  } else if (/\b(?:calendar\s+(?:days?|weeks?|months?)|including\s+weekends?|seven\s+days\s+a\s+week)\b/i.test(description)) {
    constraints.weekdaysOnly = false;
  }
  const parsedStart = toIsoDate(isoStart ?? namedStart ?? "");
  if (parsedStart) constraints.startDate = parsedStart;
  return constraints;
}

export function resolvePlanningSettings(
  description: string,
  currentDate: string,
  defaults: PlanningDefaults = {},
): ResolvedPlanningSettings {
  const requested = extractRequestedConstraints(description);
  const duration = requested.duration ?? {
    value: positive(defaults.durationValue, 30, "durationValue"),
    unit: defaults.durationUnit ?? "days",
  };
  const startsToday = /\b(?:starting|starts?|from)\s+today\b/i.test(description);
  const startDate = startsToday ? currentDate : requested.startDate ?? defaults.startDate ?? currentDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !toIsoDate(startDate)) {
    throw new Error("Planning start date must use YYYY-MM-DD format");
  }
  if (startDate < currentDate) {
    throw new Error(`Planning start date ${startDate} is earlier than ${currentDate}`);
  }
  if (!Number.isInteger(duration.value) || duration.value <= 0 || duration.value > 730) {
    throw new Error("Duration must be a whole number between 1 and 730");
  }

  return {
    startDate,
    duration,
    totalHours: positive(requested.totalHours, positive(defaults.totalHours, 160, "totalHours"), "totalHours"),
    teamSize: Math.round(positive(requested.teamSize, positive(defaults.teamSize, 1, "teamSize"), "teamSize")),
    weekdaysOnly: requested.weekdaysOnly ?? defaults.weekdaysOnly ?? true,
  };
}

function parseIso(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function formatIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, count: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + count);
  return result;
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

function isWeekday(date: Date): boolean {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

export function buildScheduleDates(settings: ResolvedPlanningSettings): string[] {
  const start = parseIso(settings.startDate);
  const dates: string[] = [];

  if (settings.duration.unit === "days") {
    let candidate = start;
    while (dates.length < settings.duration.value) {
      if (!settings.weekdaysOnly || isWeekday(candidate)) dates.push(formatIso(candidate));
      candidate = addDays(candidate, 1);
    }
    return dates;
  }

  const end = settings.duration.unit === "weeks"
    ? addDays(start, settings.duration.value * 7)
    : addMonthsClamped(start, settings.duration.value);
  for (let candidate = start; candidate < end; candidate = addDays(candidate, 1)) {
    if (!settings.weekdaysOnly || isWeekday(candidate)) dates.push(formatIso(candidate));
  }
  if (dates.length === 0) throw new Error("The requested period contains no scheduled workdays");
  return dates;
}
