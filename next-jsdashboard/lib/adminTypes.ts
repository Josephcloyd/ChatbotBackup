export type CellValue = string | number | boolean | null;
export type PlanRow = Record<string, CellValue>;
export interface PlanColumnDefinition {
  key: string;
  label: string;
  semantic: string;
  dataType: "text" | "integer" | "decimal" | "date" | "percentage";
  editable: boolean;
  role?: string;
}

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
  workbook: {
    sheets: Array<{
      sheetName: string;
      columns?: string[];
      columnDefinitions?: PlanColumnDefinition[];
      rows: PlanRow[];
    }>;
  };
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

export type UserAccountStatus = "pending" | "active" | "inactive";

export interface OperatorAccount {
  id: string;
  username: string;
  email?: string;
  displayName?: string;
  role: FrontendRole;
  databaseRole?: "admin" | "user";
  active?: boolean;
  status?: UserAccountStatus;
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
