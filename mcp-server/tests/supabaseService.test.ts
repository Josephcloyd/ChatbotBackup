import assert from "node:assert/strict";
import test from "node:test";
import { buildPlanRecord, formatSupabaseError } from "../src/supabaseService.js";

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

test("formats plain Supabase error objects without losing details", () => {
  const message = formatSupabaseError("Supabase generation run insert failed", {
    message: "Could not find the table 'public.plan_generation_runs'",
    code: "PGRST205",
    details: "Searched schema cache",
    hint: "Apply migration 002_admin_dashboard_enhancements.sql",
  });

  assert.match(message, /Could not find the table/);
  assert.match(message, /code=PGRST205/);
  assert.match(message, /details=Searched schema cache/);
  assert.match(message, /hint=Apply migration 002_admin_dashboard_enhancements.sql/);
  assert.doesNotMatch(message, /\[object Object\]/);
});

test("adds migration hint for missing generation run table errors", () => {
  const message = formatSupabaseError("Supabase generation run insert failed", {
    message: "Could not find the table 'public.plan_generation_runs' in the schema cache",
    code: "PGRST205",
  });

  assert.match(message, /002_admin_dashboard_enhancements\.sql/);
  assert.match(message, /reload the Supabase schema cache/);
});

test("adds identity migration hint when a WhatsApp ID is sent to a uuid column", () => {
  const message = formatSupabaseError("Supabase insert failed", {
    message: 'invalid input syntax for type uuid: "120363427079155334@g.us"',
    code: "22P02",
  });

  assert.match(message, /004_repair_external_identity_column_types\.sql/);
  assert.match(message, /stored as text, not uuid/);
});
