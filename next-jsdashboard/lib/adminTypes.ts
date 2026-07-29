export type CellValue = string | number | boolean | null;
export type PlanRow = Record<string, CellValue>;

export type PlanStatus =
  | "draft"
  | "generating"
  | "generated"
  | "under_review"
  | "approved"
  | "rejected"
  | "archived"
  | "failed";

export type PlanPriority = "low" | "normal" | "high" | "urgent";
export type GenerationSource = "whatsapp" | "dashboard" | "api" | "admin";
export type WorkbookMode = "official_template" | "dynamic";
export type FrontendRole = "admin" | "operator";

export interface ProductionPlan {
  project: {
    projectName: string;
    projectDescription: string;
    client: string;
    startDate: string;
    deadline: string;
    assumptions: string[];
  };
  workbook: { sheets: Array<{ sheetName: string; rows: PlanRow[] }> };
  summary: string;
}

export interface HistoryRecord {
  id: string;
  whatsapp_user_id: string;
  project_description?: string;
  project_title: string;
  summary: string;
  total_hours_estimate: number;
  recommended_team_size: number;
  created_at: string;
  updated_at?: string;
  raw_plan: ProductionPlan;
  status?: PlanStatus;
  requested_by?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  rejection_reason?: string | null;
  archived_at?: string | null;
  planning_start_date?: string | null;
  planning_end_date?: string | null;
  actual_start_date?: string | null;
  actual_end_date?: string | null;
  actual_hours?: number | null;
  requested_team_size?: number | null;
  progress_percentage?: number;
  priority?: PlanPriority;
  workbook_mode?: WorkbookMode;
  generation_source?: GenerationSource;
  key_risks?: string[] | unknown;
  next_steps?: string[] | unknown;
}

export interface HistoryResponse {
  configured: boolean;
  plans: HistoryRecord[];
  error?: string;
}

export interface OperatorAccount {
  id: string;
  username: string;
  role: FrontendRole;
  databaseRole?: "admin" | "user";
  active?: boolean;
  createdAt: string;
  updatedAt?: string;
  planCount?: number;
}

export interface PlanFileRecord {
  id: string;
  plan_id: string;
  file_name: string;
  file_type: string;
  version: number;
  file_size: number | null;
  storage_bucket: string;
  storage_path: string;
  created_at: string;
  created_by: string | null;
}

export interface PlanGenerationRun {
  id: string;
  plan_id: string | null;
  project_title: string | null;
  model_provider: string | null;
  model_name: string | null;
  prompt_version: string | null;
  status: string;
  attempt_number: number | null;
  duration_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  validation_error_count: number | null;
  validation_errors: unknown;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export type PlanConversationIntent =
  | "explain_plan"
  | "explain_calculation"
  | "report_mistake"
  | "clarify_requirement"
  | "request_modification"
  | "request_regeneration"
  | "compare_revisions"
  | "restore_revision"
  | "unrelated_request";

export type PlanMessageType =
  | "user"
  | "assistant"
  | "clarification"
  | "proposal"
  | "validation"
  | "system";

export interface PlanChangeProposal {
  id: string;
  planId: string;
  basedOnRevisionId: string;
  requestSummary: string;
  interpretedRequest: string;
  reasonForChange: string;
  affectedSections: string[];
  changes: Array<{
    field: string;
    label: string;
    previousValue: unknown;
    proposedValue: unknown;
    reason: string;
    impact?: string;
  }>;
  recalculatedMetrics?: {
    previousWorkerCount?: number;
    proposedWorkerCount?: number;
    previousTotalHours?: number;
    proposedTotalHours?: number;
    previousDuration?: number;
    proposedDuration?: number;
    previousDailyTarget?: number;
    proposedDailyTarget?: number;
    previousTotalTarget?: number;
    proposedTotalTarget?: number;
  };
  warnings: string[];
  clarificationQuestions: string[];
  requiresConfirmation: boolean;
}

export interface PlanAssistantResponse {
  intent: PlanConversationIntent;
  message: string;
  explanation?: {
    summary: string;
    formulas?: Array<{ label: string; expression: string; result: string }>;
    assumptions?: string[];
  };
  clarificationQuestions?: string[];
  proposal?: PlanChangeProposal;
  requiresConfirmation: boolean;
  canApply: boolean;
  warnings?: string[];
}

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
  revision_source: "initial_generation" | "user_modification" | "admin_edit" | "revision_restore";
  user_instruction?: string | null;
  change_summary: string;
  plan_data: ProductionPlan;
  validation_result?: Record<string, unknown> | null;
  workbook_mode: "dynamic" | "template";
  workbook_filename?: string | null;
  workbook_storage_path?: string | null;
  workbook_signed_url?: string | null;
  created_at: string;
}

export interface PlanWorkspaceResponse {
  success: boolean;
  configured: boolean;
  plan: HistoryRecord;
  currentRevision: PlanRevision;
  currentPlanData: ProductionPlan;
  conversation: PlanConversationMessage[];
  revisions: PlanRevision[];
  workbookFiles: PlanFileRecord[];
  permissions: {
    canMessage: boolean;
    canApplyProposal: boolean;
    canRestoreRevision: boolean;
    canDeleteRevision?: boolean;
    canDownloadWorkbook: boolean;
    role: FrontendRole;
  };
  error?: string;
}
