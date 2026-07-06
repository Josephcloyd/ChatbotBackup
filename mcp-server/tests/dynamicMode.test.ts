import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";
import {
  buildDynamicPlan,
  type DynamicPlanProposal,
} from "../src/services/dynamicPlanService.js";
import { DynamicExcelService } from "../src/services/dynamicExcelService.js";
import { PlanRulesService } from "../src/services/planRulesService.js";
import {
  extractRequestedConstraints,
  resolvePlanningSettings,
} from "../src/services/planningConstraintsService.js";

const description = "Create a production plan for a class of 4 annotators over 4 calendar months with 400 total hours, starting 2026-08-01.";

const proposal: DynamicPlanProposal = {
  projectName: "Four-month annotation program",
  client: "Example Client",
  totalAssets: 10000,
  planningSettings: {
    startDate: "2026-08-01",
    durationValue: 4,
    durationUnit: "months",
    weekdaysOnly: false,
    totalHours: 400,
    teamSize: 4,
  },
  assumptions: ["Source data is available before kickoff."],
  phases: [
    { name: "Mobilization", objective: "Prepare the team and guidelines." },
    { name: "Production", objective: "Complete planned annotation work." },
  ],
  risks: [
    { risk: "Late inputs", impact: "Schedule delay", mitigation: "Confirm readiness before kickoff." },
  ],
  summary: "A controlled four-month delivery plan.",
};

test("extracts month, staffing, hours, calendar-day, and start-date constraints", () => {
  assert.deepEqual(extractRequestedConstraints(description), {
    duration: { value: 4, unit: "months" },
    totalHours: 400,
    teamSize: 4,
    weekdaysOnly: false,
    startDate: "2026-08-01",
  });
});

test("resolves starting today without depending on an Ollama-proposed date", () => {
  const settings = resolvePlanningSettings(
    "Plan a team of 4 for 4 months with 400 hours, starting today.",
    "2026-07-06",
    { startDate: "2027-01-01" },
  );
  assert.equal(settings.startDate, "2026-07-06");
  assert.deepEqual(settings.duration, { value: 4, unit: "months" });
  assert.equal(settings.teamSize, 4);
  assert.equal(settings.totalHours, 400);
});

test("builds and validates an exact dynamic four-month schedule", () => {
  const result = buildDynamicPlan({ projectDescription: description }, proposal, "2026-07-06");
  const sheet = result.plan.workbook.sheets[0]!;
  assert.equal(sheet.rows.length, 122);
  assert.equal(sheet.rows[0]?.Date, "2026-08-01");
  assert.equal(sheet.rows.at(-1)?.Date, "2026-11-30");
  assert.equal(
    Number(sheet.rows.reduce((sum, row) => sum + Number(row["Target Total Hours"]), 0).toFixed(2)),
    400,
  );
  assert.ok(sheet.rows.every((row) => row["Target Active Annotators"] === 4));
  new PlanRulesService().validate(result.plan, {
    currentDate: "2026-07-06",
    input: { projectDescription: description },
  });
});

test("writes a styled template-free workbook with formulas and all dynamic sheets", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dynamic-plan-"));
  try {
    const result = buildDynamicPlan({ projectDescription: description }, proposal, "2026-07-06");
    const outputPath = path.join(directory, "dynamic.xlsx");
    await new DynamicExcelService(directory).writeDynamicProductionPlan(result, outputPath);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(outputPath);
    assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
      "Executive Summary",
      "Production Plan",
      "Monthly Summary",
      "Phases & Risks",
      "Assumptions",
    ]);
    const production = workbook.getWorksheet("Production Plan")!;
    assert.equal(production.actualRowCount, 123);
    assert.equal(production.getCell("G2").formula, "IFERROR(F2/E2,0)");
    assert.equal(production.getCell("O2").result, "Not Started");
    assert.equal(production.getCell("B2").numFmt, "yyyy-mm-dd");
    assert.equal(production.getCell("H2").dataValidation.type, "whole");
    assert.equal(workbook.getWorksheet("Monthly Summary")!.getCell("B2").formula?.startsWith("SUMIF("), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
