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
  assert.equal(plan.project.planningModel, "LPB Model");
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

test("applies LPB 20-50-30 workload allocation to the AEO social-post plan", () => {
  const description =
    "Create a production plan for our AEO Optimization Plan. The goal is to achieve the target number of social media posts engaged, so the main unit of measure for this production plan is number of posts. The target number of posts to be engaged is 20000 posts across different platforms which is expected to be completely achieved within 2.5 months starting today. Apply LPB Model.";
  const constraints = extractRequestedConstraints(description, currentDate);
  assert.equal(constraints.unitOfMeasure, "posts");
  assert.equal(constraints.totalQuantity, 20000);
  assert.deepEqual(constraints.duration, { value: 2.5, unit: "months" });
  assert.equal(constraints.startDate, currentDate);
  assert.equal(constraints.planningModel, "LPB Model");

  const plan = dynamicPlan(description);
  const production = plan.workbook.sheets.find((sheet) => sheet.sheetName === "Production Plan");
  const allocation = plan.workbook.sheets.find((sheet) => sheet.sheetName === "LPB Allocation");
  assert.ok(production);
  assert.ok(allocation);

  const stageTotals = new Map([
    ["LPB-L", 0],
    ["LPB-P", 0],
    ["LPB-B", 0],
  ]);
  for (const row of production!.rows) {
    const stage = [...stageTotals.keys()].find((key) => String(row.Notes).includes(key));
    assert.ok(stage);
    stageTotals.set(stage, stageTotals.get(stage)! + Number(row["Target Posts"]));
  }
  assert.deepEqual(Object.fromEntries(stageTotals), {
    "LPB-L": 4000,
    "LPB-P": 10000,
    "LPB-B": 6000,
  });
  assert.deepEqual(
    allocation!.rows.map((row) => ({
      stage: row.Stage,
      percentage: row["Workload Share (%)"],
      workload: row["Planned Workload"],
    })),
    [
      { stage: "LPB-L", percentage: 20, workload: 4000 },
      { stage: "LPB-P", percentage: 50, workload: 10000 },
      { stage: "LPB-B", percentage: 30, workload: 6000 },
    ],
  );
  planRulesService.validate(plan, {
    currentDate,
    input: { projectDescription: description },
    requiredPlanningModel: "LPB Model",
  });
});

test("treats approved video recording hours as output duration instead of labor hours", () => {
  const description =
    "Create a detailed production plan for a video-recording project involving 10 video recorders who must produce a total of 465 hours of approved and usable video recordings within a three-month period. The team will work from Monday to Friday, with each recorder following a standard eight-hour workday. The production process should include equipment preparation, actual video recording, file transfer, quality checking, corrections, and final submission. The 465-hour target refers specifically to the total duration of completed recordings that have passed quality review and been approved, rather than the total number of labor hours worked by the team.";
  const constraints = extractRequestedConstraints(description, currentDate);
  assert.equal(constraints.projectType, "content production");
  assert.equal(constraints.teamSize, 10);
  assert.deepEqual(constraints.duration, { value: 3, unit: "months" });
  assert.equal(constraints.weekdaysOnly, true);
  assert.equal(constraints.totalQuantity, 465);
  assert.equal(constraints.unitOfMeasure, "video hours");
  assert.equal(constraints.totalHours, undefined);

  const settings = resolvePlanningSettings(description, currentDate, proposal().planningSettings);
  assert.ok(settings.totalHours > 465, "labor capacity should be derived separately from approved video duration");

  const plan = dynamicPlan(description);
  assert.equal(plan.project.projectCategory, "content production");
  assert.equal(plan.project.productionUnit, "video hours");
  assert.equal(plan.project.totalAssets, 465);
  assert.ok(plan.project.assumptions.some((assumption) => /465 video hours/i.test(assumption)));

  const production = plan.workbook.sheets.find((sheet) => sheet.sheetName === "Production Plan");
  assert.ok(production);
  assert.ok(production!.columns.includes("Target Active Recorders"));
  assert.ok(production!.columns.includes("Target Video Hours"));
  assert.ok(production!.columns.includes("Target Video Hours per Recorder"));
  assert.ok(production!.rows.every((row) => row["Target Active Recorders"] === 10));
  const targetVideoHours = production!.rows.reduce((sum, row) => sum + Number(row["Target Video Hours"] ?? 0), 0);
  assert.equal(targetVideoHours, 465);

  const projectInfo = plan.workbook.sheets.find((sheet) => sheet.sheetName === "Project Information");
  assert.ok(projectInfo?.rows.some((row) => row.Field === "Requires clarification" && row.Value === "false"));
  planRulesService.validate(plan, { currentDate, input: { projectDescription: description } });
});

