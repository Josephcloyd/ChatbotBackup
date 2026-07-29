import ExcelJS from "exceljs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { DynamicPlanResult } from "./dynamicPlanService.js";
import {
  findColumnDefinition,
  getColumnDefinitions,
} from "./productionPlanColumns.js";
import type {
  ProductionPlanColumnDefinition,
  ProductionPlanColumnSemantic,
} from "../types/productionPlan.js";

const COLORS = {
  primary:     "FF133020", // Dark Serpent
  accent:      "FF046241", // Castleton Green
  accentDark:  "FF034E34", // Castleton Green dark
  saffron:     "FFFFB347", // Saffron
  earthYellow: "FFFFC370", // Earth Yellow
  paper:       "FFF5EEDB", // Paper background
  paleGreen:   "FFE8F5EE", // Light green tint
  paleAmber:   "FFFFF8E1", // Light amber tint
  paleRed:     "FFFDECEC",
  white:       "FFFFFFFF",
  sage:        "FF708E7C", // Sage
  lightGray:   "FFF9F7F7", // Sea Salt
  border:      "FFD3CBB6", // Warm border
};

function title(sheet: ExcelJS.Worksheet, range: string, value: string): void {
  sheet.mergeCells(range);
  const cell = sheet.getCell(range.split(":")[0]!);
  cell.value = value;
  cell.font = { name: "Aptos Display", size: 20, bold: true, color: { argb: COLORS.white } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.primary } };
  cell.alignment = { vertical: "middle", horizontal: "left" };
}

function sectionHeader(row: ExcelJS.Row): void {
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { name: "Aptos", bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.primary } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: COLORS.border } } };
  });
}

function bodyFont(sheet: ExcelJS.Worksheet): void {
  sheet.eachRow((row) => row.eachCell((cell) => {
    if (!cell.font?.name) cell.font = { name: "Aptos", size: 10 };
  }));
}

function setWidths(sheet: ExcelJS.Worksheet, widths: number[]): void {
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
}

function safeCellValue(value: unknown): unknown {
  if (typeof value === "string" && /^[=+\-@]/.test(value.trim())) {
    return `'${value}`;
  }
  return value;
}

