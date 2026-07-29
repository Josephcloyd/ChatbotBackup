/**
 * supabaseService.ts
 *
 * Handles all Supabase operations for the production planner.
 * Uses the @supabase/supabase-js client with the service role key
 * so it can write to any table without RLS restrictions.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ProductionPlanOutput } from "./productionPrompt.js";
import type {
  PlanChangeProposal,
  PlanConversationMessage,
  PlanMessageType,
  PlanRevision,
  PlanRevisionSource,
  StoredPlanChangeProposal,
} from "./types/planWorkspace.js";

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface PlanRecord {
  id?: string;
  whatsapp_user_id: string;
  project_description: string;
  project_title: string;
  summary: string;
  phases: Array<{ name: string; rowCount: number }>;
  total_hours_estimate: number;
  recommended_team_size: number;
  key_risks: string[];
  next_steps: string[];
  raw_plan: ProductionPlanOutput;
  created_at?: string;
  updated_at?: string;
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
export type WorkbookMode = "official_template" | "dynamic";
export type GenerationSource = "whatsapp" | "dashboard" | "api" | "admin";

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

export interface PlanGenerationRunRecord {
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

export interface CreatePlanRevisionInput {
  planId: string;
  revisionNumber: number;
  parentRevisionId?: string | null;
  createdBy?: string | null;
  createdByRole: "operator" | "admin" | "system";
  revisionSource: PlanRevisionSource;
  userInstruction?: string | null;
  changeSummary: string;
  planData: ProductionPlanOutput | Record<string, unknown>;
  validationResult?: Record<string, unknown> | null;
  workbookMode: "dynamic" | "template";
  workbookFilename?: string | null;
  workbookStoragePath?: string | null;
  workbookSignedUrl?: string | null;
}

export interface CreateConversationMessageInput {
  planId: string;
  revisionId?: string | null;
  userId?: string | null;
  role: "user" | "assistant" | "system";
  messageType: PlanMessageType;
  content: string;
  metadata?: Record<string, unknown>;
}

interface BuildPlanRecordOptions {
  workbookMode?: WorkbookMode;
  generationSource?: GenerationSource;
  requestedBy?: string | null;
  priority?: PlanPriority;
}

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildPlanRecord(
  whatsappUserId: string,
  projectDescription: string,
  plan: ProductionPlanOutput,
  options: BuildPlanRecordOptions = {},
): PlanRecord {
  const productionRows = plan.workbook.sheets.find(
    (sheet) => sheet.sheetName === "Production Plan",
  )?.rows ?? [];
  const startDate = plan.project.startDate || null;
  const endDate = plan.project.deadline || null;
  const recommendedTeamSize = productionRows.reduce(
    (largest, row) => Math.max(largest, numberValue(row["Target Active Annotators"])),
    0,
  );

  return {
    whatsapp_user_id: whatsappUserId,
    project_description: projectDescription,
    project_title: plan.project.projectName,
    summary: plan.summary,
    phases: plan.workbook.sheets.map((sheet) => ({
      name: sheet.sheetName,
      rowCount: sheet.rows.length,
    })),
    total_hours_estimate: productionRows.reduce(
      (total, row) => total + numberValue(row["Target Total Hours"]),
      0,
    ),
    recommended_team_size: recommendedTeamSize,
    key_risks: plan.project.assumptions,
    next_steps: [],
    raw_plan: plan,
    updated_at: new Date().toISOString(),
    status: "generated",
    requested_by: options.requestedBy ?? whatsappUserId,
    planning_start_date: startDate,
    planning_end_date: endDate,
    requested_team_size: recommendedTeamSize || null,
    progress_percentage: 0,
    priority: options.priority ?? "normal",
    workbook_mode: options.workbookMode ?? "dynamic",
    generation_source: options.generationSource ?? "whatsapp",
  };
}

// ——— Supabase client (lazy singleton) ———————————————————————————————————————————

let _client: SupabaseClient | null = null;

export function getClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables. " +
        "Copy .env.example to .env and fill in your Supabase credentials."
    );
  }

  _client = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  console.log("[supabaseService] Supabase client initialized");
  return _client;
}

export function createServiceRoleClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables."
    );
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Save a production plan to the `production_plans` table.
 * Returns the inserted record including its generated ID.
 */
