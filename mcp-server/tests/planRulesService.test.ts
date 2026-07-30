import assert from "node:assert/strict";
import test from "node:test";
import type { ProductionPlan } from "../src/types/productionPlan.js";
import { extractRequestedConstraints } from "../src/services/planningConstraintsService.js";
import { PlanRulesService } from "../src/services/planRulesService.js";

const columns = [
  "Date",
  "Target Total Hours",
  "Actual Active Annotators",
  "Actual Total Hours",
  "Actual Total Hours per Annotator",
  "Actual Hours",
  "Total Variance",
  "Completion Rate (%)",
];

function makePlan(overrides: Record<string, string | number | boolean | null> = {}): ProductionPlan {
  return {
    project: {
      projectName: "Annotation plan",
      projectDescription: "Two-day annotation plan",
      client: "Example",
      startDate: "2026-07-06",
      deadline: "2026-07-07",
      totalAssets: 100,
      assumptions: [],
    },
    workbook: {
      sheets: [
        {
          sheetName: "Production Plan",
          columns,
          rows: [
            {
              Date: "2026-07-06",
              "Target Total Hours": 4,
              "Actual Active Annotators": "",
              "Actual Total Hours": "",
              "Actual Total Hours per Annotator": "",
              "Actual Hours": "",
              "Total Variance": "",
              "Completion Rate (%)": "",
              ...overrides,
            },
            {
              Date: "2026-07-07",
              "Target Total Hours": 4,
              "Actual Active Annotators": "",
              "Actual Total Hours": "",
              "Actual Total Hours per Annotator": "",
              "Actual Hours": "",
              "Total Variance": "",
              "Completion Rate (%)": "",
            },
          ],
        },
      ],
    },
    summary: "A realistic plan.",
  };
}

const options = {
  currentDate: "2026-07-06",
  input: { projectDescription: "Create a 2-day duration plan with 8 total hours" },
};

test("extracts duration and total-hour constraints", () => {
  assert.deepEqual(
    extractRequestedConstraints("Create a 30-day duration plan with 60 total hours."),
    { duration: { value: 30, unit: "days" }, durationDays: 30, totalHours: 60, planningModel: "LPB Model" },
  );
});

test("accepts a future plan matching requested duration and total hours", () => {
  assert.equal(new PlanRulesService().validate(makePlan(), options).summary, "A realistic plan.");
});

test("requires LPB metadata when the planner enables the LPB policy", () => {
  const rules = new PlanRulesService();
  const plan = makePlan();
  const production = plan.workbook.sheets[0]!;
  production.rows[0]!["Target Total Hours"] = 2.4;
  production.rows[1]!["Target Total Hours"] = 6;
  production.rows.push({
    ...production.rows[1]!,
    Date: "2026-07-08",
    "Target Total Hours": 3.6,
  });
  plan.project.deadline = "2026-07-08";
  plan.project.planningModel = "LPB Model";
  plan.project.assumptions.push("Required planning model applied: LPB Model.");
  plan.workbook.sheets.push({
    sheetName: "Project Information",
    columns: ["Field", "Value"],
    rows: [{ Field: "Planning model", Value: "LPB Model" }],
  });
  plan.workbook.sheets.push({
    sheetName: "LPB Allocation",
    columns: ["Stage", "Workload Share (%)", "Scheduled Days", "Planned Workload"],
    rows: [
      { Stage: "LPB-L", "Workload Share (%)": 20, "Scheduled Days": 1, "Planned Workload": 2.4 },
      { Stage: "LPB-P", "Workload Share (%)": 50, "Scheduled Days": 1, "Planned Workload": 6 },
      { Stage: "LPB-B", "Workload Share (%)": 30, "Scheduled Days": 1, "Planned Workload": 3.6 },
    ],
  });
  const lpbOptions = {
    currentDate: "2026-07-06",
    input: { projectDescription: "Create a 3-day production plan with 12 total hours" },
    requiredPlanningModel: "LPB Model",
  };

  assert.equal(
    rules.validate(plan, lpbOptions).project.planningModel,
    "LPB Model",
  );

  plan.project.planningModel = "ABC Model";
  assert.throws(
    () => rules.validate(plan, lpbOptions),
    /must use LPB Model/,
  );

  plan.project.planningModel = "LPB Model";
  plan.project.assumptions.push("Use ABC Model.");
  assert.throws(
    () => rules.validate(plan, lpbOptions),
    /assumptions conflict with LPB Model/,
  );
});

