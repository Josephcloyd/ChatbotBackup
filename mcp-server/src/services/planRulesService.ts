import type { ProductionPlan, ProductionPlanInput, ProductionPlanRow } from "../types/productionPlan.js";
import {
  buildScheduleDates,
  extractRequestedConstraints,
  resolvePlanningSettings,
} from "./planningConstraintsService.js";
import { isWeekday, parseIsoDate } from "./dateNormalizationService.js";
export { extractRequestedConstraints } from "./planningConstraintsService.js";

export interface PlanRuleOptions {
  currentDate: string;
  input: Pick<ProductionPlanInput, "projectDescription">;
}

const ACTUAL_COLUMNS = [
  "Actual Active Annotators",
  "Actual Total Hours",
  "Actual Total Hours per Annotator",
  "Actual Hours",
  "Total Variance",
  "Completion Rate (%)",
];

function numericValue(row: ProductionPlanRow, column: string, rowNumber: number): number {
  const raw = row[column];
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value)) {
    throw new Error(`Production Plan row ${rowNumber} must contain a numeric ${column}`);
  }
  return value;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  const date = new Date(`${candidate}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== candidate
    ? null
    : candidate;
}

function splitIds(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  return value
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export class PlanRulesService {
  validate(plan: ProductionPlan, options: PlanRuleOptions): ProductionPlan {
    const sheet = plan.workbook.sheets.find((item) => item.sheetName === "Production Plan");
    if (!sheet) return plan;
    if (sheet.rows.length === 0) throw new Error("Production Plan must contain at least one row");

    const seenDates = new Set<string>();
    let totalTargetHours = 0;

    sheet.rows.forEach((row, index) => {
      const rowNumber = index + 1;
      const date = isoDate(row.Date);
      if (!date) {
        throw new Error(`Production Plan row ${rowNumber} Date must use YYYY-MM-DD format`);
      }
      const constraints = extractRequestedConstraints(options.input.projectDescription, options.currentDate);
      if (!constraints.allowPastDates && date < options.currentDate) {
        throw new Error(
          `Production Plan row ${rowNumber} uses past date ${date}; planning date is ${options.currentDate}`,
        );
      }
      if (constraints.weekdaysOnly === true && !isWeekday(parseIsoDate(date))) {
        throw new Error(`Production Plan row ${rowNumber} schedules weekend date ${date}`);
      }
      if (constraints.workingDays?.length && !constraints.workingDays.includes(parseIsoDate(date).getUTCDay())) {
        throw new Error(`Production Plan row ${rowNumber} is outside the requested custom working days`);
      }
      if (seenDates.has(date)) throw new Error(`Production Plan contains duplicate date ${date}`);
      seenDates.add(date);

      totalTargetHours += sheet.columns.includes("Target Total Hours")
        ? numericValue(row, "Target Total Hours", rowNumber)
        : 0;

      for (const column of ACTUAL_COLUMNS) {
        if (!sheet.columns.includes(column)) continue;
        const value = row[column];
        if (value !== "" && value !== null && value !== undefined) {
          throw new Error(
            `Production Plan row ${rowNumber} must leave future actual column "${column}" blank`,
          );
        }
      }
    });

    const constraints = extractRequestedConstraints(options.input.projectDescription, options.currentDate);
    if (constraints.duration !== undefined) {
      const expectedDates = buildScheduleDates(resolvePlanningSettings(
        options.input.projectDescription,
        options.currentDate,
      ));
      const actualDates = sheet.rows.map((row) => String(row.Date));
      const scheduleMatches = expectedDates.length === actualDates.length &&
        expectedDates.every((date, index) => date === actualDates[index]);
      if (!scheduleMatches) {
        throw new Error(
          `Requested ${constraints.duration.value}-${constraints.duration.unit} schedule requires ${expectedDates.length} correctly dated rows; received ${actualDates.length}`,
        );
      }
    } else if (constraints.durationDays !== undefined && sheet.rows.length !== constraints.durationDays) {
      throw new Error(
        `Requested ${constraints.durationDays}-day duration requires ${constraints.durationDays} daily rows; received ${sheet.rows.length}`,
      );
    }
    if (constraints.teamSize !== undefined) {
      const teamValues = sheet.rows.map((row, index) =>
        numericValue(row, "Target Active Annotators", index + 1),
      );
      if (teamValues.some((value) => value > constraints.teamSize!)) {
        throw new Error(`Production Plan exceeds requested team size of ${constraints.teamSize}`);
      }
      if (!teamValues.some((value) => value === constraints.teamSize)) {
        throw new Error(`Production Plan never schedules the requested team size of ${constraints.teamSize}`);
      }
    }
    if (
      constraints.totalHours !== undefined &&
      sheet.columns.includes("Target Total Hours") &&
      Math.abs(totalTargetHours - constraints.totalHours) > 0.01
    ) {
      throw new Error(
        `Requested ${constraints.totalHours} total hours but Production Plan targets sum to ${totalTargetHours}`,
      );
    }

    const sheetNames = new Set(plan.workbook.sheets.map((item) => item.sheetName));
    const taskSheet = plan.workbook.sheets.find((item) => item.sheetName === "Task Breakdown");
    if (taskSheet) {
      const taskIds = new Set<string>();
      for (const [index, row] of taskSheet.rows.entries()) {
        const taskId = typeof row["Task ID"] === "string" ? row["Task ID"].trim() : "";
        if (!taskId) throw new Error(`Task Breakdown row ${index + 1} is missing Task ID`);
        if (taskIds.has(taskId)) throw new Error(`Task Breakdown contains duplicate Task ID ${taskId}`);
        taskIds.add(taskId);
      }

      for (const [index, row] of taskSheet.rows.entries()) {
        const rowNumber = index + 1;
        const start = isoDate(row["Planned Start"]);
        const end = isoDate(row["Planned End"]);
        if (!start || !end) {
          throw new Error(`Task Breakdown row ${rowNumber} must use YYYY-MM-DD planned start/end dates`);
        }
        if (end < start) throw new Error(`Task Breakdown row ${rowNumber} ends before it starts`);
        if (start < String(plan.project.startDate) || end > String(plan.project.deadline)) {
          throw new Error(`Task Breakdown row ${rowNumber} is outside the project period`);
        }
        if (constraints.weekdaysOnly === true && (!isWeekday(parseIsoDate(start)) || !isWeekday(parseIsoDate(end)))) {
          throw new Error(`Task Breakdown row ${rowNumber} schedules weekend work in a weekdays-only plan`);
        }
        if (
          constraints.workingDays?.length &&
          (!constraints.workingDays.includes(parseIsoDate(start).getUTCDay()) ||
            !constraints.workingDays.includes(parseIsoDate(end).getUTCDay()))
        ) {
          throw new Error(`Task Breakdown row ${rowNumber} is outside the requested custom working days`);
        }
        for (const dependencyId of splitIds(row.Dependencies)) {
          if (!taskIds.has(dependencyId)) {
            throw new Error(`Task Breakdown row ${rowNumber} references unknown dependency ${dependencyId}`);
          }
        }
      }
    }

    const chartSheet = plan.workbook.sheets.find((item) => item.sheetName === "Chart Specs");
    if (chartSheet) {
      chartSheet.rows.forEach((row, index) => {
        const source = typeof row["Source Worksheet"] === "string" ? row["Source Worksheet"].trim() : "";
        if (!source || !sheetNames.has(source)) {
          throw new Error(`Chart Specs row ${index + 1} references unknown source worksheet "${source}"`);
        }
      });
    }

    return plan;
  }
}

export const planRulesService = new PlanRulesService();