export async function savePlan(
  whatsappUserId: string,
  projectDescription: string,
  plan: ProductionPlanOutput,
  options: BuildPlanRecordOptions = {},
): Promise<PlanRecord> {
  const supabase = getClient();

  const record = buildPlanRecord(whatsappUserId, projectDescription, plan, options);

  console.log(`[supabaseService] Saving plan for user: ${whatsappUserId}`);

  const { data, error } = await supabase
    .from("production_plans")
    .insert(record)
    .select()
    .single();

  if (error) {
    try {
      const fs = await import("node:fs");
      fs.appendFileSync("c:/Users/User/Documents/College Files/Software Development 2/Github/ChatbotBackup/mcp-server/debug_save_error.log", `[${new Date().toISOString()}] ERROR: ${error.message} (${error.code})\nRecord: ${JSON.stringify(record, null, 2)}\n\n`);
    } catch (e) {}
    throw new Error(`Supabase insert failed: ${error.message} (${error.code})`);
  }

  console.log(`[supabaseService] Plan saved with ID: ${data.id}`);
  return data as PlanRecord;
}

/**
 * Fetch the most recent plan for a given WhatsApp user.
 */
export async function getLatestPlan(
  whatsappUserId: string
): Promise<PlanRecord | null> {
  const supabase = getClient();

  const { data, error } = await supabase
    .from("production_plans")
    .select("*")
    .eq("whatsapp_user_id", whatsappUserId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase query failed: ${error.message}`);
  }

  return data as PlanRecord | null;
}

export async function getRecentPlans(
  whatsappUserId?: string,
  requestedLimit = 15,
  offset = 0,
): Promise<PlanRecord[]> {
  const supabase = getClient();
  const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), 50);
  const safeOffset = Math.max(Math.trunc(offset), 0);
  let query = supabase
    .from("production_plans")
    .select("*")
    .order("created_at", { ascending: false })
    .range(safeOffset, safeOffset + limit - 1);

  if (whatsappUserId) query = query.eq("whatsapp_user_id", whatsappUserId);
  const { data, error } = await query;
  if (error) throw new Error(`Supabase query failed: ${error.message}`);
  return (data ?? []) as PlanRecord[];
}

function getWorkbookBucket(): string | null {
  const bucket = process.env.SUPABASE_WORKBOOK_BUCKET?.trim();
  return bucket || null;
}

function getSignedUrlExpiresInSeconds(): number {
  const rawValue = process.env.SUPABASE_SIGNED_URL_EXPIRES_IN_SECONDS;
  const parsed = Number(rawValue ?? 3600);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 3600;
  }

  return Math.trunc(parsed);
}

function safeStorageSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "workspace";
}

export interface WorkbookUploadResult {
  bucket: string;
  objectPath: string;
  filename: string;
  fileSize: number;
  signedUrl: string;
  expiresInSeconds: number;
}

export async function uploadWorkbookAndCreateSignedUrl(
  workbookPath: string,
  whatsappUserId: string,
): Promise<WorkbookUploadResult | null> {
  const bucket = getWorkbookBucket();

  if (!bucket) {
    return null;
  }

  const supabase = getClient();
  const expiresInSeconds = getSignedUrlExpiresInSeconds();
  const filename = path.basename(workbookPath);
  const workspace = safeStorageSegment(whatsappUserId);
  const objectPath = `${workspace}/${Date.now()}-${filename}`;
  const fileBuffer = await readFile(workbookPath);

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(objectPath, fileBuffer, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Supabase workbook upload failed: ${uploadError.message}`);
  }

  const { data, error: signedUrlError } = await supabase.storage
    .from(bucket)
    .createSignedUrl(objectPath, expiresInSeconds, {
      download: filename,
    });

  if (signedUrlError || !data?.signedUrl) {
    throw new Error(
      `Supabase signed URL creation failed: ${signedUrlError?.message ?? "No signed URL returned"}`,
    );
  }

  return {
    bucket,
    objectPath,
    filename,
    fileSize: fileBuffer.byteLength,
    signedUrl: data.signedUrl,
    expiresInSeconds,
  };
}

