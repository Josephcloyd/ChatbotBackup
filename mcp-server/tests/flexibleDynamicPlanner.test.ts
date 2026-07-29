import assert from "node:assert/strict";
import test from "node:test";
import { parseOllamaJson } from "../src/ollamaService.js";
import {
  buildDynamicPlan,
  type DynamicPlanProposal,
} from "../src/services/dynamicPlanService.js";
import {
  buildScheduleDates,
  extractRequestedConstraints,
  resolvePlanningSettings,
} from "../src/services/planningConstraintsService.js";
import { planRulesService } from "../src/services/planRulesService.js";

const currentDate = "2026-07-21";

function proposal(overrides: Partial<DynamicPlanProposal> = {}): DynamicPlanProposal {
  return {
    projectName: "Flexible Test Plan",
    client: "",
    totalAssets: 0,
    planningSettings: {
      startDate: currentDate,
      durationValue: 5,
      durationUnit: "days",
      weekdaysOnly: true,
      totalHours: 40,
      teamSize: 2,
    },
    assumptions: ["Productivity assumptions should be confirmed with the team."],
    phases: [],
    risks: [],
    summary: "A flexible production plan was generated.",
    ...overrides,
  };
}

function dynamicPlan(description: string) {
  return buildDynamicPlan(
    { projectDescription: description },
    proposal(),
    currentDate,
  ).plan;
}

test("extracts flexible project categories, quantities, words, and units", () => {
  const software = extractRequestedConstraints(
    "Create a six-week HRIS dashboard development plan for two developers and one tester.",
    currentDate,
  );
  assert.equal(software.projectType, "software development");
  assert.deepEqual(software.duration, { value: 6, unit: "weeks" });
  assert.equal(software.teamSize, 2);

  const receipts = extractRequestedConstraints(
    "Create a production plan for processing 5,000 receipts using OCR and manual verification.",
    currentDate,
  );
  assert.equal(receipts.projectType, "document processing");
  assert.equal(receipts.totalQuantity, 5000);
  assert.equal(receipts.unitOfMeasure, "receipts");

  const manufacturing = extractRequestedConstraints(
    "Manufacture 2,000 units using two machines operating eight hours per weekday.",
    currentDate,
  );
  assert.equal(manufacturing.projectType, "manufacturing");
  assert.equal(manufacturing.totalQuantity, 2000);
  assert.equal(manufacturing.unitOfMeasure, "units");
  assert.equal(manufacturing.teamSize, 2);
  assert.equal(manufacturing.totalHours, undefined);
});

test("builds dynamic sheets for software projects without annotation-only structure", () => {
  const plan = dynamicPlan("Create a six-week HRIS dashboard development plan for two developers and one tester.");
  assert.equal(plan.project.projectCategory, "software development");
  assert.equal(plan.project.productionUnit, "hours");
  assert.ok(plan.workbook.sheets.some((sheet) => sheet.sheetName === "Workflow Stages"));
  assert.ok(plan.workbook.sheets.some((sheet) => sheet.sheetName === "Task Breakdown"));
  assert.ok(plan.workbook.sheets.some((sheet) => sheet.sheetName === "KPI Tracker"));

  const taskSheet = plan.workbook.sheets.find((sheet) => sheet.sheetName === "Task Breakdown");
  assert.ok(taskSheet?.rows.some((row) => String(row["Assigned Role"]).includes("Delivery")));
  assert.ok(taskSheet?.rows.some((row) => /Testing|QA/i.test(String(row["Task Name"]))));
});

test("builds quantity plans for documents, records, and manufacturing units", () => {
  for (const [description, unit] of [
    ["Process 5,000 receipts using OCR and manual verification over 10 weekdays.", "receipts"],
    ["Create a plan for four annotators handling 10,000 images over 30 weekdays.", "images"],
    ["Manufacture 2,000 units using two machines over 20 weekdays.", "units"],
  ] as const) {
    const plan = dynamicPlan(description);
    const production = plan.workbook.sheets.find((sheet) => sheet.sheetName === "Production Plan");
    assert.ok(production?.columns.some((column) => column.toLowerCase().includes(unit)));
    assert.equal(plan.project.productionUnit, unit);
    planRulesService.validate(plan, { currentDate, input: { projectDescription: description } });
  }
});

