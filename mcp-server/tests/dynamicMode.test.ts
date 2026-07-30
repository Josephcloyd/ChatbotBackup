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
    projectType: "annotation",
    planningModel: "LPB Model",
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

test("supports .5 and 0.5 month production-plan durations", () => {
  for (const durationText of [".5 months", "0.5 months"]) {
    const request =
      `Create a production plan for 100 records over ${durationText}, ` +
      "using calendar days, starting 2026-08-01.";
    const constraints = extractRequestedConstraints(request, "2026-07-06");
    assert.deepEqual(constraints.duration, { value: 0.5, unit: "months" });

    const settings = resolvePlanningSettings(request, "2026-07-06");
    const result = buildDynamicPlan(
      { projectDescription: request },
      {
        ...proposal,
        planningSettings: {
          ...proposal.planningSettings,
          durationValue: 1,
          durationUnit: "months",
          weekdaysOnly: false,
        },
      },
      "2026-07-06",
    );
    const rows = result.plan.workbook.sheets[0]!.rows;

    assert.deepEqual(settings.duration, { value: 0.5, unit: "months" });
    assert.equal(rows.length, 15);
    assert.equal(rows[0]?.Date, "2026-08-01");
    assert.equal(rows.at(-1)?.Date, "2026-08-15");
    new PlanRulesService().validate(result.plan, {
      currentDate: "2026-07-06",
      input: { projectDescription: request },
      requiredPlanningModel: "LPB Model",
    });
  }
});