export async function getPlanById(planId: string): Promise<PlanRecord | null> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("production_plans")
    .select("*")
    .eq("id", planId)
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase query failed: ${error.message}`);
  }

  return data as PlanRecord | null;
}

export async function updatePlanFromRevision(
  planId: string,
  projectDescription: string,
  plan: ProductionPlanOutput,
  options: BuildPlanRecordOptions = {},
): Promise<PlanRecord> {
  const supabase = getClient();
  const nextRecord = buildPlanRecord(
    options.requestedBy ?? "",
    projectDescription,
    plan,
    options,
  );
  const updates: Partial<PlanRecord> = {
    project_description: projectDescription,
    project_title: nextRecord.project_title,
    summary: nextRecord.summary,
    phases: nextRecord.phases,
    total_hours_estimate: nextRecord.total_hours_estimate,
    recommended_team_size: nextRecord.recommended_team_size,
    key_risks: nextRecord.key_risks,
    next_steps: nextRecord.next_steps,
    raw_plan: plan,
    updated_at: new Date().toISOString(),
    status: "generated",
    planning_start_date: nextRecord.planning_start_date,
    planning_end_date: nextRecord.planning_end_date,
    requested_team_size: nextRecord.requested_team_size,
    workbook_mode: options.workbookMode ?? nextRecord.workbook_mode,
    generation_source: options.generationSource ?? nextRecord.generation_source,
  };

  const { data, error } = await supabase
    .from("production_plans")
    .update(updates)
    .eq("id", planId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update plan ${planId} from revision: ${error.message}`);
  }

  return data as PlanRecord;
}

export async function deletePlan(planId: string): Promise<void> {
  const supabase = getClient();
  const { data: files, error: filesError } = await supabase
    .from("plan_files")
    .select("storage_bucket, storage_path")
    .eq("plan_id", planId);

  if (!filesError) {
    const filesByBucket = new Map<string, string[]>();
    for (const file of files ?? []) {
      const bucket = String(file.storage_bucket ?? "");
      const objectPath = String(file.storage_path ?? "");
      if (!bucket || !objectPath) continue;
      filesByBucket.set(bucket, [...(filesByBucket.get(bucket) ?? []), objectPath]);
    }
    for (const [bucket, paths] of filesByBucket.entries()) {
      if (paths.length === 0) continue;
      const { error: removeError } = await supabase.storage.from(bucket).remove(paths);
      if (removeError) {
        throw new Error(`Failed to delete workbook files for plan ${planId}: ${removeError.message}`);
      }
    }
  } else {
    console.warn("[supabaseService] Could not inspect plan_files before deleting plan:", filesError.message);
  }

  const { error } = await supabase
    .from("production_plans")
    .delete()
    .eq("id", planId);

  if (error) {
    throw new Error(`Failed to delete plan ${planId} from Supabase: ${error.message}`);
  }
}

const editablePlanFields = new Set([
  "project_title",
  "summary",
  "priority",
  "progress_percentage",
  "planning_start_date",
  "planning_end_date",
  "actual_start_date",
  "actual_end_date",
  "actual_hours",
  "requested_team_size",
]);

function normalizeNullableDate(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("Date fields must be strings or null.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Date fields must use YYYY-MM-DD.");
  return value;
}

