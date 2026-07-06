import assert from "node:assert/strict";
import test from "node:test";
import { buildPlanRecord } from "../src/supabaseService.js";

test("derives stored hour and team estimates from production targets", () => {
  const record = buildPlanRecord("user-1", "Plan 12 hours", {
    project: {
      projectName: "Example",
      projectDescription: "Plan 12 hours",
      client: "Client",
      startDate: "2026-07-06",
      deadline: "2026-07-07",
      totalAssets: 10,
      assumptions: ["Inputs are ready"],
    },
    workbook: {
      sheets: [{
        sheetName: "Production Plan",
        columns: ["Target Total Hours", "Target Active Annotators"],
        rows: [
          { "Target Total Hours": 5, "Target Active Annotators": 2 },
          { "Target Total Hours": "7", "Target Active Annotators": 3 },
        ],
      }],
    },
    summary: "Summary",
  });

  assert.equal(record.total_hours_estimate, 12);
  assert.equal(record.recommended_team_size, 3);
  assert.deepEqual(record.key_risks, ["Inputs are ready"]);
});
