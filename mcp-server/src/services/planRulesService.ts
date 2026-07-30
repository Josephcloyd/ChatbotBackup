import type { ProductionPlan, ProductionPlanInput, ProductionPlanRow } from "../types/productionPlan.js";
import {
  buildScheduleDates,
  extractRequestedConstraints,
  resolvePlanningSettings,
} from "./planningConstraintsService.js";
import { isWeekday, parseIsoDate } from "./dateNormalizationService.js";
import { buildLpbDistribution } from "./lpbModelService.js";
export { extractRequestedConstraints } from "./planningConstraintsService.js";

export interface PlanRuleOptions {
  currentDate: string;
  input: Pick<ProductionPlanInput, "projectDescription">;
  requiredPlanningModel?: string;
}

function numericValue(row: ProductionPlanRow, column: string, rowNumber: number): number {
  const raw = row[column];
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value)) {
    throw new Error(`Production Plan row ${rowNumber} must contain a numeric ${column}`);
  }
  return value;
}

function targetColumn(columns: string[]): string {
  return columns.find((column) =>
    (/target|plan/i.test(column) || /posts|images|records|documents|units|hours|tasks/i.test(column)) &&
    !/active|accumulate|accumulative|annotators|recorders|operators|workers|team|resource|per\s+(?:annotator|person|worker|recorder|operator|resource)|actual|balance|status|variance|completion/i.test(column)
  ) ?? columns.find((column) => /target\s+(?:total\s+)?hours/i.test(column)) ?? columns[2] ?? "Target Total Hours";
}

function teamColumn(columns: string[]): string {
  return columns.find((column) =>
    /target\s+active\s+(?:annotators|recorders|operators|resources)|active\s+(?:annotators|recorders|operators|resources)|workers|team|staff|resource/i.test(column)
  ) ?? "Target Active Annotators";
}