function normalizeNonNegativeNumber(value: unknown, fieldName: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${fieldName} must be a non-negative number.`);
  }
  return parsed;
}

export function sanitizePlanUpdates(input: Record<string, unknown>): Partial<PlanRecord> {
  const updates: Partial<PlanRecord> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!editablePlanFields.has(key)) continue;
    if (key === "project_title" || key === "summary") {
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${key} is required.`);
      }
      (updates as Record<string, unknown>)[key] = value.trim();
    } else if (key === "priority") {
      if (!["low", "normal", "high", "urgent"].includes(String(value))) {
        throw new Error("priority must be low, normal, high, or urgent.");
      }
      updates.priority = value as PlanPriority;
    } else if (key === "progress_percentage") {
      const parsed = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        throw new Error("progress_percentage must be between 0 and 100.");
      }
      updates.progress_percentage = parsed;
    } else if (
      key === "planning_start_date" ||
      key === "planning_end_date" ||
      key === "actual_start_date" ||
      key === "actual_end_date"
    ) {
      (updates as Record<string, unknown>)[key] = normalizeNullableDate(value);
    } else if (key === "actual_hours" || key === "requested_team_size") {
      (updates as Record<string, unknown>)[key] = normalizeNonNegativeNumber(value, key);
    }
  }

  if (
    updates.planning_start_date &&
    updates.planning_end_date &&
    updates.planning_end_date < updates.planning_start_date
  ) {
    throw new Error("Planning end date cannot be earlier than planning start date.");
  }
  if (
    updates.actual_start_date &&
    updates.actual_end_date &&
    updates.actual_end_date < updates.actual_start_date
  ) {
    throw new Error("Actual end date cannot be earlier than actual start date.");
  }

  updates.updated_at = new Date().toISOString();
  return updates;
}

export async function updatePlan(planId: string, updates: Record<string, unknown>): Promise<PlanRecord> {
  const sanitizedUpdates = sanitizePlanUpdates(updates);
  const supabase = getClient();
  const { data, error } = await supabase
    .from("production_plans")
    .update(sanitizedUpdates)
    .eq("id", planId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update plan ${planId} in Supabase: ${error.message}`);
  }

  return data as PlanRecord;
}

export type ReviewAction = "under_review" | "approve" | "reject" | "archive" | "restore" | "generated" | "failed";

export async function updatePlanReviewStatus(
  planId: string,
  action: ReviewAction,
  adminId: string,
  rejectionReason?: string,
): Promise<PlanRecord> {
  const now = new Date().toISOString();
  const updates: Partial<PlanRecord> = { updated_at: now };

  if (action === "under_review") {
    updates.status = "under_review";
  } else if (action === "approve") {
    updates.status = "approved";
    updates.reviewed_by = adminId;
    updates.reviewed_at = now;
    updates.rejection_reason = null;
  } else if (action === "reject") {
    if (!rejectionReason?.trim()) throw new Error("Rejection reason is required.");
    updates.status = "rejected";
    updates.reviewed_by = adminId;
    updates.reviewed_at = now;
    updates.rejection_reason = rejectionReason.trim();
  } else if (action === "archive") {
    updates.status = "archived";
    updates.archived_at = now;
  } else if (action === "restore") {
    updates.status = "generated";
    updates.archived_at = null;
  } else if (action === "generated") {
    updates.status = "generated";
    updates.archived_at = null;
    updates.rejection_reason = null;
  } else if (action === "failed") {
    updates.status = "failed";
  }

  const supabase = getClient();
  const { data, error } = await supabase
    .from("production_plans")
    .update(updates)
    .eq("id", planId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update plan status ${planId} in Supabase: ${error.message}`);
  }

  return data as PlanRecord;
}

export async function reassignPlans(fromUsername: string, toUsername: string): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase
    .from("production_plans")
    .update({ whatsapp_user_id: toUsername })
    .eq("whatsapp_user_id", fromUsername);

  if (error) {
    throw new Error(`Failed to reassign plans from ${fromUsername} to ${toUsername}: ${error.message}`);
  }
}

export async function countPlansForUser(username: string): Promise<number> {
  if (!username) return 0;
  const supabase = getClient();
  const { count, error } = await supabase
    .from("production_plans")
    .select("id", { count: "exact", head: true })
    .eq("whatsapp_user_id", username);

  if (error) throw new Error(`Failed to count plans for ${username}: ${error.message}`);
  return count ?? 0;
}

