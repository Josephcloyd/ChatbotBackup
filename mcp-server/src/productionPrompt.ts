import type { TemplateWorkbookDefinition } from "./services/templateService.js";
import { promptService } from "./services/promptService.js";
import type { ProductionPlan, ProductionPlanInput } from "./types/productionPlan.js";

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
  const sheetLines = plan.workbook.sheets
    .map((sheet) => `- ${sheet.sheetName}: ${sheet.rows.length} rows`)
    .join("\n");

  return `Production plan ready

${plan.project.projectName || "Production Plan"}

${plan.summary}

Workbook sheets:
${sheetLines}`;
}
