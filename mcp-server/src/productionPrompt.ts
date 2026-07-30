import type { TemplateWorkbookDefinition } from "./services/templateService.js";
import { promptService } from "./services/promptService.js";
import type {
  ProductionPlan,
  ProductionPlanInput,
} from "./types/productionPlan.js";

export type { ProductionPlanInput } from "./types/productionPlan.js";
export type ProductionPlanOutput = ProductionPlan;

export function buildProductionPrompt(
  input: Pick<ProductionPlanInput, "projectDescription">,
  templateDefinition: TemplateWorkbookDefinition,
  currentDate?: string,
): string {
  return promptService.buildProductionPrompt({
    projectDescription: input.projectDescription,
    templateDefinition,
    currentDate,
  });
}

export function buildWhatsAppSummary(plan: ProductionPlan): string {
  const project = plan.project;
  const unit = project.productionUnit ?? "hours";
  const workloadMatch = plan.summary.match(/\bPlanned workload:\s*([^.]*)\./i);
  const plannedWorkload =
    workloadMatch?.[1]?.trim() ||
    (unit !== "hours" && project.totalAssets > 0
      ? `${project.totalAssets.toLocaleString()} ${unit}`
      : "See workbook schedule");
  const riskSheet = plan.workbook.sheets.find(
    (sheet) =>
      sheet.sheetName === "Risk Register" ||
      sheet.sheetName === "Risks and Assumptions",
  );
  const firstRisk = riskSheet?.rows.find(
    (row) =>
      String(row.Type ?? "Risk").toLowerCase() === "risk" ||
      row.Description ||
      row.Item,
  );
  const mainRisk = firstRisk
    ? String(firstRisk.Description ?? firstRisk.Item ?? "").trim()
    : "";

  const lines = [
    "Production plan ready",
    "",
    project.projectName || "Production Plan",
    `Category: ${project.projectCategory ?? "production"}`,
    `Schedule: ${project.startDate} to ${project.deadline}`,
    `Planned workload: ${plannedWorkload}`,
    `Daily target: ${project.requiredDailyOutput ?? "see workbook"} ${unit}`,
    `Feasibility: ${project.feasibilityStatus ?? "not classified"}`,
    `Capacity utilization: ${project.utilizationPercent ?? "see workbook"}%`,
  ];

  if (mainRisk) {
    lines.push(`Main risk: ${mainRisk}`);
  }

  lines.push(
    "Workbook attached with schedule, stages, tasks, capacity, KPIs, charts, and risks.",
  );
  return lines.join("\n");
}