test("builds image-based text capture plans from natural WhatsApp wording", () => {
  const description =
    "Create a production plan about our text capture collection. The main unit of measure for the production are images. Target images to be collected is 350000. Target timeframe is 6 months, with a starting date of today, July 21, 2026. Apply LPB Model.";
  const constraints = extractRequestedConstraints(description, currentDate);
  assert.equal(constraints.projectType, "data collection");
  assert.equal(constraints.unitOfMeasure, "images");
  assert.equal(constraints.totalQuantity, 350000);
  assert.deepEqual(constraints.duration, { value: 6, unit: "months" });
  assert.equal(constraints.startDate, "2026-07-21");
  assert.equal(constraints.planningModel, "LPB Model");

  const plan = dynamicPlan(description);
  assert.equal(plan.project.projectCategory, "data collection");
  assert.equal(plan.project.productionUnit, "images");
  assert.equal(plan.project.totalAssets, 350000);
  assert.match(plan.summary, /350,000 images/i);
  assert.ok(plan.project.assumptions.some((assumption) => /LPB Model/i.test(assumption)));

  const production = plan.workbook.sheets.find((sheet) => sheet.sheetName === "Production Plan");
  assert.ok(production);
  assert.ok(production!.columns.includes("Target Images"));
  assert.ok(production!.columns.includes("LPB Phase"));
  const totalTargetImages = production!.rows.reduce((sum, row) => sum + Number(row["Target Images"] ?? 0), 0);
  assert.equal(totalTargetImages, 350000);
  const phaseTotals = production!.rows.reduce<Record<string, number>>((totals, row) => {
    const phase = String(row["LPB Phase"] ?? "");
    totals[phase] = (totals[phase] ?? 0) + Number(row["Target Images"] ?? 0);
    return totals;
  }, {});
  assert.equal(phaseTotals.Learning, 70000);
  assert.equal(phaseTotals.Performing, 175000);
  assert.equal(phaseTotals.Breakthrough, 105000);
  assert.ok(production!.rows.some((row) => /Training day/i.test(String(row.Notes))));
  assert.ok(production!.rows.some((row) => /Full-production day/i.test(String(row.Notes))));
  assert.ok(production!.rows.some((row) => /Final validation day/i.test(String(row.Notes))));
  assert.equal(production!.rows.at(-1)?.["Expected Completion %"], 100);

  const projectInfo = plan.workbook.sheets.find((sheet) => sheet.sheetName === "Project Information");
  assert.ok(projectInfo?.rows.some((row) => row.Field === "Planning model" && row.Value === "LPB Model"));
  const lpbSummary = plan.workbook.sheets.find((sheet) => sheet.sheetName === "LPB Phase Summary");
  assert.ok(lpbSummary?.rows.some((row) => row.Phase === "Learning" && row["Target Share"] === "20%"));
  assert.ok(lpbSummary?.rows.some((row) => row.Phase === "Performing" && row["Target Share"] === "50%"));
  assert.ok(lpbSummary?.rows.some((row) => row.Phase === "Breakthrough" && row["Target Share"] === "30%"));
  planRulesService.validate(plan, { currentDate, input: { projectDescription: description } });
});