test("does not confuse video recorders with video output quantity", () => {
  const description =
    "Create a detailed production plan for a video-recording project using the LPB Model. The project has 10 video recorders and must deliver 465 hours of approved, usable final video recordings within 3 months. The 465 hours refers to completed video duration that passes quality review, not labor hours. Work schedule: Monday to Friday only, 8 working hours per recorder per day, no weekend work.";
  const constraints = extractRequestedConstraints(description, currentDate);
  assert.equal(constraints.teamSize, 10);
  assert.equal(constraints.totalQuantity, 465);
  assert.equal(constraints.unitOfMeasure, "video hours");
  assert.equal(constraints.totalHours, undefined);

  const plan = dynamicPlan(description);
  assert.equal(plan.project.productionUnit, "video hours");
  assert.equal(plan.project.totalAssets, 465);
  const production = plan.workbook.sheets.find((sheet) => sheet.sheetName === "Production Plan");
  assert.ok(production?.columns.includes("Target Active Recorders"));
  assert.ok(production?.columns.includes("Actual Video Hours per Recorder"));
  const projectInfo = plan.workbook.sheets.find((sheet) => sheet.sheetName === "Project Information");
  assert.ok(projectInfo?.rows.some((row) => row.Field === "Requires clarification" && row.Value === "false"));
});

test("supports hours-only student enrollment encoding plans", () => {
  const description = "We need to encode student enrollment records for one week with eight total working hours.";
  const constraints = extractRequestedConstraints(description, currentDate);
  assert.equal(constraints.planningModel, "LPB Model");

  const plan = dynamicPlan(description);
  assert.equal(plan.project.projectCategory, "data encoding");
  assert.equal(plan.project.productionUnit, "hours");
  assert.match(plan.summary, /Required daily output/i);
  assert.ok(plan.project.assumptions.some((assumption) => /LPB Model/i.test(assumption)));
  planRulesService.validate(plan, { currentDate, input: { projectDescription: description } });
});

test("uses LPB Model even when another planning model is named", () => {
  const description = "Create a plan for 200 records using ABC planning model.";
  const constraints = extractRequestedConstraints(description, currentDate);
  assert.equal(constraints.planningModel, "LPB Model");

  const customProposal = proposal();
  customProposal.assumptions = [
    "Use ABC model for the schedule.",
    "Inputs are available before production starts.",
  ];
  customProposal.summary = "An ABC model schedule.";
  const result = buildDynamicPlan({ projectDescription: description }, customProposal, currentDate);
  assert.equal(result.settings.planningModel, "LPB Model");
  assert.equal(result.plan.project.planningModel, "LPB Model");
  assert.ok(result.plan.project.assumptions.some((assumption) => /LPB Model/i.test(assumption)));
  assert.ok(result.plan.project.assumptions.every((assumption) => !/ABC model/i.test(assumption)));
  assert.doesNotMatch(result.plan.summary, /ABC model/i);
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

test("honors weekday duration phrased with over", () => {
  const description = "Create a production plan for four annotators with 120 total hours over 50 weekdays.";
  const constraints = extractRequestedConstraints(description, currentDate);
  assert.deepEqual(constraints.duration, { value: 50, unit: "days" });
  assert.equal(constraints.durationDays, 50);
  assert.equal(constraints.weekdaysOnly, true);

  const settings = resolvePlanningSettings(description, currentDate);
  const dates = buildScheduleDates(settings);
  assert.equal(dates.length, 50);
  assert.ok(dates.every((date) => {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    return day >= 1 && day <= 5;
  }));
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
