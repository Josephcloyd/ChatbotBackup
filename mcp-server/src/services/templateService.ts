import ExcelJS from "exceljs";
import { fileURLToPath } from "node:url";

export interface TemplateColumnDefinition {
  header: string;
  columnNumber: number;
  columnLetter: string;
  required: boolean;
}

export interface TemplateSheetMetadata {
  rowCount: number;
  columnCount: number;
  dataStartRow: number | null;
  existingDataRowCount: number;
  state: "visible" | "hidden" | "veryHidden";
  mergedCellRanges: string[];
  tableNames: string[];
}

export interface TemplateSheetDefinition {
  sheetName: string;
  headerRow: number | null;
  columns: TemplateColumnDefinition[];
  metadata?: TemplateSheetMetadata;
}

export interface TemplateWorkbookDefinition {
  templatePath: string;
  sheets: TemplateSheetDefinition[];
}

const DEFAULT_TEMPLATE_PATH = fileURLToPath(
  new URL("../templates/ProductionPlanTemplate.xlsx", import.meta.url),
);

function headerText(cell: ExcelJS.Cell): string {
  return cell.text.trim();
}

function scoreHeaderCandidate(row: ExcelJS.Row): number {
  let populated = 0;
  let styled = 0;

  row.eachCell({ includeEmpty: false }, (cell) => {
    if (!headerText(cell)) return;
    populated += 1;
    const hasVisibleFill = cell.fill?.type === "pattern" && cell.fill.pattern !== "none";
    if (cell.font?.bold || hasVisibleFill || cell.border?.bottom?.style) {
      styled += 1;
    }
  });

  if (populated === 0) return -1;
  // A multi-column row is far more likely to be a table header than a title.
  // A majority-styled header band should beat denser data rows. A lone styled
  // title still loses to the wide, unstyled headers used by the Detail tabs.
  const headerBandBonus = populated >= 2 && styled / populated >= 0.6 ? 100_000 : 0;
  return headerBandBonus + populated * 100 - row.number;
}

function detectHeaderRow(worksheet: ExcelJS.Worksheet): ExcelJS.Row | null {
  const scanLimit = Math.min(Math.max(worksheet.actualRowCount, 1), 50);
  let bestRow: ExcelJS.Row | null = null;
  let bestScore = -1;

  for (let rowNumber = 1; rowNumber <= scanLimit; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const score = scoreHeaderCandidate(row);
    if (score > bestScore) {
      bestScore = score;
      bestRow = row;
    }
  }

  return bestScore < 0 ? null : bestRow;
}

export class TemplateService {
  constructor(public readonly templatePath = DEFAULT_TEMPLATE_PATH) {}

  async loadDefinition(): Promise<TemplateWorkbookDefinition> {
    const workbook = new ExcelJS.Workbook();

    try {
      await workbook.xlsx.readFile(this.templatePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to open production plan template at ${this.templatePath}: ${message}`);
    }

    return {
      templatePath: this.templatePath,
      sheets: workbook.worksheets.map((worksheet) => {
        const headerRow = detectHeaderRow(worksheet);
        const columns: TemplateColumnDefinition[] = [];

        headerRow?.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
          const header = headerText(cell);
          if (!header) return;
          columns.push({
            header,
            columnNumber,
            columnLetter: worksheet.getColumn(columnNumber).letter,
            required: true,
          });
        });

        return {
          sheetName: worksheet.name,
          headerRow: headerRow?.number ?? null,
          columns,
          metadata: {
            rowCount: worksheet.actualRowCount,
            columnCount: worksheet.actualColumnCount,
            dataStartRow: headerRow ? headerRow.number + 1 : null,
            existingDataRowCount: headerRow
              ? Math.max(
                  0,
                  worksheet.getRows(
                    headerRow.number + 1,
                    Math.max(worksheet.actualRowCount - headerRow.number, 0),
                  )?.filter((row) => row.hasValues).length ?? 0,
                )
              : 0,
            state: worksheet.state,
            mergedCellRanges: [...(worksheet.model.merges ?? [])],
            // ExcelJS 4.x's declaration incorrectly describes getTables() as
            // tuples; at runtime it returns Table[].
            tableNames: (worksheet.getTables() as unknown as ExcelJS.Table[]).map(
              (table) => table.name,
            ),
          },
        };
      }),
    };
  }
}

export const templateService = new TemplateService();
