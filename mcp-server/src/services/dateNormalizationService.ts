export interface DateInterpretation {
  source: string;
  normalized: string;
  kind: "startDate" | "endDate";
}

export interface NormalizedDateConstraints {
  startDate?: string;
  endDate?: string;
  interpretations: DateInterpretation[];
}

const WEEKDAYS = new Map([
  ["sunday", 0],
  ["monday", 1],
  ["tuesday", 2],
  ["wednesday", 3],
  ["thursday", 4],
  ["friday", 5],
  ["saturday", 6],
]);

const MONTHS = new Map([
  ["january", 0],
  ["february", 1],
  ["march", 2],
  ["april", 3],
  ["may", 4],
  ["june", 5],
  ["july", 6],
  ["august", 7],
  ["september", 8],
  ["october", 9],
  ["november", 10],
  ["december", 11],
]);

const DATE_EXPRESSION =
  String.raw`(?:\d{4}-\d{2}-\d{2}|today|tomorrow|next\s+week|end\s+of\s+(?:the\s+)?month|(?:this|next)\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:,?\s+\d{4})?)`;

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && formatIsoDate(date) === value;
}

export function parseIsoDate(value: string): Date {
  if (!isIsoDate(value)) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  return new Date(`${value}T00:00:00Z`);
}

export function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, count: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + count);
  return result;
}

export function isWeekday(date: Date): boolean {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

export function nextBusinessDay(startDate: string): string {
  let candidate = parseIsoDate(startDate);
  while (!isWeekday(candidate)) candidate = addDays(candidate, 1);
  return formatIsoDate(candidate);
}

function nextWeekday(current: Date, targetDay: number): Date {
  const delta = (targetDay - current.getUTCDay() + 7) % 7 || 7;
  return addDays(current, delta);
}

function thisWeekday(current: Date, targetDay: number): Date {
  const delta = (targetDay - current.getUTCDay() + 7) % 7;
  return addDays(current, delta);
}

function parseMonthDate(expression: string, currentDate: string): string | undefined {
  const match = expression.match(
    /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/i,
  );
  if (!match) return undefined;

  const month = MONTHS.get(match[1]!.toLowerCase());
  const day = Number(match[2]);
  if (month === undefined) return undefined;
  const current = parseIsoDate(currentDate);
  const explicitYear = match[3] ? Number(match[3]) : undefined;
  let year = explicitYear ?? current.getUTCFullYear();
  let candidate = new Date(Date.UTC(year, month, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month ||
    candidate.getUTCDate() !== day
  ) {
    return undefined;
  }

  if (explicitYear === undefined && formatIsoDate(candidate) < currentDate) {
    year += 1;
    candidate = new Date(Date.UTC(year, month, day));
  }

  return formatIsoDate(candidate);
}

function endOfMonth(currentDate: string): string {
  const current = parseIsoDate(currentDate);
  const result = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0));
  return formatIsoDate(result);
}

function parseSlashDate(expression: string): string | undefined {
  const isoMatch = expression.match(/^(\d{4})[\/\.-](\d{1,2})[\/\.-](\d{1,2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]) - 1;
    const day = Number(isoMatch[3]);
    const d = new Date(Date.UTC(year, month, day));
    if (d.getUTCFullYear() === year && d.getUTCMonth() === month && d.getUTCDate() === day) {
      return formatIsoDate(d);
    }
  }

  const slashMatch = expression.match(/^(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{4})$/);
  if (slashMatch) {
    const part1 = Number(slashMatch[1]);
    const part2 = Number(slashMatch[2]);
    const year = Number(slashMatch[3]);

    let month = part1 > 12 ? part2 - 1 : part1 - 1;
    let day = part1 > 12 ? part1 : part2;

    const d = new Date(Date.UTC(year, month, day));
    if (d.getUTCFullYear() === year && d.getUTCMonth() === month && d.getUTCDate() === day) {
      return formatIsoDate(d);
    }
  }

  return undefined;
}

export function normalizeDateExpression(
  expression: string,
  currentDate: string,
): string | undefined {
  const normalized = expression.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) return undefined;
  if (isIsoDate(normalized)) return normalized;
  const fromSlash = parseSlashDate(normalized);
  if (fromSlash) return fromSlash;
  if (normalized === "today") return currentDate;
  if (normalized === "tomorrow") return formatIsoDate(addDays(parseIsoDate(currentDate), 1));
  if (normalized === "next week") {
    return formatIsoDate(nextWeekday(parseIsoDate(currentDate), WEEKDAYS.get("monday")!));
  }
  if (/^end of (?:the )?month$/.test(normalized)) return endOfMonth(currentDate);

  const weekdayMatch = normalized.match(/^(this|next)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  if (weekdayMatch) {
    const targetDay = WEEKDAYS.get(weekdayMatch[2]!)!;
    const current = parseIsoDate(currentDate);
    return formatIsoDate(
      weekdayMatch[1] === "this"
        ? thisWeekday(current, targetDay)
        : nextWeekday(current, targetDay),
    );
  }

  return parseMonthDate(normalized, currentDate);
}

function collectDate(
  constraints: NormalizedDateConstraints,
  kind: DateInterpretation["kind"],
  source: string | undefined,
  currentDate: string,
): void {
  if (!source) return;
  const normalized = normalizeDateExpression(source, currentDate);
  if (!normalized) return;

  if (kind === "startDate") constraints.startDate = normalized;
  else constraints.endDate = normalized;

  if (source.trim() !== normalized) {
    constraints.interpretations.push({ source: source.trim(), normalized, kind });
  }
}

export function extractNormalizedDateConstraints(
  description: string,
  currentDate: string,
): NormalizedDateConstraints {
  const constraints: NormalizedDateConstraints = { interpretations: [] };
  const startPattern = new RegExp(
    String.raw`\b(?:(?:starting|starts?|from|beginning|begins)(?:\s+date\s+of)?|(?:start\s*date|startdate)\s*(?:is|:|of|to|as|=|set\s+to)?)\s*(?:on\s+)?(${DATE_EXPRESSION})\b`,
    "i",
  );
  const endPattern = new RegExp(
    String.raw`\b(?:by|until|through|ending|ends|(?:end\s*date|deadline)\s*(?:is|:|of|to|as|=|set\s+to)?)\s*(?:on\s+|the\s+)?(${DATE_EXPRESSION})\b`,
    "i",
  );


  collectDate(constraints, "startDate", description.match(startPattern)?.[1], currentDate);
  collectDate(constraints, "endDate", description.match(endPattern)?.[1], currentDate);

  if (!constraints.startDate && /\bstarting\s+today\b/i.test(description)) {
    collectDate(constraints, "startDate", "today", currentDate);
  }

  return constraints;
}