function writeGenericSheet(workbook: ExcelJS.Workbook, sheetDefinition: {
  sheetName: string;
  columns: string[];
  rows: Record<string, unknown>[];
}): void {
  const sheet = workbook.addWorksheet(sheetDefinition.sheetName, {
    views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  sheet.addRow(sheetDefinition.columns);
  sheetDefinition.rows.forEach((row) => {
    sheet.addRow(sheetDefinition.columns.map((column) => safeCellValue(row[column] ?? "")));
  });
  sectionHeader(sheet.getRow(1));
  sheet.autoFilter = {
    from: "A1",
    to: `${sheet.getColumn(sheetDefinition.columns.length).letter}1`,
  };
  sheetDefinition.columns.forEach((column, index) => {
    const maxContentWidth = Math.max(
      column.length,
      ...sheetDefinition.rows.map((row) => String(row[column] ?? "").length),
    );
    sheet.getColumn(index + 1).width = Math.min(Math.max(maxContentWidth + 2, 14), 45);
    sheet.getColumn(index + 1).alignment = { wrapText: true, vertical: "top" };
  });
}

export class DynamicExcelService {
  constructor(private readonly outputDirectory = path.resolve("outputs")) {}

  async writeDynamicProductionPlan(
    result: DynamicPlanResult,
    outputPath?: string,
  ): Promise<string> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Chatbot2ProPl";
    workbook.created = new Date();
    workbook.calcProperties.fullCalcOnLoad = true;

    const { plan, settings, phases, risks } = result;
    const isQuantityMode = result.unitLabel !== undefined;
    const productionSheet = plan.workbook.sheets.find((sheet) => sheet.sheetName === "Production Plan");
    if (!productionSheet) throw new Error("Dynamic plan is missing the Production Plan sheet");
    const columnDefinitions = getColumnDefinitions(productionSheet);
    const requiredColumn = (
      semantic: ProductionPlanColumnSemantic,
    ): ProductionPlanColumnDefinition => {
      const column = findColumnDefinition(productionSheet, semantic);
      if (!column) throw new Error(`Dynamic plan is missing required ${semantic} column`);
      return column;
    };
    const columnNumber = (semantic: ProductionPlanColumnSemantic): number => {
      const required = requiredColumn(semantic);
      return columnDefinitions.findIndex((column) => column.label === required.label) + 1;
    };
    const columnLetter = (semantic: ProductionPlanColumnSemantic): string =>
      workbook.getWorksheet("Production Plan")?.getColumn(columnNumber(semantic)).letter ??
      String.fromCharCode(64 + columnNumber(semantic));
    const primaryTargetColumn = requiredColumn("planned_output");
    const primaryActualColumn = requiredColumn("actual_output");
    const plannedStaffColumn = requiredColumn("planned_staff");
    const dateColumn = requiredColumn("date");
    const monthColumn = requiredColumn("month");
    const planRows = productionSheet.rows;
    const lastPlanRow = planRows.length + 1;

    const summary = workbook.addWorksheet("Overview", {
      views: [{ showGridLines: false }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 1 },
    });
    title(summary, "A1:H2", "Production Plan | Overview");
    summary.getCell("A4").value = "Project";
    summary.mergeCells("B4:D4");
    summary.getCell("B4").value = plan.project.projectName;
    summary.getCell("E4").value = "Client";
    summary.mergeCells("F4:H4");
    summary.getCell("F4").value = plan.project.client || "Not specified";
    summary.getRow(5).values = ["Description", plan.project.projectDescription];
    summary.mergeCells("B5:H6");
    summary.getCell("B5").alignment = { wrapText: true, vertical: "top" };
    summary.getRow(8).values = ["Start Date", new Date(`${plan.project.startDate}T00:00:00Z`), "Deadline", new Date(`${plan.project.deadline}T00:00:00Z`)];
    summary.getRow(9).values = ["Schedule", settings.weekdaysOnly ? "Weekdays only" : "Calendar days", "Scheduled Days", planRows.length];
    for (const cellAddress of ["A4", "A5", "A8", "A9", "C8", "C9", "E4"]) {
      const cell = summary.getCell(cellAddress);
      cell.font = { bold: true, color: { argb: COLORS.sage } };
    }
    summary.getCell("B8").numFmt = "yyyy-mm-dd";
    summary.getCell("D8").numFmt = "yyyy-mm-dd";

    summary.mergeCells("A11:B11");
    summary.mergeCells("C11:D11");
    summary.mergeCells("E11:F11");
    summary.mergeCells("G11:H11");
    const metricLabel = result.unitLabel ? result.unitLabel.toUpperCase() : "HOURS";
    summary.getCell("A11").value = `PLANNED ${metricLabel}`;
    summary.getCell("C11").value = "TEAM SIZE";
    summary.getCell("E11").value = `ACTUAL ${metricLabel}`;
    summary.getCell("G11").value = "COMPLETION";
    for (const address of ["A11", "C11", "E11", "G11"]) {
      const cell = summary.getCell(address);
      cell.font = { bold: true, color: { argb: COLORS.white } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.accent } };
      cell.alignment = { horizontal: "center" };
    }
    summary.mergeCells("A12:B13");
    summary.mergeCells("C12:D13");
    summary.mergeCells("E12:F13");
    summary.mergeCells("G12:H13");
    const plannedResult = result.unitLabel != null && result.totalQuantity != null
      ? result.totalQuantity
      : settings.totalHours;
    const valueFmt = result.unitLabel ? "#,##0" : "#,##0.00";
    const targetLetter = columnLetter("planned_output");
    const staffLetter = columnLetter("planned_staff");
    const actualLetter = columnLetter("actual_output");
    summary.getCell("A12").value = { formula: `SUM('Production Plan'!${targetLetter}2:${targetLetter}${lastPlanRow})`, result: plannedResult };
    summary.getCell("C12").value = { formula: `MAX('Production Plan'!${staffLetter}2:${staffLetter}${lastPlanRow})`, result: settings.teamSize };
    summary.getCell("E12").value = { formula: `SUM('Production Plan'!${actualLetter}2:${actualLetter}${lastPlanRow})`, result: 0 };
    summary.getCell("G12").value = { formula: `IF(COUNT('Production Plan'!${actualLetter}2:${actualLetter}${lastPlanRow})=0,"",IFERROR(E12/A12,""))`, result: "" };
    for (const address of ["A12", "C12", "E12", "G12"]) {
      const cell = summary.getCell(address);
      cell.font = { size: 20, bold: true, color: { argb: COLORS.primary } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.paleAmber } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    }
    summary.getCell("A12").numFmt = valueFmt;
    summary.getCell("E12").numFmt = valueFmt;
    summary.getCell("G12").numFmt = "0.0%";
    summary.getCell("A16").value = "Plan Summary";
    summary.getCell("A16").font = { bold: true, size: 12, color: { argb: COLORS.primary } };
    summary.mergeCells("A17:H19");
    summary.getCell("A17").value = plan.summary;
    summary.getCell("A17").alignment = { wrapText: true, vertical: "top" };
    summary.getCell("A17").fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.lightGray } };
    setWidths(summary, [18, 24, 18, 24, 18, 18, 18, 18]);
    summary.getRow(1).height = 28;
    summary.getRow(2).height = 20;

    const production = workbook.addWorksheet("Production Plan", {
      views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    production.addRow(productionSheet.columns);
    const excelColumn = (semantic: ProductionPlanColumnSemantic): number =>
      columnNumber(semantic);
    const excelLetter = (semantic: ProductionPlanColumnSemantic): string =>
      production.getColumn(excelColumn(semantic)).letter;
    const dateLetter = excelLetter("date");
    const targetOutputLetter = excelLetter("planned_output");
    const plannedStaffLetter = excelLetter("planned_staff");
    const actualStaffLetter = excelLetter("actual_staff");
    const actualOutputLetter = excelLetter("actual_output");

    planRows.forEach((source, index) => {
      const excelRow = index + 2;
      const date = new Date(`${String(source[dateColumn.label])}T00:00:00Z`);
      const targetValue = Number(source[primaryTargetColumn.label] ?? 0);
      const teamSize = Number(source[plannedStaffColumn.label] ?? 0);
      const rowValues = columnDefinitions.map((column) => {
        if (column.semantic === "sequence") return index + 1;
        if (column.semantic === "date") return date;
        if (column.semantic === "month") {
          return {
            formula: `TEXT(${dateLetter}${excelRow},"mmm yyyy")`,
            result: String(source[column.label] ?? ""),
          };
        }
        if (column.semantic === "day") {
          return {
            formula: `TEXT(${dateLetter}${excelRow},"ddd")`,
            result: String(source[column.label] ?? ""),
          };
        }
        if (column.semantic === "planned_output_per_person") {
          return {
            formula: `IFERROR(${targetOutputLetter}${excelRow}/${plannedStaffLetter}${excelRow},0)`,
            result: Number(
              (targetValue / Math.max(teamSize, 1)).toFixed(isQuantityMode ? 0 : 2),
            ),
          };
        }
        if (column.semantic === "actual_staff" || column.semantic === "actual_output") {
          return null;
        }
        if (column.semantic === "actual_output_per_person") {
          return {
            formula: `IF(OR(${actualStaffLetter}${excelRow}="",${actualOutputLetter}${excelRow}=""),"",${actualOutputLetter}${excelRow}/${actualStaffLetter}${excelRow})`,
            result: "",
          };
        }
        if (column.semantic === "actual_hours") return null;
        if (column.semantic === "variance") {
          return {
            formula: `IF(${actualOutputLetter}${excelRow}="","",${actualOutputLetter}${excelRow}-${targetOutputLetter}${excelRow})`,
            result: "",
          };
        }
        if (column.semantic === "completion_rate") {
          return {
            formula: `IF(${actualOutputLetter}${excelRow}="","",IFERROR(${actualOutputLetter}${excelRow}/${targetOutputLetter}${excelRow},""))`,
            result: "",
          };
        }
        if (column.semantic === "status") {
          return {
            formula: `IF(${actualOutputLetter}${excelRow}="","Not Started",IF(${actualOutputLetter}${excelRow}>=${targetOutputLetter}${excelRow},"Complete","In Progress"))`,
            result: "Not Started",
          };
        }
        return safeCellValue(source[column.label] ?? "");
      });
      const row = production.addRow(rowValues);

      row.height = 20;
      columnDefinitions.forEach((column, columnIndex) => {
        if (
          column.semantic === "planned_staff" ||
          column.semantic === "role_headcount" ||
          column.semantic === "planned_output" ||
          column.semantic === "planned_output_per_person" ||
          column.semantic === "planned_hours"
        ) {
          row.getCell(columnIndex + 1).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: COLORS.paleGreen },
          };
        } else if (column.editable) {
          row.getCell(columnIndex + 1).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: COLORS.paleAmber },
          };
        }
      });
    });
    sectionHeader(production.getRow(1));
    production.autoFilter = {
      from: "A1",
      to: `${production.getColumn(columnDefinitions.length).letter}1`,
    };
    columnDefinitions.forEach((column, index) => {
      const worksheetColumn = production.getColumn(index + 1);
      if (column.dataType === "date") worksheetColumn.numFmt = "yyyy-mm-dd";
      else if (column.dataType === "percentage") worksheetColumn.numFmt = "0.0%";
      else if (column.dataType === "integer") worksheetColumn.numFmt = "#,##0";
      else if (column.dataType === "decimal") worksheetColumn.numFmt = "#,##0.00";

      const maxContentWidth = Math.max(
        column.label.length,
        ...planRows.map((row) => String(row[column.label] ?? "").length),
      );
      worksheetColumn.width = Math.min(Math.max(maxContentWidth + 2, 12), 34);
      worksheetColumn.alignment = { wrapText: true, vertical: "top" };
    });

    const actualStaffColumnNumber = excelColumn("actual_staff");
    const actualOutputColumnNumber = excelColumn("actual_output");
    for (let row = 2; row <= lastPlanRow; row += 1) {
      production.getCell(row, actualStaffColumnNumber).dataValidation = {
        type: "whole", operator: "between", formulae: [0, settings.teamSize], allowBlank: true,
        showErrorMessage: true, errorTitle: "Invalid team size", error: `Enter a value from 0 to ${settings.teamSize}.`,
      };
      production.getCell(row, actualOutputColumnNumber).dataValidation = {
        type: "decimal", operator: "greaterThanOrEqual", formulae: [0], allowBlank: true,
        showErrorMessage: true, errorTitle: "Invalid value", error: `${primaryActualColumn.label} cannot be negative.`,
      };
    }
    const statusLetter = excelLetter("status");
    production.addConditionalFormatting({
      ref: `${statusLetter}2:${statusLetter}${lastPlanRow}`,
      rules: [
        { type: "containsText", operator: "containsText", text: "Complete", priority: 1, style: { fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.paleGreen } } } },
        { type: "containsText", operator: "containsText", text: "In Progress", priority: 2, style: { fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.paleAmber } } } },
      ],
    });

    for (const sheet of plan.workbook.sheets) {
      if (sheet.sheetName === "Production Plan") continue;
      writeGenericSheet(workbook, sheet);
    }

    const monthly = workbook.addWorksheet("Monthly Summary", { views: [{ state: "frozen", ySplit: 1, showGridLines: false }] });
    const monthlyMetricLabel = result.unitLabel ?? "Hours";
    monthly.addRow(["Month", `Planned ${monthlyMetricLabel}`, `Actual ${monthlyMetricLabel}`, "Variance", "Completion Rate"]);
    const monthTargets = new Map<string, number>();
    planRows.forEach((row) => {
      const month = String(row[monthColumn.label] ?? "Unscheduled");
      monthTargets.set(
        month,
        (monthTargets.get(month) ?? 0) + Number(row[primaryTargetColumn.label] ?? 0),
      );
    });
    const monthLetter = excelLetter("month");
    [...monthTargets.entries()].forEach(([month, target], index) => {
      const row = index + 2;
      monthly.addRow([
        month,
        { formula: `SUMIF('Production Plan'!$${monthLetter}$2:$${monthLetter}$${lastPlanRow},A${row},'Production Plan'!$${targetOutputLetter}$2:$${targetOutputLetter}$${lastPlanRow})`, result: Number(target.toFixed(2)) },
        { formula: `SUMIF('Production Plan'!$${monthLetter}$2:$${monthLetter}$${lastPlanRow},A${row},'Production Plan'!$${actualOutputLetter}$2:$${actualOutputLetter}$${lastPlanRow})`, result: 0 },
        { formula: `IF(COUNT('Production Plan'!$${actualOutputLetter}$2:$${actualOutputLetter}$${lastPlanRow})=0,"",C${row}-B${row})`, result: "" },
        { formula: `IF(C${row}=0,"",IFERROR(C${row}/B${row},""))`, result: "" },
      ]);
    });
    sectionHeader(monthly.getRow(1));
    const monthlyValueFormat = isQuantityMode ? "#,##0" : "#,##0.00";
    monthly.getColumn(2).numFmt = monthlyValueFormat;
    monthly.getColumn(3).numFmt = monthlyValueFormat;
    monthly.getColumn(4).numFmt = monthlyValueFormat;
    monthly.getColumn(5).numFmt = "0.0%";
    monthly.autoFilter = { from: "A1", to: "E1" };
    setWidths(monthly, [20, 18, 18, 18, 18]);

    const phaseSheet = workbook.addWorksheet("Phases & Risks", { views: [{ showGridLines: false }] });
    title(phaseSheet, "A1:F2", "Delivery Phases & Risk Register");
    phaseSheet.getRow(4).values = ["Phase", "Objective"];
    phases.forEach((phase) => phaseSheet.addRow([phase.name, phase.objective]));
    sectionHeader(phaseSheet.getRow(4));
    const riskStart = phases.length + 7;
    phaseSheet.getRow(riskStart).values = ["Risk", "Impact", "Mitigation"];
    risks.forEach((risk) => phaseSheet.addRow([risk.risk, risk.impact, risk.mitigation]));
    if (risks.length === 0) phaseSheet.addRow(["No material risk proposed", "", "Continue routine monitoring."]);
    sectionHeader(phaseSheet.getRow(riskStart));
    phaseSheet.getColumn(1).width = 28;
    phaseSheet.getColumn(2).width = 46;
    phaseSheet.getColumn(3).width = 50;
    phaseSheet.getColumn(4).width = 4;
    phaseSheet.getColumn(5).width = 4;
    phaseSheet.getColumn(6).width = 4;
    phaseSheet.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true }; });

    const assumptions = workbook.addWorksheet("Assumptions", { views: [{ showGridLines: false }] });
    title(assumptions, "A1:D2", "Planning Assumptions");
    assumptions.getRow(4).values = ["No.", "Assumption"];
    plan.project.assumptions.forEach((assumption, index) => assumptions.addRow([index + 1, assumption]));
    sectionHeader(assumptions.getRow(4));
    assumptions.getColumn(1).width = 8;
    assumptions.getColumn(2).width = 90;
    assumptions.getColumn(2).alignment = { wrapText: true, vertical: "top" };

    for (const sheet of workbook.worksheets) bodyFont(sheet);

    const destination = outputPath ?? path.join(
      this.outputDirectory,
      `dynamic-production-plan-${randomUUID()}.xlsx`,
    );
    await mkdir(path.dirname(destination), { recursive: true });
    await workbook.xlsx.writeFile(destination);
    return destination;
  }
}

export const dynamicExcelService = new DynamicExcelService();