export async function listPlanFiles(planId: string): Promise<PlanFileRecord[]> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("plan_files")
    .select("*")
    .eq("plan_id", planId)
    .order("version", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to list plan files: ${error.message}`);
  return (data ?? []) as PlanFileRecord[];
}

export async function listPlanRevisions(planId: string): Promise<PlanRevision[]> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("plan_revisions")
    .select("*")
    .eq("plan_id", planId)
    .order("revision_number", { ascending: true });

  if (error) throw new Error(`Failed to list plan revisions: ${error.message}`);
  return (data ?? []) as PlanRevision[];
}

export async function getLatestPlanRevision(planId: string): Promise<PlanRevision | null> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("plan_revisions")
    .select("*")
    .eq("plan_id", planId)
    .order("revision_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to load current plan revision: ${error.message}`);
  return data as PlanRevision | null;
}

export async function getPlanRevision(planId: string, revisionId: string): Promise<PlanRevision | null> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("plan_revisions")
    .select("*")
    .eq("plan_id", planId)
    .eq("id", revisionId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load plan revision: ${error.message}`);
  return data as PlanRevision | null;
}

export async function deletePlanRevision(planId: string, revisionId: string): Promise<void> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("plan_revisions")
    .delete()
    .eq("plan_id", planId)
    .eq("id", revisionId)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`Failed to delete plan revision: ${error.message}`);
  if (!data) throw new Error("Revision not found.");
}

export async function createPlanRevision(input: CreatePlanRevisionInput): Promise<PlanRevision> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("plan_revisions")
    .insert({
      plan_id: input.planId,
      revision_number: input.revisionNumber,
      parent_revision_id: input.parentRevisionId ?? null,
      created_by: input.createdBy ?? null,
      created_by_role: input.createdByRole,
      revision_source: input.revisionSource,
      user_instruction: input.userInstruction ?? null,
      change_summary: input.changeSummary,
      plan_data: input.planData,
      validation_result: input.validationResult ?? null,
      workbook_mode: input.workbookMode,
      workbook_filename: input.workbookFilename ?? null,
      workbook_storage_path: input.workbookStoragePath ?? null,
      workbook_signed_url: input.workbookSignedUrl ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create plan revision: ${error.message}`);
  return data as PlanRevision;
}

export async function listPlanConversationMessages(planId: string): Promise<PlanConversationMessage[]> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("plan_conversations")
    .select("*")
    .eq("plan_id", planId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to list plan conversation messages: ${error.message}`);
  return (data ?? []) as PlanConversationMessage[];
}

export async function createPlanConversationMessage(
  input: CreateConversationMessageInput,
): Promise<PlanConversationMessage> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("plan_conversations")
    .insert({
      plan_id: input.planId,
      revision_id: input.revisionId ?? null,
      user_id: input.userId ?? null,
      role: input.role,
      message_type: input.messageType,
      content: input.content,
      metadata: input.metadata ?? {},
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to save plan conversation message: ${error.message}`);
  return data as PlanConversationMessage;
}

export async function createPlanChangeProposal(
  proposal: PlanChangeProposal,
  createdBy?: string | null,
): Promise<StoredPlanChangeProposal> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("plan_change_proposals")
    .insert({
      id: proposal.id,
      plan_id: proposal.planId,
      based_on_revision_id: proposal.basedOnRevisionId,
      request_summary: proposal.requestSummary,
      proposal,
      status: "pending",
      created_by: createdBy ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to save plan change proposal: ${error.message}`);
  return data as StoredPlanChangeProposal;
}

export async function getPlanChangeProposal(
  planId: string,
  proposalId: string,
): Promise<StoredPlanChangeProposal | null> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("plan_change_proposals")
    .select("*")
    .eq("plan_id", planId)
    .eq("id", proposalId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load plan change proposal: ${error.message}`);
  return data as StoredPlanChangeProposal | null;
}

