import { generateWithOllama, parseOllamaJson } from "./ollamaService.js";
import {
  completeGenerationRun,
  createGenerationRun,
  recordPlanFile,
  savePlan,
  uploadWorkbookAndCreateSignedUrl,
} from "./supabaseService.js";
import { config } from "./config.js";
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
  const mode = input.workbookMode ?? "dynamic";
  const startedAt = Date.now();
  let runId: string | null = null;
  console.log("\n========== PLAN GENERATION STARTED ==========");
  console.log("whatsappUserId:", input.whatsappUserId);
  console.log("projectDescription:", input.projectDescription);
  console.log("workbookMode:", mode);

  try {
    runId = await createGenerationRun({
      modelProvider: "ollama",
      modelName: config.ollamaModel,
      promptVersion: mode === "dynamic" ? "dynamic-v1" : "template-v1",
      attemptNumber: 1,
    });

    const currentDate = new Date().toISOString().slice(0, 10);
    const requestedConstraints = extractRequestedConstraints(input.projectDescription, currentDate);
    const dateInterpretations = (requestedConstraints.dateInterpretations ?? []).map(
      (item) => `I interpreted "${item.source}" as ${item.normalized}.`,
    );

    // Mixed-metric prompt: both hours and a quantity unit detected — ask the user to clarify.
    if (requestedConstraints.totalHours !== undefined && requestedConstraints.totalQuantity !== undefined) {
      const unit = requestedConstraints.unitOfMeasure ?? "items";
      const qty = requestedConstraints.totalQuantity.toLocaleString();
      const hrs = requestedConstraints.totalHours;
      return {
        success: false,
        error: "Please clarify your request.",
        whatsappSummary:
          `Your request mentions both *${hrs} hours* and *${qty} ${unit}*.\n\n` +
          `Please clarify which metric the plan should track:\n` +
          `• To track *${unit}*: remove the hours from your request.\n` +
          `• To track *hours*: remove the quantity from your request.\n\n` +
          `Example: _"Image collection, 350,000 images, 6 months, April 3 2026"_`,
        dateInterpretations,
      };
    }
    const templateDefinition = mode === "template"
      ? await templateService.loadDefinition(input.selectedTemplate)
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

    if (!plan.summary || !plan.summary.trim()) {
      const scopeDesc = plan.project.totalAssets > 0 ? `${plan.project.totalAssets.toLocaleString()} units` : "production targets";
      plan.summary = `${plan.project.projectDescription || "Production plan"} for ${plan.project.projectName || "requested project"}. Scheduled from ${plan.project.startDate} to ${plan.project.deadline} covering ${scopeDesc}.`;
    }

    console.log("[plannerService] Plan validated successfully:", plan.project.projectName);
    console.log("[plannerService] Workbook written:", workbookPath);

    let planId: string | undefined;
    let workbookSignedUrl: string | undefined;
    let workbookStoragePath: string | undefined;
    let workbookSignedUrlExpiresInSeconds: number | undefined;
    let uploadResult: Awaited<ReturnType<typeof uploadWorkbookAndCreateSignedUrl>> = null;

    try {
      uploadResult = await uploadWorkbookAndCreateSignedUrl(
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
        {
          workbookMode: mode === "template" ? "official_template" : "dynamic",
          generationSource: input.generationSource ?? "whatsapp",
          requestedBy: input.whatsappUserId,
        },
      );
      planId = savedRecord.id;
      if (planId && uploadResult) {
        await recordPlanFile(planId, uploadResult, input.whatsappUserId);
      }
      await completeGenerationRun(runId, {
        status: "completed",
        plan_id: planId ?? null,
        project_title: plan.project.projectName,
        duration_ms: Date.now() - startedAt,
        validation_error_count: 0,
      });
      console.log("[plannerService] Saved to Supabase, ID:", planId);
    } catch (dbError) {
      console.error(
        "[plannerService] Supabase save failed (non-fatal):",
        (dbError as Error).message,
      );
      await completeGenerationRun(runId, {
        status: "completed",
        plan_id: null,
        project_title: plan.project.projectName,
        duration_ms: Date.now() - startedAt,
        validation_error_count: 0,
      });
    }

    const whatsappSummary = buildWhatsAppSummary(plan);
    console.log("========== PLAN GENERATION COMPLETE ==========\n");
    return { success: true, planId, whatsappSummary, plan, workbookPath, workbookSignedUrl, workbookStoragePath, workbookSignedUrlExpiresInSeconds, dateInterpretations };
  } catch (error) {
    const errorMessage = (error as Error).message;
    console.error("[plannerService] FAILED:", errorMessage);
    await completeGenerationRun(runId, {
      status: "failed",
      plan_id: null,
      duration_ms: Date.now() - startedAt,
      validation_error_count: 1,
      validation_errors: [errorMessage],
      error_message: errorMessage.slice(0, 500),
    });
    return {
      success: false,
      error: errorMessage,
      whatsappSummary: `${buildFriendlyFailure(errorMessage)}\n\nPlease revise the request and try again.`,
    };
  }
}

