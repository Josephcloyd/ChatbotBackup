import path from "node:path";
import { buildDynamicPlan, type DynamicPlanProposal } from "../src/services/dynamicPlanService.js";
import { DynamicExcelService } from "../src/services/dynamicExcelService.js";

const description = "Create a production plan for a class of 4 annotators over 4 calendar months with 400 total hours, starting 2026-08-01.";
const proposal: DynamicPlanProposal = {
  projectName: "Four-Month Annotation Production Plan",
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
  assumptions: [
    "Input data and annotation guidelines are available before kickoff.",
    "All four annotators complete onboarding before production begins.",
    "Quality review occurs throughout delivery rather than only at the end.",
  ],
  phases: [
    { name: "Mobilization", objective: "Confirm inputs, guidelines, access, and team readiness." },
    { name: "Pilot", objective: "Validate instructions and calibrate quality expectations." },
    { name: "Production", objective: "Deliver the planned workload against daily targets." },
    { name: "Closeout", objective: "Resolve remaining issues and confirm final acceptance." },
  ],
  risks: [
    { risk: "Late or incomplete source data", impact: "Reduces available production time.", mitigation: "Confirm readiness and escalation owners before kickoff." },
    { risk: "Guideline ambiguity", impact: "Creates rework and inconsistent quality.", mitigation: "Run a pilot and document adjudicated examples." },
    { risk: "Team availability", impact: "Daily targets may be missed.", mitigation: "Track attendance and rebalance work weekly." },
  ],
  summary: "A four-month, calendar-day production plan for four annotators with exactly 400 planned hours, supported by editable actuals, monthly rollups, phases, risks, and assumptions.",
};

const currentDate = "2026-07-06";
const result = buildDynamicPlan({ projectDescription: description }, proposal, currentDate);
const outputPath = path.resolve("outputs", "dual-mode-demo", "dynamic-production-plan-demo.xlsx");
await new DynamicExcelService().writeDynamicProductionPlan(result, outputPath);
console.log(outputPath);
