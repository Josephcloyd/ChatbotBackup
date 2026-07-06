import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";
import { ExcelService } from "../src/services/excelService.js";
import { PromptService } from "../src/services/promptService.js";
import { TemplateService } from "../src/services/templateService.js";
import { ValidationService } from "../src/services/validationService.js";

async function makeTemplate(directory: string): Promise<string> {
  const templatePath = path.join(directory, "ProductionPlanTemplate.xlsx");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Schedule");
  sheet.mergeCells("A1:B1");
  sheet.getCell("A1").value = "Official Production Plan";
  sheet.getCell("A2").value = "Task";
  sheet.getCell("B2").value = "Hours";
  sheet.getRow(2).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  sheet.getCell("B3").value = { formula: "LEN(A3)", result: 0 };
  sheet.getCell("A3").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
  await workbook.xlsx.writeFile(templatePath);
  return templatePath;
}

test("template definition drives prompt, validation, and workbook writing", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "production-plan-"));

  try {
    const templatePath = await makeTemplate(directory);
    const definition = await new TemplateService(templatePath).loadDefinition();
    assert.deepEqual(definition.sheets.map((sheet) => sheet.sheetName), ["Schedule"]);
    assert.equal(definition.sheets[0]?.headerRow, 2);
    assert.deepEqual(
      definition.sheets[0]?.columns.map((column) => column.header),
      ["Task", "Hours"],
    );

    const prompt = new PromptService().buildProductionPrompt({
      projectDescription: "Produce a labeled image dataset",
      templateDefinition: definition,
    });
    assert.match(prompt, /Use ONLY the provided sheet names/);
    assert.match(prompt, /"Task"/);

    const validator = new ValidationService();
    const plan = validator.validateProductionPlan(
      {
        project: {
          projectName: "Image labeling",
          projectDescription: "Produce a labeled image dataset",
          client: "Example",
          startDate: "2026-07-03",
          deadline: "2026-07-31",
          totalAssets: 1000,
          assumptions: ["Images are available"],
        },
        workbook: {
          sheets: [
            {
              sheetName: "Schedule",
              columns: ["Task", "Hours"],
              rows: [{ Task: "Label images", Hours: { unsupported: true } }],
            },
          ],
        },
        summary: "A practical labeling plan.",
      },
      definition,
    );
    assert.equal(plan.workbook.sheets[0]?.rows[0]?.Hours, "");

    assert.throws(
      () =>
        validator.validateProductionPlan(
          {
            ...plan,
            workbook: {
              sheets: [
                {
                  sheetName: "Schedule",
                  columns: ["Task", "Hours"],
                  rows: [{ Task: "Label", Hours: 2, Invented: "no" }],
                },
              ],
            },
          },
          definition,
        ),
      /Unknown row key "Invented"/,
    );

    const outputPath = path.join(directory, "filled.xlsx");
    await new ExcelService(directory).writeProductionPlan(plan, definition, outputPath);
    const result = new ExcelJS.Workbook();
    await result.xlsx.readFile(outputPath);
    const sheet = result.getWorksheet("Schedule")!;
    assert.equal(sheet.getCell("A3").value, "Label images");
    assert.equal(sheet.getCell("B3").formula, "LEN(A3)");
    assert.equal(sheet.getCell("A3").fill.type, "pattern");
    assert.equal(sheet.getCell("A1").value, "Official Production Plan");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
