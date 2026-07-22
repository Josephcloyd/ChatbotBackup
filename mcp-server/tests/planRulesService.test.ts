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
    { duration: { value: 30, unit: "days" }, durationDays: 30, totalHours: 60 },
  );
});

test("accepts a future plan matching requested duration and total hours", () => {
  assert.equal(new PlanRulesService().validate(makePlan(), options).summary, "A realistic plan.");
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