export async function updatePlanChangeProposalStatus(
  planId: string,
  proposalId: string,
  status: "pending" | "applied" | "cancelled",
  appliedRevisionId?: string | null,
): Promise<StoredPlanChangeProposal> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("plan_change_proposals")
    .update({
      status,
      applied_revision_id: appliedRevisionId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("plan_id", planId)
    .eq("id", proposalId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update plan change proposal: ${error.message}`);
  return data as StoredPlanChangeProposal;
}

export async function recordPlanFile(
  planId: string,
  upload: WorkbookUploadResult,
  createdBy: string | null,
): Promise<PlanFileRecord | null> {
  try {
    const supabase = getClient();
    const { data: latest } = await supabase
      .from("plan_files")
      .select("version")
      .eq("plan_id", planId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const version = Number(latest?.version ?? 0) + 1;
    const { data, error } = await supabase
      .from("plan_files")
      .insert({
        plan_id: planId,
        file_name: upload.filename,
        file_type: "workbook",
        version,
        file_size: upload.fileSize,
        storage_bucket: upload.bucket,
        storage_path: upload.objectPath,
        created_by: createdBy,
      })
      .select()
      .single();

    if (error) throw error;
    return data as PlanFileRecord;
  } catch (error) {
    console.error("[supabaseService] Failed to record plan file:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

export async function createSignedPlanFileDownload(fileId: string): Promise<{ signedUrl: string; fileName: string }> {
  const supabase = getClient();
  const { data: file, error } = await supabase
    .from("plan_files")
    .select("*")
    .eq("id", fileId)
    .single();

  if (error || !file) throw new Error("Plan file not found.");

  const expiresIn = getSignedUrlExpiresInSeconds();
  const { data, error: signedUrlError } = await supabase.storage
    .from(file.storage_bucket)
    .createSignedUrl(file.storage_path, expiresIn, { download: file.file_name });

  if (signedUrlError || !data?.signedUrl) {
    throw new Error(`Failed to create workbook download URL: ${signedUrlError?.message ?? "No signed URL returned"}`);
  }

  return { signedUrl: data.signedUrl, fileName: file.file_name };
}

export async function createGenerationRun(input: {
  projectTitle?: string | null;
  modelProvider?: string | null;
  modelName?: string | null;
  promptVersion?: string | null;
  attemptNumber?: number | null;
}): Promise<string | null> {
  try {
    const supabase = getClient();
    const { data, error } = await supabase
      .from("plan_generation_runs")
      .insert({
        project_title: input.projectTitle ?? null,
        model_provider: input.modelProvider ?? "ollama",
        model_name: input.modelName ?? null,
        prompt_version: input.promptVersion ?? null,
        status: "started",
        attempt_number: input.attemptNumber ?? 1,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  } catch (error) {
    console.error("[supabaseService] Failed to create generation run:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

export async function completeGenerationRun(
  runId: string | null,
  updates: Partial<PlanGenerationRunRecord> & { status: "completed" | "failed"; plan_id?: string | null },
): Promise<void> {
  if (!runId) return;
  try {
    const supabase = getClient();
    const { error } = await supabase
      .from("plan_generation_runs")
      .update({ ...updates, completed_at: new Date().toISOString() })
      .eq("id", runId);
    if (error) throw error;
  } catch (error) {
    console.error("[supabaseService] Failed to complete generation run:", error instanceof Error ? error.message : String(error));
  }
}

export async function listGenerationRuns(filters: {
  status?: string;
  modelName?: string;
  planId?: string;
  date?: string;
} = {}): Promise<PlanGenerationRunRecord[]> {
  const supabase = getClient();
  let query = supabase
    .from("plan_generation_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(100);

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.modelName) query = query.eq("model_name", filters.modelName);
  if (filters.planId) query = query.eq("plan_id", filters.planId);
  if (filters.date) {
    query = query.gte("started_at", `${filters.date}T00:00:00.000Z`).lt("started_at", `${filters.date}T23:59:59.999Z`);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list generation runs: ${error.message}`);
  return (data ?? []) as PlanGenerationRunRecord[];
}

