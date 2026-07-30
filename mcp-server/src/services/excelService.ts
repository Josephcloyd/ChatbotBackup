import ExcelJS from "exceljs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ProductionPlan } from "../types/productionPlan.js";
import type { TemplateWorkbookDefinition } from "./templateService.js";

function copyRowFormatting(source: ExcelJS.Row, target: ExcelJS.Row): void {
  target.height = source.height;
  target.hidden = source.hidden;
  target.outlineLevel = source.outlineLevel;
  source.eachCell({ includeEmpty: true }, (sourceCell, columnNumber) => {
    const targetCell = target.getCell(columnNumber);
    targetCell.style = JSON.parse(
      JSON.stringify(sourceCell.style),
    ) as ExcelJS.Style;
    if (sourceCell.dataValidation) {
      targetCell.dataValidation = JSON.parse(
        JSON.stringify(sourceCell.dataValidation),
      );
    }
  });
}

function rowIsAvailable(
  worksheet: ExcelJS.Worksheet,
  rowNumber: number,
  columnNumbers: number[],
): boolean {
  return columnNumbers.every((columnNumber) => {
    const cell = worksheet.getCell(rowNumber, columnNumber);
    return (
      cell.type === ExcelJS.ValueType.Null ||
      cell.type === ExcelJS.ValueType.Formula
    );
  });
}

export class ExcelService {
  constructor(private readonly outputDirectory = path.resolve("outputs")) {}

  async writeProductionPlan(
    plan: ProductionPlan,
    templateDefinition: TemplateWorkbookDefinition,
    outputPath?: string,
  ): Promise<string> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templateDefinition.templatePath);

    for (const generatedSheet of plan.workbook.sheets) {
      const definition = templateDefinition.sheets.find(
        (sheet) => sheet.sheetName === generatedSheet.sheetName,
      );
      const worksheet = workbook.getWorksheet(generatedSheet.sheetName);
      if (!definition || !worksheet) {
        throw new Error(
          `Template worksheet not found: ${generatedSheet.sheetName}`,
        );
      }

      let headerRowNumber = definition.headerRow;
      if (headerRowNumber === null) {
        if (
          worksheet.actualRowCount === 0 &&
          generatedSheet.columns.length > 0
        ) {
          headerRowNumber = 1;
          generatedSheet.columns.forEach((header, index) => {
            worksheet.getCell(1, index + 1).value = header;
          });
        } else {
          continue;
        }
      }

      const templateDataRow = worksheet.getRow(headerRowNumber + 1);
      const columnNumbers = definition.columns.map(
        (column) => column.columnNumber,
      );
      let nextRowNumber = headerRowNumber + 1;
      generatedSheet.rows.forEach((generatedRow, rowIndex) => {
        while (
          nextRowNumber <= worksheet.actualRowCount &&
          !rowIsAvailable(worksheet, nextRowNumber, columnNumbers)
        ) {
          nextRowNumber += 1;
        }

        const rowNumber = nextRowNumber;
        nextRowNumber += 1;
        const targetRow = worksheet.getRow(rowNumber);

        if (rowNumber > worksheet.actualRowCount && templateDataRow.hasValues) {
          copyRowFormatting(templateDataRow, targetRow);
        }

        for (const column of definition.columns) {
          const cell = targetRow.getCell(column.columnNumber);
          // Formula and non-master merged cells belong to the official layout.
          if (
            cell.type === ExcelJS.ValueType.Formula ||
            (cell.isMerged && cell.master !== cell)
          ) {
            continue;
          }
          cell.value = generatedRow[column.header] ?? "";
        }

        targetRow.commit();
      });
    }

    const destination =
      outputPath ??
      path.join(this.outputDirectory, `production-plan-${randomUUID()}.xlsx`);
    await mkdir(path.dirname(destination), { recursive: true });
    await workbook.xlsx.writeFile(destination);
    return destination;
  }
}

export const excelService = new ExcelService();
