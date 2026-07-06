import type { ProductionPlan, ProductionPlanInput, ProductionPlanRow } from "../types/productionPlan.js";
import {
  buildScheduleDates,
  extractRequestedConstraints,
  resolvePlanningSettings,
} from "./planningConstraintsService.js";
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
      if (date < options.currentDate) {
        throw new Error(
          `Production Plan row ${rowNumber} uses past date ${date}; planning date is ${options.currentDate}`,
        );
      }
      if (seenDates.has(date)) throw new Error(`Production Plan contains duplicate date ${date}`);
      seenDates.add(date);

      totalTargetHours += numericValue(row, "Target Total Hours", rowNumber);

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

    const constraints = extractRequestedConstraints(options.input.projectDescription);
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
      Math.abs(totalTargetHours - constraints.totalHours) > 0.01
    ) {
      throw new Error(
        `Requested ${constraints.totalHours} total hours but Production Plan targets sum to ${totalTargetHours}`,
      );
    }

    return plan;
  }
}

export const planRulesService = new PlanRulesService();
