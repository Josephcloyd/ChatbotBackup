import type {
  ProductionPlan,
  ProductionPlanCellValue,
  ProductionPlanProject,
  ProductionPlanRow,
} from "../types/productionPlan.js";
import type {
  TemplateSheetDefinition,
  TemplateWorkbookDefinition,
} from "./templateService.js";

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

function findMatchingColumnHeader(
  rawKey: string,
  columns: string[],
): string | undefined {
  const cleanKey = rawKey.toLowerCase().replace(/[^a-z0-9]/g, "");
  // 1. Exact clean match
  let match = columns.find(
    (c) => c.toLowerCase().replace(/[^a-z0-9]/g, "") === cleanKey,
  );
  if (match) return match;

  // 2. Ignore "of" stopword match (e.g. "Plan no. Posts" vs "Plan no. of Posts")
  match = columns.find((c) => {
    const cNoOf = c
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .replace(/of/g, "");
    const kNoOf = cleanKey.replace(/of/g, "");
    return cNoOf === kNoOf;
  });

  return match;
}

function validateSheet(
  value: unknown,
  templateSheet: TemplateSheetDefinition,
): ProductionPlan["workbook"]["sheets"][number] {
  if (!isRecord(value))
    throw new Error("Each workbook sheet must be an object");
  if (value.sheetName !== templateSheet.sheetName) {
    throw new Error(`Unknown sheetName: ${String(value.sheetName)}`);
  }

  // Always use the authoritative template columns order and headers
  const columns = templateSheet.columns.map((column) => column.header);

  if (!Array.isArray(value.rows)) {
    throw new Error(
      `rows must be an array for sheet ${templateSheet.sheetName}`,
    );
  }

  const rows: ProductionPlanRow[] = value.rows.map((row, rowIndex) => {
    if (!isRecord(row)) {
      throw new Error(
        `Row ${rowIndex + 1} in sheet ${templateSheet.sheetName} must be an object`,
      );
    }

    const unknownKey = Object.keys(row).find(
      (k) => !findMatchingColumnHeader(k, columns),
    );
    if (unknownKey) {
      throw new Error(
        `Unknown row key "${unknownKey}" in row ${rowIndex + 1} of sheet ${templateSheet.sheetName}`,
      );
    }

    const rowObj: ProductionPlanRow = {};
    columns.forEach((colHeader) => {
      let rawVal = row[colHeader];
      if (rawVal === undefined) {
        // Match key flexibly
        const foundKey = Object.keys(row).find(
          (k) => findMatchingColumnHeader(k, columns) === colHeader,
        );
        if (foundKey) rawVal = row[foundKey];
      }
      rowObj[colHeader] = cellValue(rawVal);
    });

    return rowObj;
  });

  return { sheetName: templateSheet.sheetName, columns, rows };
}

export class ValidationService {
  validateProductionPlan(
    value: unknown,
    templateDefinition: TemplateWorkbookDefinition,
  ): ProductionPlan {
    if (!isRecord(value)) throw new Error("Production plan must be an object");

    let rawSheets: unknown[] = [];
    if (
      isRecord(value.workbook) &&
      Array.isArray(value.workbook.sheets) &&
      value.workbook.sheets.length > 0
    ) {
      rawSheets = value.workbook.sheets;
    } else {
      console.warn(
        "[validationService] LLM omitted workbook.sheets, synthesizing template sheet structure.",
      );
      rawSheets = templateDefinition.sheets.map((ts) => ({
        sheetName: ts.sheetName,
        columns: ts.columns.map((col) => col.header),
        rows: [],
      }));
    }

    const templateByName = new Map(
      templateDefinition.sheets.map((sheet) => [sheet.sheetName, sheet]),
    );
    const generatedNames = rawSheets.map((sheet) =>
      isRecord(sheet) ? sheet.sheetName : undefined,
    );

    const duplicateName = generatedNames.find(
      (name, index) =>
        typeof name === "string" && generatedNames.indexOf(name) !== index,
    );
    if (duplicateName) throw new Error(`Duplicate sheetName: ${duplicateName}`);

    const sheets = rawSheets.map((sheet) => {
      const sheetName = isRecord(sheet) ? sheet.sheetName : undefined;
      const templateSheet =
        typeof sheetName === "string"
          ? templateByName.get(sheetName)
          : undefined;
      if (!templateSheet)
        throw new Error(`Unknown sheetName: ${String(sheetName)}`);
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
