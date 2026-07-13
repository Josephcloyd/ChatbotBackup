import { generateWithOllama, parseOllamaJson } from "./ollamaService.js";
import { savePlan, uploadWorkbookAndCreateSignedUrl } from "./supabaseService.js";
import { excelService } from "./services/excelService.js";
import { templateService } from "./services/templateService.js";
import { validationService } from "./services/validationService.js";
import { planRulesService } from "./services/planRulesService.js";
import {
  buildDynamicPlan,
  buildDynamicPrompt,
  validateDynamicProposal,
} from "./services/dynamicPlanService.js";
import { dynamicExcelService } from "./services/dynamicExcelService.js";
import {
  buildProductionPrompt,
  buildWhatsAppSummary,
  type ProductionPlanInput,
  type ProductionPlanOutput,
} from "./productionPrompt.js";
import { extractRequestedConstraints } from "./services/planningConstraintsService.js";

export interface PlannerResult {
  success: boolean;
  planId?: string;
  whatsappSummary: string;
  plan?: ProductionPlanOutput;
  workbookPath?: string;
  workbookSignedUrl?: string;
  workbookStoragePath?: string;
  workbookSignedUrlExpiresInSeconds?: number;
  dateInterpretations?: string[];
  error?: string;
}

function buildFriendlyFailure(errorMessage: string): string {
  if (/date|YYYY-MM-DD|start date|end date/i.test(errorMessage)) {
    return "I understood your request, but I could not validate the planning date. Please use a clearer date like 2026-07-13, or say \"next Monday\".";
  }
  if (/hours|teamSize|duration|greater than zero|whole number/i.test(errorMessage)) {
    return "I understood your request, but the planning numbers did not validate. Please include a positive duration, team/resource count, and total hours.";
  }
  return "I understood your request, but I could not generate a valid production plan. Please try adding a clearer duration, team size, total hours, and start date.";
}

export async function generateProductionPlan(
  input: ProductionPlanInput,
): Promise<PlannerResult> {
  const mode = input.workbookMode ?? "template";
  console.log("\n========== PLAN GENERATION STARTED ==========");
  console.log("whatsappUserId:", input.whatsappUserId);
  console.log("projectDescription:", input.projectDescription);
  console.log("workbookMode:", mode);

  try {
    const currentDate = new Date().toISOString().slice(0, 10);
    const requestedConstraints = extractRequestedConstraints(input.projectDescription, currentDate);
    const dateInterpretations = (requestedConstraints.dateInterpretations ?? []).map(
      (item) => `I interpreted "${item.source}" as ${item.normalized}.`,
    );
    const templateDefinition = mode === "template"
      ? await templateService.loadDefinition()
      : undefined;
    const prompt = mode === "dynamic"
      ? buildDynamicPrompt(input.projectDescription, currentDate)
      : buildProductionPrompt(input, templateDefinition!, currentDate);

    console.log("[plannerService] Calling Ollama...");
    const rawResponse = await generateWithOllama(prompt);
    console.log("[plannerService] Raw response length:", rawResponse.length);

    let parsedResponse: unknown;
    try {
      parsedResponse = parseOllamaJson<unknown>(rawResponse);
    } catch (parseError) {
      console.error("[plannerService] JSON parse failed:", parseError);
      console.error("[plannerService] Raw response was:", rawResponse.slice(0, 500));
      throw new Error(`Ollama returned invalid JSON: ${(parseError as Error).message}`);
    }

    let plan: ProductionPlanOutput;
    let workbookPath: string;
    if (mode === "dynamic") {
      const proposal = validateDynamicProposal(parsedResponse, currentDate);
      const dynamicResult = buildDynamicPlan(input, proposal, currentDate);
      plan = planRulesService.validate(dynamicResult.plan, { currentDate, input });
      workbookPath = await dynamicExcelService.writeDynamicProductionPlan(dynamicResult);
    } else {
      const structurallyValidPlan = validationService.validateProductionPlan(
        parsedResponse,
        templateDefinition!,
      );
      plan = planRulesService.validate(structurallyValidPlan, { currentDate, input });
      workbookPath = await excelService.writeProductionPlan(plan, templateDefinition!);
    }

    console.log("[plannerService] Plan validated successfully:", plan.project.projectName);
    console.log("[plannerService] Workbook written:", workbookPath);

    let planId: string | undefined;
    let workbookSignedUrl: string | undefined;
    let workbookStoragePath: string | undefined;
    let workbookSignedUrlExpiresInSeconds: number | undefined;

    try {
      const uploadResult = await uploadWorkbookAndCreateSignedUrl(
        workbookPath,
        input.whatsappUserId,
      );

      if (uploadResult) {
        workbookSignedUrl = uploadResult.signedUrl;
        workbookStoragePath = uploadResult.objectPath;
        workbookSignedUrlExpiresInSeconds = uploadResult.expiresInSeconds;
        console.log("[plannerService] Workbook uploaded to Supabase Storage:", workbookStoragePath);
      }
    } catch (storageError) {
      console.error(
        "[plannerService] Supabase workbook upload failed (non-fatal):",
        (storageError as Error).message,
      );
    }
    try {
      const savedRecord = await savePlan(
        input.whatsappUserId,
        input.projectDescription,
        plan,
      );
      planId = savedRecord.id;
      console.log("[plannerService] Saved to Supabase, ID:", planId);
    } catch (dbError) {
      console.error(
        "[plannerService] Supabase save failed (non-fatal):",
        (dbError as Error).message,
      );
    }

    const whatsappSummary = buildWhatsAppSummary(plan);
    console.log("========== PLAN GENERATION COMPLETE ==========\n");
    return { success: true, planId, whatsappSummary, plan, workbookPath, workbookSignedUrl, workbookStoragePath, workbookSignedUrlExpiresInSeconds, dateInterpretations };
  } catch (error) {
    const errorMessage = (error as Error).message;
    console.error("[plannerService] FAILED:", errorMessage);
    return {
      success: false,
      error: errorMessage,
      whatsappSummary: `${buildFriendlyFailure(errorMessage)}\n\nPlease revise the request and try again.`,
    };
  }
}