function actualColumns(columns: string[]): string[] {
  return columns.filter((column) =>
    /^Actual\b/i.test(column) || column === "Total Variance" || column === "Completion Rate (%)"
  );
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

function validatePlanningModel(plan: ProductionPlan, requiredPlanningModel: string): void {
  if (plan.project.planningModel !== requiredPlanningModel) {
    throw new Error(`Production plan must use ${requiredPlanningModel}`);
  }

  if (!plan.project.assumptions.some((assumption) =>
    assumption.toLowerCase().includes(requiredPlanningModel.toLowerCase())
  )) {
    throw new Error(`Production plan assumptions must record ${requiredPlanningModel}`);
  }
  if (plan.project.assumptions.some((assumption) =>
    /\bmodel\b/i.test(assumption) &&
    !assumption.toLowerCase().includes(requiredPlanningModel.toLowerCase())
  )) {
    throw new Error(`Production plan assumptions conflict with ${requiredPlanningModel}`);
  }
  if (
    /\bmodel\b/i.test(plan.summary) &&
    !plan.summary.toLowerCase().includes(requiredPlanningModel.toLowerCase())
  ) {
    throw new Error(`Production plan summary conflicts with ${requiredPlanningModel}`);
  }

  const projectInfo = plan.workbook.sheets.find((sheet) => sheet.sheetName === "Project Information");
  const planningModelRow = projectInfo?.rows.find((row) =>
    String(row.Field ?? "").trim().toLowerCase() === "planning model"
  );
  if (planningModelRow?.Value !== requiredPlanningModel) {
    throw new Error(`Project Information must record ${requiredPlanningModel}`);
  }
}

function validateLpbDistribution(plan: ProductionPlan, sheet: ProductionPlan["workbook"]["sheets"][number]): void {
  const primaryTargetColumn = targetColumn(sheet.columns);
  const decimalPlaces = /hours/i.test(primaryTargetColumn) ? 2 : 0;
  const targets = sheet.rows.map((row, index) =>
    numericValue(row, primaryTargetColumn, index + 1)
  );
  const totalWorkload = targets.reduce((sum, value) => sum + value, 0);
  const expected = buildLpbDistribution(totalWorkload, sheet.rows.length, decimalPlaces);
  const tolerance = decimalPlaces === 0 ? 0 : 0.001;

  targets.forEach((target, index) => {
    if (Math.abs(target - expected.daily[index]!.target) > tolerance) {
      throw new Error(
        `Production Plan row ${index + 1} does not follow the LPB 20%-50%-30% workload distribution`,
      );
    }
  });

  const allocationSheet = plan.workbook.sheets.find((item) => item.sheetName === "LPB Allocation");
  if (!allocationSheet || allocationSheet.rows.length !== expected.stages.length) {
    throw new Error("Production plan must include the LPB Allocation worksheet");
  }
  expected.stages.forEach((stage, index) => {
    const row = allocationSheet.rows[index]!;
    if (
      row.Stage !== stage.stageLabel ||
      Number(row["Workload Share (%)"]) !== stage.workloadPercentage ||
      Number(row["Scheduled Days"]) !== stage.scheduledDays ||
      Math.abs(Number(row["Planned Workload"]) - stage.target) > tolerance
    ) {
      throw new Error(`LPB Allocation row ${index + 1} does not match the required workload distribution`);
    }
  });
}

export class PlanRulesService {
  validate(plan: ProductionPlan, options: PlanRuleOptions): ProductionPlan {
    if (options.requiredPlanningModel) {
      validatePlanningModel(plan, options.requiredPlanningModel);
    }

    const sheet = plan.workbook.sheets.find((item) => item.sheetName === "Production Plan");
    if (!sheet) return plan;
    const definitions = getColumnDefinitions(sheet);
    const dateColumn = findColumnLabel(sheet, "date") ?? "Date";
    const monthColumn = findColumnLabel(sheet, "month") ?? "Month";
    const targetColumn =
      findColumnLabel(sheet, "planned_output") ??
      sheet.columns.find((column) => /target|plan/i.test(column)) ??
      sheet.columns[2] ??
      "Target Total Hours";
    const plannedStaffColumn =
      findColumnLabel(sheet, "planned_staff") ?? "Target Active Annotators";
    const actualColumns = definitions
      .filter((column) =>
        column.semantic === "actual_staff" ||
        column.semantic === "actual_output" ||
        column.semantic === "actual_output_per_person" ||
        column.semantic === "actual_hours" ||
        column.semantic === "variance" ||
        column.semantic === "completion_rate",
      )
      .map((column) => column.label);

    if (sheet.rows.length === 0) {
      console.warn("[planRulesService] Production Plan sheet had 0 rows. Synthesizing schedule rows from project constraints.");
      const settings = resolvePlanningSettings(options.input.projectDescription, options.currentDate);
      const constraints = extractRequestedConstraints(options.input.projectDescription, options.currentDate);
      const useLpbModel = isLpbModel(constraints.planningModel);
      const scheduleDates = buildScheduleDates(settings);
      const totalUnits = settings.totalQuantity ?? settings.totalHours ?? 100;
      const targets = useLpbModel
        ? distributeLpbInteger(totalUnits, scheduleDates.length)
        : distributeInteger(Math.round(totalUnits), scheduleDates.length);
      const hourTargets = useLpbModel
        ? distributeLpbHours(settings.totalHours, scheduleDates.length)
        : distributeInteger(Math.round(settings.totalHours * 100), scheduleDates.length).map((value) => value / 100);
      const lpbCounts = lpbPhaseDayCounts(scheduleDates.length);
      const definitionsByLabel = new Map(
        definitions.map((definition) => [definition.label, definition]),
      );
      let accum = 0;

      scheduleDates.forEach((dateStr, rowIndex) => {
        const target = targets[rowIndex] ?? 0;
        const phaseIndex = phaseIndexForRow(rowIndex, scheduleDates.length);
        const phase = LPB_PHASES[phaseIndex]!;
        const phaseStart = lpbCounts.slice(0, phaseIndex).reduce((sum, count) => sum + count, 0);
        accum += target;
        const rowObj: Record<string, any> = {};
        sheet.columns.forEach((col) => {
          const semantic = definitionsByLabel.get(col)?.semantic;
          if (col === dateColumn) rowObj[col] = dateStr;
          else if (col === monthColumn) rowObj[col] = dateStr.slice(0, 7);
          else if (col === targetColumn) rowObj[col] = target;
          else if (semantic === "sequence") rowObj[col] = rowIndex + 1;
          else if (semantic === "day") {
            rowObj[col] = parseIsoDate(dateStr).toLocaleString("en-US", {
              weekday: "short",
              timeZone: "UTC",
            });
          }
          else if (semantic === "planned_staff") rowObj[col] = settings.teamSize;
          else if (semantic === "planned_output_per_person") {
            rowObj[col] = Number((target / Math.max(settings.teamSize, 1)).toFixed(2));
          }
          else if (semantic === "planned_hours") rowObj[col] = hourTargets[rowIndex] ?? 0;
          else if (semantic === "status") rowObj[col] = "Not Started";
          else if (useLpbModel && semantic === "phase") rowObj[col] = phase;
          else if (useLpbModel && semantic === "notes") {
            rowObj[col] = lpbNote(phase, rowIndex - phaseStart, lpbCounts[phaseIndex] ?? 0);
          }
          else if (useLpbModel && /expected\s+completion/i.test(col)) {
            rowObj[col] = totalUnits > 0 ? Number(((accum / totalUnits) * 100).toFixed(2)) : "";
          }
          else if (/accumulate|accumulative/i.test(col) && /target|plan/i.test(col)) rowObj[col] = accum;
          else rowObj[col] = "";
        });
        sheet.rows.push(rowObj);
      });
    }

    const seenDates = new Set<string>();
    let totalTargetHours = 0;

    sheet.rows.forEach((row, index) => {
      const rowNumber = index + 1;
      const date = isoDate(row[dateColumn]);
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

      totalTargetHours += numericValue(row, targetColumn, rowNumber);

      for (const column of actualColumns) {
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
      const settings = resolvePlanningSettings(
        options.input.projectDescription,
        options.currentDate,
      );
      const expectedDates = buildScheduleDates(settings);
      const actualDates = sheet.rows.map((row) => String(row[dateColumn]));
      const scheduleMatches = expectedDates.length === actualDates.length &&
        expectedDates.every((date, index) => date === actualDates[index]);

      if (!scheduleMatches && expectedDates.length > 0) {
        console.warn(`[planRulesService] Auto-expanding ${actualDates.length} sample rows to complete ${expectedDates.length}-day schedule.`);
        const useLpbModel = isLpbModel(constraints.planningModel);
        const totalUnits = settings.totalQuantity ?? (settings.totalHours !== 160 ? settings.totalHours : undefined) ?? 100;
        const targets = useLpbModel
          ? distributeLpbInteger(totalUnits, expectedDates.length)
          : distributeInteger(Math.round(totalUnits), expectedDates.length);
        const hourTargets = useLpbModel
          ? distributeLpbHours(settings.totalHours, expectedDates.length)
          : distributeInteger(Math.round(settings.totalHours * 100), expectedDates.length).map((value) => value / 100);
        const lpbCounts = lpbPhaseDayCounts(expectedDates.length);
        const firstExistingRow = sheet.rows[0] ?? {};
        const definitionsByLabel = new Map(
          definitions.map((definition) => [definition.label, definition]),
        );
        let accum = 0;

        sheet.rows = expectedDates.map((dateStr, rowIndex) => {
          const target = targets[rowIndex] ?? 0;
          const phaseIndex = phaseIndexForRow(rowIndex, expectedDates.length);
          const phase = LPB_PHASES[phaseIndex]!;
          const phaseStart = lpbCounts.slice(0, phaseIndex).reduce((sum, count) => sum + count, 0);
          accum += target;
          const rowObj: Record<string, any> = {};
          sheet.columns.forEach((col) => {
            const semantic = definitionsByLabel.get(col)?.semantic;
            if (col === dateColumn) rowObj[col] = dateStr;
            else if (col === monthColumn) {
              const d = parseIsoDate(dateStr);
              const monthName = d.toLocaleString("en-US", { month: "long" });
              rowObj[col] = monthName;
            }
            else if (col === targetColumn) rowObj[col] = target;
            else if (semantic === "sequence") rowObj[col] = rowIndex + 1;
            else if (semantic === "day") {
              rowObj[col] = parseIsoDate(dateStr).toLocaleString("en-US", {
                weekday: "short",
                timeZone: "UTC",
              });
            }
            else if (semantic === "planned_staff") rowObj[col] = settings.teamSize;
            else if (semantic === "role_headcount") rowObj[col] = firstExistingRow[col] ?? 0;
            else if (semantic === "planned_output_per_person") {
              rowObj[col] = Number(
                (target / Math.max(settings.teamSize, 1)).toFixed(2),
              );
            }
            else if (semantic === "planned_hours") rowObj[col] = hourTargets[rowIndex] ?? 0;
            else if (semantic === "status") rowObj[col] = "Not Started";
            else if (useLpbModel && semantic === "phase") rowObj[col] = phase;
            else if (useLpbModel && semantic === "notes") {
              rowObj[col] = lpbNote(phase, rowIndex - phaseStart, lpbCounts[phaseIndex] ?? 0);
            }
            else if (useLpbModel && /expected\s+completion/i.test(col)) {
              rowObj[col] = totalUnits > 0 ? Number(((accum / totalUnits) * 100).toFixed(2)) : "";
            }
            else if (semantic === "phase" || semantic === "notes") {
              rowObj[col] = firstExistingRow[col] ?? "";
            }
            else if (/accumulate|accumulative/i.test(col) && /target|plan/i.test(col)) rowObj[col] = accum;
            else rowObj[col] = "";
          });
          return rowObj;
        });
      }
    } else if (constraints.durationDays !== undefined && sheet.rows.length !== constraints.durationDays) {
      throw new Error(
        `Requested ${constraints.durationDays}-day duration requires ${constraints.durationDays} daily rows; received ${sheet.rows.length}`,
      );
    }
    if (constraints.teamSize !== undefined) {
      const teamCol = teamColumn(sheet.columns);
      const teamValues = sheet.rows.map((row, index) =>
        numericValue(row, plannedStaffColumn, index + 1),
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
    if (options.requiredPlanningModel === "LPB Model") {
      validateLpbDistribution(plan, sheet);
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
