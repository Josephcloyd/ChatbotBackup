import test from "node:test";
import assert from "node:assert/strict";
import type { ProductionPlan } from "../src/types/productionPlan.js";
import {
  applyProposalToPlanData,
  buildPlanChangeProposal,
  buildPlanExplanation,
  classifyPlanConversationIntent,
  extractPlanWorkspaceMetrics,
} from "../src/services/planWorkspaceService.js";

function samplePlan(): ProductionPlan {
  const dates = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"];
  return {
    project: {
      projectName: "Annotation Capacity Plan",
      projectDescription: "Create a production plan for four annotators with 120 total hours over 5 weekdays.",
      client: "Internal",
      startDate: dates[0]!,
      deadline: dates.at(-1)!,
      totalAssets: 120,
      assumptions: ["Weekdays only scheduling was used."],
      productionUnit: "hours",
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
            "Target Total Hours",
            "Target Total Hours per Annotator",
            "Actual Active Annotators",
            "Actual Total Hours",
            "Actual Total Hours per Annotator",
            "Target Hours",
            "Actual Hours",
            "Total Variance",
            "Completion Rate (%)",
            "Status",
            "Notes",
          ],
          rows: dates.map((date, index) => ({
            "No.": index + 1,
            Date: date,
            Month: "Aug 2026",
            Day: ["Mon", "Tue", "Wed", "Thu", "Fri"][index]!,
            "Target Active Annotators": 4,
            "Target Total Hours": 24,
            "Target Total Hours per Annotator": 6,
            "Actual Active Annotators": "",
            "Actual Total Hours": "",
            "Actual Total Hours per Annotator": "",
            "Target Hours": 24,
            "Actual Hours": "",
            "Total Variance": "",
            "Completion Rate (%)": "",
            Status: "Not Started",
            Notes: "Production",
          })),
        },
      ],
    },
    summary: "Planned workload: 120 hours from 2026-08-03 to 2026-08-07 with 4 resource(s).",
  };
}

test("classifies correction and calculation intents without treating every hours mention as calculation", () => {
  assert.equal(
    classifyPlanConversationIntent("The 120 hours should be for each annotator, not the whole team."),
    "report_mistake",
  );
  assert.equal(
    classifyPlanConversationIntent("How did you calculate the daily target?"),
    "explain_calculation",
  );
  assert.equal(classifyPlanConversationIntent("Tell me the weather."), "unrelated_request");
});

test("explains calculations using current plan rows", () => {
  const response = buildPlanExplanation(samplePlan(), "explain_calculation");
  assert.equal(response.intent, "explain_calculation");
  assert.match(response.message, /120 hours over 5 scheduled day/);
  assert.equal(response.explanation?.formulas?.[0]?.result, "24 hours/day");
});

test("builds per-worker total-hours proposal with recalculated metrics", () => {
  const proposal = buildPlanChangeProposal(
    "plan-1",
    "revision-1",
    samplePlan(),
    "The 120 hours should be for each annotator, not the entire team.",
  );
  assert.ok(proposal);
  assert.equal(proposal.changes[0]?.field, "planning.totalHours");
  assert.equal(proposal.changes[0]?.proposedValue, 480);
  assert.equal(proposal.recalculatedMetrics?.proposedDailyTarget, 96);
  assert.equal(proposal.requiresConfirmation, true);
});

test("revises an existing plan to a half-month duration", () => {
  const original = samplePlan();
  const proposal = buildPlanChangeProposal(
    "plan-1",
    "revision-1",
    original,
    "Change the production duration to .5 months.",
  );
  assert.ok(proposal);
  assert.ok(proposal.changes.some((change) =>
    change.field === "planning.durationValue" && change.proposedValue === 0.5
  ));
  assert.ok(proposal.changes.some((change) =>
    change.field === "planning.durationUnit" && change.proposedValue === "months"
  ));
  assert.equal(proposal.recalculatedMetrics?.proposedDuration, 11);

  const revised = applyProposalToPlanData(original, proposal, 2, "2026-07-29");
  const production = revised.workbook.sheets.find((sheet) => sheet.sheetName === "Production Plan");
  const allocation = revised.workbook.sheets.find((sheet) => sheet.sheetName === "LPB Allocation");
  assert.equal(production?.rows.length, 11);
  assert.equal(production?.rows[0]?.Date, "2026-08-03");
  assert.equal(production?.rows.at(-1)?.Date, "2026-08-17");
  assert.equal(revised.project.deadline, "2026-08-17");
  assert.deepEqual(
    allocation?.rows.map((row) => row["Workload Share (%)"]),
    [20, 50, 30],
  );
});

test("applies proposal to a revised immutable plan data copy", () => {
  const original = samplePlan();
  const proposal = buildPlanChangeProposal(
    "plan-1",
    "revision-1",
    original,
    "The 120 hours should be for each annotator, not the entire team.",
  );
  assert.ok(proposal);
  const revised = applyProposalToPlanData(original, proposal, 2, "2026-07-29");
  const originalMetrics = extractPlanWorkspaceMetrics(original);
  const revisedMetrics = extractPlanWorkspaceMetrics(revised);
  assert.equal(originalMetrics.totalHours, 120);
  assert.equal(revisedMetrics.totalHours, 480);
  assert.equal(revisedMetrics.dailyHours, 96);
  assert.equal(revised.project.assumptions.some((item) => item.startsWith("Revision 2:")), true);
});
