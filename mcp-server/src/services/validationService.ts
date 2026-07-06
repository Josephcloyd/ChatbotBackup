import type {
  ProductionPlan,
  ProductionPlanCellValue,
  ProductionPlanProject,
  ProductionPlanRow,
} from "../types/productionPlan.js";
import type { TemplateSheetDefinition, TemplateWorkbookDefinition } from "./templateService.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function cellValue(value: unknown): ProductionPlanCellValue {
  return typeof value === "string" ||
    typeof value === "boolean" ||
    value === null
      ? value
      : typeof value === "number" && Number.isFinite(value)
        ? value
        : "";
}

function validateProject(value: unknown): ProductionPlanProject {
  if (!isRecord(value)) throw new Error("project must be an object");

  const totalAssets =
    typeof value.totalAssets === "number" && Number.isFinite(value.totalAssets)
      ? value.totalAssets
      : 0;

  return {
    projectName: textValue(value.projectName),
    projectDescription: textValue(value.projectDescription),
    client: textValue(value.client),
    startDate: textValue(value.startDate),
    deadline: textValue(value.deadline),
    totalAssets,
    assumptions: Array.isArray(value.assumptions)
      ? value.assumptions.map(textValue)
      : [],
  };
}

function validateSheet(
  value: unknown,
  templateSheet: TemplateSheetDefinition,
): ProductionPlan["workbook"]["sheets"][number] {
  if (!isRecord(value)) throw new Error("Each workbook sheet must be an object");
  if (value.sheetName !== templateSheet.sheetName) {
    throw new Error(`Unknown sheetName: ${String(value.sheetName)}`);
  }
  if (!Array.isArray(value.columns)) {
    throw new Error(`columns must be an array for sheet ${templateSheet.sheetName}`);
  }

  const columns = value.columns.filter((column): column is string => typeof column === "string");
  if (columns.length !== value.columns.length) {
    throw new Error(`All columns must be strings for sheet ${templateSheet.sheetName}`);
  }

  const allowedColumns = new Set(templateSheet.columns.map((column) => column.header));
  const unknownColumn = columns.find((column) => !allowedColumns.has(column));
  if (unknownColumn) {
    throw new Error(`Unknown column "${unknownColumn}" in sheet ${templateSheet.sheetName}`);
  }

  const requiredColumns = templateSheet.columns
    .filter((column) => column.required)
    .map((column) => column.header);
  const missingColumn = requiredColumns.find((column) => !columns.includes(column));
  if (missingColumn) {
    throw new Error(`Required column "${missingColumn}" is missing from sheet ${templateSheet.sheetName}`);
  }

  if (new Set(columns).size !== columns.length) {
    throw new Error(`Duplicate columns are not allowed in sheet ${templateSheet.sheetName}`);
  }
  const expectedOrder = templateSheet.columns.map((column) => column.header);
  if (columns.some((column, index) => column !== expectedOrder[index])) {
    throw new Error(`Columns are not in template order for sheet ${templateSheet.sheetName}`);
  }
  if (!Array.isArray(value.rows)) {
    throw new Error(`rows must be an array for sheet ${templateSheet.sheetName}`);
  }

  const rows: ProductionPlanRow[] = value.rows.map((row, rowIndex) => {
    if (!isRecord(row)) {
      throw new Error(`Row ${rowIndex + 1} in sheet ${templateSheet.sheetName} must be an object`);
    }

    const unknownKey = Object.keys(row).find((key) => !allowedColumns.has(key));
    if (unknownKey) {
      throw new Error(
        `Unknown row key "${unknownKey}" in row ${rowIndex + 1} of sheet ${templateSheet.sheetName}`,
      );
    }

    return Object.fromEntries(columns.map((column) => [column, cellValue(row[column])]));
  });

  return { sheetName: templateSheet.sheetName, columns, rows };
}

export class ValidationService {
  validateProductionPlan(
    value: unknown,
    templateDefinition: TemplateWorkbookDefinition,
  ): ProductionPlan {
    if (!isRecord(value)) throw new Error("Production plan must be an object");
    if (!isRecord(value.workbook) || !Array.isArray(value.workbook.sheets)) {
      throw new Error("workbook.sheets must be an array");
    }
    if (value.workbook.sheets.length === 0) {
      throw new Error("workbook.sheets must contain at least one template sheet");
    }

    const templateByName = new Map(
      templateDefinition.sheets.map((sheet) => [sheet.sheetName, sheet]),
    );
    const generatedNames = value.workbook.sheets.map((sheet) =>
      isRecord(sheet) ? sheet.sheetName : undefined,
    );

    const duplicateName = generatedNames.find(
      (name, index) => typeof name === "string" && generatedNames.indexOf(name) !== index,
    );
    if (duplicateName) throw new Error(`Duplicate sheetName: ${duplicateName}`);

    const sheets = value.workbook.sheets.map((sheet) => {
      const sheetName = isRecord(sheet) ? sheet.sheetName : undefined;
      const templateSheet = typeof sheetName === "string" ? templateByName.get(sheetName) : undefined;
      if (!templateSheet) throw new Error(`Unknown sheetName: ${String(sheetName)}`);
      return validateSheet(sheet, templateSheet);
    });

    return {
      project: validateProject(value.project),
      workbook: { sheets },
      summary: textValue(value.summary),
    };
  }
}

export const validationService = new ValidationService();
