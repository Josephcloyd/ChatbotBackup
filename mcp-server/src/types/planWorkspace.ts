import { z } from "zod";

export const planConversationIntentValues = [
  "explain_plan",
  "explain_calculation",
  "report_mistake",
  "clarify_requirement",
  "request_modification",
  "request_regeneration",
  "compare_revisions",
  "restore_revision",
  "unrelated_request",
] as const;

export const planMessageTypeValues = [
  "user",
  "assistant",
  "clarification",
  "proposal",
  "validation",
  "system",
] as const;

export const planRevisionSourceValues = [
  "initial_generation",
  "user_modification",
  "admin_edit",
  "revision_restore",
] as const;

export const planChangeProposalSchema = z.object({
  id: z.string().trim().min(1),
  planId: z.string().trim().min(1),
  basedOnRevisionId: z.string().trim().min(1),
  requestSummary: z.string().trim().min(1).max(2_000),
  interpretedRequest: z.string().trim().min(1).max(4_000),
  reasonForChange: z.string().trim().min(1).max(4_000),
  affectedSections: z.array(z.string().trim().min(1)).max(30),
  changes: z
    .array(
      z.object({
        field: z.string().trim().min(1).max(120),
        label: z.string().trim().min(1).max(160),
        previousValue: z.unknown(),
        proposedValue: z.unknown(),
        reason: z.string().trim().min(1).max(1_000),
        impact: z.string().trim().max(1_000).optional(),
      }),
    )
    .min(1)
    .max(30),
  recalculatedMetrics: z
    .object({
      previousWorkerCount: z.number().optional(),
      proposedWorkerCount: z.number().optional(),
      previousTotalHours: z.number().optional(),
      proposedTotalHours: z.number().optional(),
      previousDuration: z.number().optional(),
      proposedDuration: z.number().optional(),
      previousDailyTarget: z.number().optional(),
      proposedDailyTarget: z.number().optional(),
      previousTotalTarget: z.number().optional(),
      proposedTotalTarget: z.number().optional(),
    })
    .optional(),
  warnings: z.array(z.string().trim().min(1)).max(20).default([]),
  clarificationQuestions: z.array(z.string().trim().min(1)).max(10).default([]),
  requiresConfirmation: z.boolean(),
});

export const planAssistantResponseSchema = z.object({
  intent: z.enum(planConversationIntentValues),
  message: z.string().trim().min(1).max(8_000),
  explanation: z
    .object({
      summary: z.string().trim().min(1).max(4_000),
      formulas: z
        .array(
          z.object({
            label: z.string().trim().min(1).max(160),
            expression: z.string().trim().min(1).max(1_000),
            result: z.string().trim().min(1).max(1_000),
          }),
        )
        .max(20)
        .optional(),
      assumptions: z
        .array(z.string().trim().min(1).max(1_000))
        .max(20)
        .optional(),
    })
    .optional(),
  clarificationQuestions: z
    .array(z.string().trim().min(1).max(1_000))
    .max(10)
    .optional(),
  proposal: planChangeProposalSchema.optional(),
  requiresConfirmation: z.boolean(),
  canApply: z.boolean(),
  warnings: z.array(z.string().trim().min(1).max(1_000)).max(20).optional(),
});

export type PlanConversationIntent =
  (typeof planConversationIntentValues)[number];
export type PlanMessageType = (typeof planMessageTypeValues)[number];
export type PlanRevisionSource = (typeof planRevisionSourceValues)[number];
export type PlanChangeProposal = z.infer<typeof planChangeProposalSchema>;
export type PlanAssistantResponse = z.infer<typeof planAssistantResponseSchema>;

export interface PlanConversationMessage {
  id: string;
  plan_id: string;
  revision_id?: string | null;
  user_id?: string | null;
  role: "user" | "assistant" | "system";
  message_type: PlanMessageType;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface PlanRevision {
  id: string;
  plan_id: string;
  revision_number: number;
  parent_revision_id?: string | null;
  created_by?: string | null;
  created_by_role: "operator" | "admin" | "system";
  revision_source: PlanRevisionSource;
  user_instruction?: string | null;
  change_summary: string;
  plan_data: Record<string, unknown>;
  validation_result?: Record<string, unknown> | null;
  workbook_mode: "dynamic" | "template";
  workbook_filename?: string | null;
  workbook_storage_path?: string | null;
  workbook_signed_url?: string | null;
  created_at: string;
}

export interface StoredPlanChangeProposal {
  id: string;
  plan_id: string;
  based_on_revision_id: string;
  request_summary: string;
  proposal: PlanChangeProposal;
  status: "pending" | "applied" | "cancelled";
  created_by?: string | null;
  applied_revision_id?: string | null;
  created_at: string;
  updated_at: string;
}
