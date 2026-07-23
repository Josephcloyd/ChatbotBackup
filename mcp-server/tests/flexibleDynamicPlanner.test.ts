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
import { shouldClarifyRequest } from "../src/plannerService.js";

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
  const totalTargetImages = production!.rows.reduce((sum, row) => sum + Number(row["Target Images"] ?? 0), 0);
  assert.equal(totalTargetImages, 350000);

  const projectInfo = plan.workbook.sheets.find((sheet) => sheet.sheetName === "Project Information");
  assert.ok(projectInfo?.rows.some((row) => row.Field === "Planning model" && row.Value === "LPB Model"));
  planRulesService.validate(plan, { currentDate, input: { projectDescription: description } });
});

test("supports hours-only student enrollment encoding plans", () => {
  const description = "We need to encode student enrollment records for one week with eight total working hours.";
  const plan = dynamicPlan(description);
  assert.equal(plan.project.projectCategory, "data encoding");
  assert.equal(plan.project.productionUnit, "hours");
  assert.match(plan.summary, /Required daily output/i);
  planRulesService.validate(plan, { currentDate, input: { projectDescription: description } });
});

test("does not force clarification for hybrid workload-plus-budget requests", () => {
  const description = "Create a production plan for processing 10,000 records over a 5-month period using 50 recorders with a total labor budget of 400 hours. Distribute the workload, calculate daily, weekly, and monthly targets, assign hours fairly among the team, estimate productivity per recorder, and determine whether the 400-hour budget is sufficient to meet the target. Generate the plan in a structured format suitable for an Excel production planning workbook.";
  const constraints = extractRequestedConstraints(description, currentDate);

  assert.equal(constraints.totalQuantity, 10000);
  assert.equal(constraints.unitOfMeasure, "records");
  assert.equal(constraints.totalHours, 400);
  assert.equal(constraints.teamSize, 50);
  assert.equal(shouldClarifyRequest(constraints), false);

  const plan = dynamicPlan(description);
  assert.equal(plan.project.productionUnit, "records");
  assert.equal(plan.project.totalAssets, 10000);
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

test("challenge 1: enforces Recording to Validation to QA to Delivery dependencies", () => {
  const description = "Generate a production plan with dependencies for 160 total hours over 20 weekdays using 4 employees.";
  const plan = dynamicPlan(description);
  const taskSheet = plan.workbook.sheets.find((sheet) => sheet.sheetName === "Task Breakdown");
  assert.ok(taskSheet);
  const taskNames = taskSheet.rows.map((row) => String(row["Task Name"]));
  assert.ok(taskNames.some((name) => /Recording/i.test(name)));
  assert.ok(taskNames.some((name) => /Validation/i.test(name)));
  assert.ok(taskNames.some((name) => /\bQA\b/i.test(name)));
  assert.ok(taskNames.some((name) => /Delivery/i.test(name)));
  for (let index = 1; index < taskSheet.rows.length; index += 1) {
    assert.equal(taskSheet.rows[index]!.Dependencies, `TASK-${String(index).padStart(3, "0")}`);
    assert.ok(String(taskSheet.rows[index]!["Planned Start"]) >= String(taskSheet.rows[index - 1]!["Planned End"]));
  }
  planRulesService.validate(plan, { currentDate, input: { projectDescription: description } });
});

test("challenge 2: replans remaining work after month-three staffing changes", () => {
  const description =
    "Create a production plan for 60,000 records over 6 months using 50 employees with 48000 total hours. During Month 3, remove 15 employees due to leave and add 8 new junior employees. Recalculate the remaining schedule automatically.";
  const plan = dynamicPlan(description);
  assert.ok(plan.structuredPlan?.replanning.isReplan);
  assert.equal(plan.structuredPlan.replanning.preservedCompletedWork, true);

  const staffing = plan.workbook.sheets.find((sheet) => sheet.sheetName === "Staffing Changes");
  assert.ok(staffing);
  assert.ok(staffing.rows.some((row) => row["Removed Employees"] === 15 && row["Added Junior Employees"] === 8));

  const currentActuals = plan.workbook.sheets.find((sheet) => sheet.sheetName === "Current Actuals");
  assert.ok(currentActuals);
  assert.ok(currentActuals.rows.some((row) => row.Status === "Completed"));

  const forecast = plan.structuredPlan.forecast;
  assert.match(forecast.revisedCompletionDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(forecast.scheduleVarianceDays >= 0);
  assert.ok(plan.structuredPlan.replanning.remainingWork.length > 0);
});

test("challenge 3: excludes holidays and respects overtime limits in capacity", () => {
  const description =
    "Plan 100 records over 5 weekdays using 2 employees with 80 total hours, excluding holiday 2026-07-22, overtime limit of 1 hour per day.";
  const plan = dynamicPlan(description);
  const production = plan.workbook.sheets.find((sheet) => sheet.sheetName === "Production Plan");
  assert.ok(production);
  assert.equal(production.rows.some((row) => row.Date === "2026-07-22"), false);
  assert.ok(production.rows.every((row) => {
    const day = new Date(`${row.Date}T00:00:00Z`).getUTCDay();
    return day >= 1 && day <= 5;
  }));
  const capacity = plan.workbook.sheets.find((sheet) => sheet.sheetName === "Capacity Analysis");
  assert.ok(capacity?.rows.some((row) => row.Metric === "Overtime limit" && row.Value === 1));
  planRulesService.validate(plan, { currentDate, input: { projectDescription: description } });
});

test("challenge 4: scores scenarios and recommends the measurable optimum", () => {
  const description =
    "Compare three staffing strategies with different budgets and recommend the optimal solution for 120 total hours over 10 weekdays using 3 employees.";
  const plan = dynamicPlan(description);
  const scenarios = plan.workbook.sheets.find((sheet) => sheet.sheetName === "Scenario Comparison");
  assert.ok(scenarios);
  assert.equal(scenarios.rows.length, 3);
  assert.ok(scenarios.rows.every((row) => Number(row["Scenario Score"]) > 0));
  const best = scenarios.rows.reduce((winner, row) =>
    Number(row["Scenario Score"]) > Number(winner["Scenario Score"]) ? row : winner,
  );
  assert.equal(plan.structuredPlan?.recommendedScenario.name, best.Scenario);
  assert.ok(plan.workbook.sheets.some((sheet) => sheet.sheetName === "Cost Optimization"));
});

test("challenge 5: allocates shared validators without exceeding capacity", () => {
  const description =
    "Create a validation production plan for two projects sharing 4 validators over 10 weekdays with 160 total hours.";
  const plan = dynamicPlan(description);
  const resources = plan.workbook.sheets.find((sheet) => sheet.sheetName === "Resource Allocation");
  assert.ok(resources);
  assert.equal(resources.rows.length, 4);
  const maxPerValidator = 10 * 8;
  assert.ok(resources.rows.every((row) => Number(row["Planned Hours"]) <= maxPerValidator));
  const totalAssigned = resources.rows.reduce((sum, row) => sum + Number(row["Planned Hours"]), 0);
  assert.equal(totalAssigned, 160);
  planRulesService.validate(plan, { currentDate, input: { projectDescription: description } });
});

test("challenge 6: produces complete end-to-end workbook-ready planning output", () => {
  const description =
    "Generate a complete production plan considering staffing, dependencies, risks, forecasting, scenario comparison, holidays, overtime limits, and workbook generation for 10,000 records over 20 weekdays using 5 employees with 800 total hours excluding holiday 2026-07-22, overtime limit of 2 hours per day.";
  const plan = dynamicPlan(description);
  const requiredSheets = [
    "Executive Summary",
    "Input Assumptions",
    "Capacity Analysis",
    "Production Schedule",
    "Dependency Timeline",
    "Resource Allocation",
    "Staffing Changes",
    "Current Actuals",
    "Revised Forecast",
    "Scenario Comparison",
    "Cost Optimization",
    "Bottleneck Analysis",
    "Risk Register",
    "Recommended Recovery Plan",
    "KPI Dashboard",
    "Revision History",
  ];
  for (const sheetName of requiredSheets) {
    assert.ok(plan.workbook.sheets.some((sheet) => sheet.sheetName === sheetName), `${sheetName} should exist`);
  }
  assert.ok(plan.structuredPlan);
  assert.equal(plan.structuredPlan.excelWorkbook.sheets.includes("Scenario Comparison"), true);
  assert.match(plan.structuredPlan.forecast.revisedCompletionDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(plan.structuredPlan.scenarios.length === 3);
  assert.ok(plan.structuredPlan.recommendedScenario.name.length > 0);
  planRulesService.validate(plan, { currentDate, input: { projectDescription: description } });
});