test("rejects fractional day and week durations", () => {
  assert.throws(
    () => resolvePlanningSettings("Create a plan over 1.5 weeks.", "2026-07-06"),
    /whole days or weeks/,
  );
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

test("normalizes next Monday and schedules a weekday-only onboarding plan", () => {
  const request = "Create a 4-week production plan for onboarding 5 employees, 80 total hours, weekdays only, starting next Monday.";
  const onboardingProposal: DynamicPlanProposal = {
    ...proposal,
    projectName: "Employee onboarding plan",
    planningSettings: {
      startDate: "next Monday",
      durationValue: 4,
      durationUnit: "weeks",
      weekdaysOnly: true,
      totalHours: 80,
      teamSize: 5,
    },
  };
  const constraints = extractRequestedConstraints(request, "2026-07-10");
  assert.equal(constraints.startDate, "2026-07-13");
  assert.deepEqual(constraints.dateInterpretations, [
    { source: "next Monday", normalized: "2026-07-13", kind: "startDate" },
  ]);

  const result = buildDynamicPlan({ projectDescription: request }, onboardingProposal, "2026-07-10");
  const sheet = result.plan.workbook.sheets.find((item) => item.sheetName === "Production Plan")!;
  assert.equal(sheet.rows.length, 20);
  assert.equal(sheet.rows[0]?.Date, "2026-07-13");
  assert.equal(sheet.rows.at(-1)?.Date, "2026-08-07");
  assert.equal(
    sheet.rows.some((row) => ["Sat", "Sun"].includes(String(row.Day))),
    false,
  );
  assert.equal(
    Number(sheet.rows.reduce((sum, row) => sum + Number(row["Target Total Hours"]), 0).toFixed(2)),
    80,
  );
  assert.ok(result.plan.workbook.sheets.some((item) => item.sheetName === "Milestones"));
  assert.ok(String(sheet.rows[0]?.Notes).includes("onboarding"));
  new PlanRulesService().validate(result.plan, {
    currentDate: "2026-07-10",
    input: { projectDescription: request },
  });
});

test("chooses a sensible missing-date default for weekday production work", () => {
  const request = "Create a 2-week production plan for data validation with 3 people and 90 hours, weekdays only.";
  const validationProposal: DynamicPlanProposal = {
    ...proposal,
    planningSettings: {
      startDate: "2027-01-01",
      durationValue: 2,
      durationUnit: "weeks",
      weekdaysOnly: true,
      totalHours: 90,
      teamSize: 3,
    },
  };
  const result = buildDynamicPlan({ projectDescription: request }, validationProposal, "2026-07-10");
  const sheet = result.plan.workbook.sheets.find((item) => item.sheetName === "Production Plan")!;
  assert.equal(sheet.rows[0]?.Date, "2026-07-10");
  assert.equal(sheet.rows.length, 10);
});

test("builds a deeper annotation plan with QA, review, buffer, and weekly tracking sheets", () => {
  const request = "Make a 3-month production plan for 4 annotators with 400 total hours. Include QA, review, buffer, and weekly progress tracking.";
  const annotationProposal: DynamicPlanProposal = {
    ...proposal,
    projectName: "Annotation delivery plan",
    planningSettings: {
      startDate: "2026-07-10",
      durationValue: 3,
      durationUnit: "months",
      weekdaysOnly: true,
      totalHours: 400,
      teamSize: 4,
    },
  };
  const result = buildDynamicPlan({ projectDescription: request }, annotationProposal, "2026-07-10");
  const sheetNames = result.plan.workbook.sheets.map((sheet) => sheet.sheetName);
  assert.ok(sheetNames.includes("Weekly Schedule"));
  assert.ok(sheetNames.includes("QA Review"));
  assert.ok(sheetNames.includes("Progress Tracker"));
  assert.ok(sheetNames.includes("Resource Allocation"));
  const qaSheet = result.plan.workbook.sheets.find((sheet) => sheet.sheetName === "QA Review")!;
  assert.match(JSON.stringify(qaSheet.rows), /QA sample/i);
  const progress = result.plan.workbook.sheets.find((sheet) => sheet.sheetName === "Progress Tracker")!;
  assert.ok(progress.rows.length > 8);
});

test("writes a styled template-free workbook with formulas and all dynamic sheets", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dynamic-plan-"));
  try {
    const result = buildDynamicPlan({ projectDescription: description }, proposal, "2026-07-06");
    const outputPath = path.join(directory, "dynamic.xlsx");
    await new DynamicExcelService(directory).writeDynamicProductionPlan(result, outputPath);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(outputPath);
    const sheetNames = workbook.worksheets.map((sheet) => sheet.name);
    assert.deepEqual(sheetNames.slice(0, 9), [
      "Overview",
      "Production Plan",
      "Weekly Schedule",
      "Resource Allocation",
      "Milestones",
      "QA Review",
      "Risks and Assumptions",
      "Progress Tracker",
      "Summary",
    ]);
    const production = workbook.getWorksheet("Production Plan")!;
    assert.equal(production.actualRowCount, 123);
    assert.equal(production.getCell("G2").formula, "IFERROR(F2/E2,0)");
    assert.equal(production.getCell("O2").result, "Not Started");
    assert.equal(production.getCell("B2").numFmt, "yyyy-mm-dd");
    assert.equal(production.getCell("H2").dataValidation.type, "whole");
    assert.ok(workbook.getWorksheet("QA Review")!.actualRowCount > 1);
    assert.equal(workbook.getWorksheet("Monthly Summary")!.getCell("B2").formula?.startsWith("SUMIF("), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("derives stored hour and team estimates from production targets", () => {
  const request = "Create a production plan for 3 members with 120 total hours over 3 weeks, weekdays only.";
  const constraints = extractRequestedConstraints(request);
  assert.equal(constraints.totalHours, 120);
  assert.equal(constraints.teamSize, 3);
  assert.deepEqual(constraints.duration, { value: 3, unit: "weeks" });
  assert.equal(constraints.weekdaysOnly, true);
});

test("flexible quantity regex — pass 3 matches unit-then-number phrasing", () => {
  // "images" appears before the number — needs Pass 3 of the multi-pass extractor
  const desc = "Target images to be collected is 350000.";
  const constraints = extractRequestedConstraints(desc);
  assert.equal(constraints.unitOfMeasure, "images");
  assert.equal(constraints.totalQuantity, 350000);
});

test("flexible quantity regex — user production prompt extracts quantity correctly", () => {
  const desc = "Create a production plan for Image Text collection. The total number images would equal to 350000 images, with a timeframe of 6 months. The start date is April 3, 2026.";
  const constraints = extractRequestedConstraints(desc, "2026-04-03");
  // "350000 images" is adjacent — Pass 1 should catch this
  assert.equal(constraints.unitOfMeasure, "images");
  assert.equal(constraints.totalQuantity, 350000);
  assert.deepEqual(constraints.duration, { value: 6, unit: "months" });
});

test("throughput extraction — parses explicit images per hour from prompt", () => {
  const desc = "Collect 350000 images over 6 months at 50 images per hour with a team of 2.";
  const constraints = extractRequestedConstraints(desc);
  assert.equal(constraints.totalQuantity, 350000);
  assert.equal(constraints.unitOfMeasure, "images");
  assert.equal(constraints.throughputRate, 50);
  assert.equal(constraints.teamSize, 2);
});

test("throughput-aware plan — uses Target Images columns, sums exactly to totalQuantity, includes throughput assumption", () => {
  const request = "Create a production plan for 350000 images over 6 months starting 2026-04-03, team of 1.";
  const imageProposal: DynamicPlanProposal = {
    projectName: "Image Text Collection",
    client: "",
    totalAssets: 350000,
    planningSettings: {
      startDate: "2026-04-03",
      durationValue: 6,
      durationUnit: "months",
      weekdaysOnly: true,
      totalHours: 1040,
      teamSize: 1,
      hoursPerDay: 8,
      throughputRate: 42,
    },
    assumptions: ["Image quality is consistent throughout the project."],
    phases: [
      { name: "Collection", objective: "Capture target images at planned daily rate." },
    ],
    risks: [
      { risk: "Equipment failure", impact: "Daily quota missed", mitigation: "Maintain backup equipment." },
    ],
    summary: "A 6-month image collection plan targeting 350,000 images.",
  };

  const result = buildDynamicPlan({ projectDescription: request }, imageProposal, "2026-04-03");

  // Column profile should be quantity-based
  assert.equal(result.unitLabel, "Images");
  assert.equal(result.totalQuantity, 350000);
  assert.ok(result.throughputRate !== undefined, "throughputRate should be set");
  assert.ok(result.hoursPerDay !== undefined, "hoursPerDay should be set");

  const sheet = result.plan.workbook.sheets.find((s) => s.sheetName === "Production Plan")!;
  assert.ok(sheet.columns.includes("Target Images"), "should have Target Images column");
  assert.ok(sheet.columns.includes("Target Hours"), "should have Target Hours capacity reference");
  assert.ok(!sheet.columns.includes("Target Total Hours"), "should NOT have hour-mode column");

  // Sum of Target Images must equal exactly 350000
  const total = sheet.rows.reduce((sum, row) => sum + Number(row["Target Images"] ?? 0), 0);
  assert.equal(total, 350000);

  // Assumptions should include throughput line
  const hasTP = result.plan.project.assumptions.some((a) => a.includes("Throughput:"));
  assert.ok(hasTP, "assumptions should include throughput summary");
});