test("rejects stale dates and fabricated actual values", () => {
  const rules = new PlanRulesService();
  assert.throws(
    () => rules.validate(makePlan({ Date: "2023-10-01" }), options),
    /uses past date 2023-10-01/,
  );
  assert.throws(
    () => rules.validate(makePlan({ "Actual Total Hours": 4 }), options),
    /must leave future actual column "Actual Total Hours" blank/,
  );
});

test("auto-expands sample rows and rejects incorrect target-hour totals", () => {
  const rules = new PlanRulesService();
  const plan = makePlan();
  const validated = rules.validate(plan, {
    ...options,
    input: { projectDescription: "Create a 3-day duration plan with 8 total hours" },
  });
  assert.strictEqual(validated.workbook.sheets[0].rows.length, 3);
  assert.throws(
    () => rules.validate(makePlan({ "Target Total Hours": 3 }), options),
    /targets sum to 7/,
  );
});

test("auto-expands LPB sample rows with weighted phases and explicit start date", () => {
  const rules = new PlanRulesService();
  const description =
    "Create a production plan for Image Text collection for Siri AI Text data training. The main unit of measure for the production is: number of images. The total number images would equal to 350000 images, with a timeframe of 6 months. The start date is April 3, 2026. Apply LPB model.";
  const plan: ProductionPlan = {
    project: {
      projectName: "Siri Image Text Collection",
      projectDescription: description,
      client: "",
      startDate: "2026-07-29",
      deadline: "2027-01-28",
      totalAssets: 350000,
      assumptions: [],
    },
    workbook: {
      sheets: [
        {
          sheetName: "Production Plan",
          columns: [
            "No.",
            "Date",
            "Month",
            "Day",
            "Target Active Annotators",
            "Target Images",
            "Target Images per Annotator",
            "Actual Active Annotators",
            "Actual Images",
            "Actual Images per Annotator",
            "Target Hours",
            "Actual Hours",
            "Total Variance",
            "Completion Rate (%)",
            "Status",
            "LPB Phase",
            "Expected Completion %",
            "Notes",
          ],
          rows: [
            {
              "No.": 1,
              Date: "2026-07-29",
              Month: "Jul 2026",
              Day: "Wed",
              "Target Active Annotators": 1,
              "Target Images": 2652,
              "Target Images per Annotator": 2652,
              "Actual Active Annotators": "",
              "Actual Images": "",
              "Actual Images per Annotator": "",
              "Target Hours": 1.21,
              "Actual Hours": "",
              "Total Variance": "",
              "Completion Rate (%)": "",
              Status: "Not Started",
              "LPB Phase": "Learning",
              "Expected Completion %": "",
              Notes: "Training day: onboarding, process familiarization, calibration, and coached starter production",
            },
          ],
        },
      ],
    },
    summary: "Sample plan.",
  };

  const validated = rules.validate(plan, {
    currentDate: "2026-07-29",
    input: { projectDescription: description },
  });
  const production = validated.workbook.sheets[0]!;
  assert.equal(production.rows[0]?.Date, "2026-04-03");
  assert.equal(production.rows.at(-1)?.["Expected Completion %"], 100);

  const phaseTotals = production.rows.reduce<Record<string, number>>((totals, row) => {
    const phase = String(row["LPB Phase"] ?? "");
    totals[phase] = (totals[phase] ?? 0) + Number(row["Target Images"] ?? 0);
    return totals;
  }, {});
  assert.equal(phaseTotals.Learning, 70000);
  assert.equal(phaseTotals.Performing, 175000);
  assert.equal(phaseTotals.Breakthrough, 105000);
  assert.ok(production.rows.some((row) => /Full-production day/i.test(String(row.Notes))));
  assert.ok(production.rows.some((row) => /Final validation day/i.test(String(row.Notes))));
});