test("honors explicit historical LPB start date for Siri image text collection plans", () => {
  const description =
    "Create a production plan for Image Text collection for Siri AI Text data training. The main unit of measure for the production is: number of images. The total number images would equal to 350000 images, with a timeframe of 6 months. The start date is April 3, 2026. Apply LPB model.";
  const constraints = extractRequestedConstraints(description, "2026-07-29");
  assert.equal(constraints.startDate, "2026-04-03");
  assert.equal(constraints.allowPastDates, true);
  assert.equal(constraints.planningModel, "LPB Model");

  const plan = buildDynamicPlan(
    { projectDescription: description },
    proposal(),
    "2026-07-29",
  ).plan;
  const production = plan.workbook.sheets.find((sheet) => sheet.sheetName === "Production Plan");
  assert.ok(production);
  assert.equal(production!.rows[0]?.Date, "2026-04-03");
  assert.equal(production!.rows.at(-1)?.["Expected Completion %"], 100);

  const phaseTotals = production!.rows.reduce<Record<string, number>>((totals, row) => {
    const phase = String(row["LPB Phase"] ?? "");
    totals[phase] = (totals[phase] ?? 0) + Number(row["Target Images"] ?? 0);
    return totals;
  }, {});
  assert.equal(phaseTotals.Learning, 70000);
  assert.equal(phaseTotals.Performing, 175000);
  assert.equal(phaseTotals.Breakthrough, 105000);
  planRulesService.validate(plan, { currentDate: "2026-07-29", input: { projectDescription: description } });
});

test("supports hours-only student enrollment encoding plans", () => {
  const description = "We need to encode student enrollment records for one week with eight total working hours.";
  const plan = dynamicPlan(description);
  assert.equal(plan.project.projectCategory, "data encoding");
  assert.equal(plan.project.productionUnit, "hours");
  assert.match(plan.summary, /Required daily output/i);
  planRulesService.validate(plan, { currentDate, input: { projectDescription: description } });
});

test("builds schedules for custom working days only", () => {
  const description = "Plan 30 tasks over six working days on Mondays, Wednesdays, and Fridays.";
  const constraints = extractRequestedConstraints(description, currentDate);
  assert.deepEqual(constraints.workingDays, [1, 3, 5]);
  const settings = resolvePlanningSettings(description, currentDate, {
    durationValue: 6,
    durationUnit: "days",
    totalHours: 24,
    teamSize: 1,
  });
  const dates = buildScheduleDates(settings);
  assert.equal(dates.length, 6);
  assert.ok(dates.every((date) => [1, 3, 5].includes(new Date(`${date}T00:00:00Z`).getUTCDay())));
});

test("capacity and quality-control effort are represented deterministically", () => {
  const plan = dynamicPlan("Plan 120 hours of work for four workers within 50 weekdays.");
  const capacity = plan.workbook.sheets.find((sheet) => sheet.sheetName === "Capacity Analysis");
  const quality = plan.workbook.sheets.find((sheet) => sheet.sheetName === "Quality Plan");
  assert.ok(capacity?.rows.some((row) => row.Metric === "Feasibility status"));
  assert.ok(quality?.rows.some((row) => Number(row["Planned Hours"]) > 0));
});

test("plan rules reject invalid task dependencies and chart sources", () => {
  const description = "Create a production plan for processing 5,000 receipts over 10 weekdays.";
  const plan = dynamicPlan(description);
  const taskSheet = plan.workbook.sheets.find((sheet) => sheet.sheetName === "Task Breakdown");
  assert.ok(taskSheet);
  taskSheet!.rows[0]!.Dependencies = "TASK-999";
  assert.throws(
    () => planRulesService.validate(plan, { currentDate, input: { projectDescription: description } }),
    /unknown dependency/,
  );

  taskSheet!.rows[0]!.Dependencies = "";
  const chartSheet = plan.workbook.sheets.find((sheet) => sheet.sheetName === "Chart Specs");
  assert.ok(chartSheet);
  chartSheet!.rows[0]!["Source Worksheet"] = "Missing Sheet";
  assert.throws(
    () => planRulesService.validate(plan, { currentDate, input: { projectDescription: description } }),
    /unknown source worksheet/,
  );
});

test("parses Ollama JSON surrounded by markdown", () => {
  const parsed = parseOllamaJson<{ success: boolean }>('```json\n{"success":true}\n```');
  assert.equal(parsed.success, true);
});
