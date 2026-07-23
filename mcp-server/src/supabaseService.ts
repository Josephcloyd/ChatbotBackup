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
  latest_progress_note?: string | null;
  latest_progress_updated_at?: string | null;
  latest_progress_updated_by?: string | null;
  priority?: PlanPriority;
  workbook_mode?: WorkbookMode;
  generation_source?: GenerationSource;
}

export type PlanStatus =
  | "generating"
  | "generated"
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

export interface PlanProgressUpdateRecord {
  id: string;
  plan_id: string;
  updated_by: string;
  progress_percentage: number;
  actual_start_date: string | null;
  actual_end_date: string | null;
  actual_hours: number | null;
  requested_team_size: number | null;
  note: string | null;
  created_at: string;
}

export interface PlanProgressUpdateInput {
  progress_percentage: number;
  actual_start_date?: string | null;
  actual_end_date?: string | null;
  actual_hours?: number | null;
  requested_team_size?: number | null;
  note?: string | null;
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
): Promise<PlanRecord[]> {
  const supabase = getClient();
  const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), 15);
  let query = supabase
    .from("production_plans")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (whatsappUserId) query = query.eq("whatsapp_user_id", whatsappUserId);
  const { data, error } = await query;
  if (error) throw new Error(`Supabase query failed: ${error.message}`);
  return enrichPlansWithLatestProgress((data ?? []) as PlanRecord[]);
}

async function enrichPlansWithLatestProgress(plans: PlanRecord[]): Promise<PlanRecord[]> {
  const ids = plans.map((plan) => plan.id).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return plans;

  try {
    const supabase = getClient();
    const { data, error } = await supabase
      .from("plan_progress_updates")
      .select("plan_id, updated_by, note, created_at")
      .in("plan_id", ids)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const latestByPlan = new Map<string, { updated_by: string; note: string | null; created_at: string }>();
    for (const row of data ?? []) {
      const planId = String(row.plan_id ?? "");
      if (!planId || latestByPlan.has(planId)) continue;
      latestByPlan.set(planId, {
        updated_by: String(row.updated_by ?? ""),
        note: typeof row.note === "string" ? row.note : null,
        created_at: String(row.created_at ?? ""),
      });
    }

    return plans.map((plan) => {
      const latest = plan.id ? latestByPlan.get(plan.id) : undefined;
      if (!latest) return plan;
      return {
        ...plan,
        latest_progress_note: latest.note,
        latest_progress_updated_at: latest.created_at,
        latest_progress_updated_by: latest.updated_by,
      };
    });
  } catch (error) {
    console.warn("[supabaseService] Could not load latest progress updates:", error instanceof Error ? error.message : String(error));
    return plans;
  }
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

export async function updatePlanProgress(
  planId: string,
  input: PlanProgressUpdateInput,
  context: { userId: string; role: "admin" | "operator" },
): Promise<{ plan: PlanRecord; progressUpdate: PlanProgressUpdateRecord }> {
  const userId = context.userId.trim();
  if (!userId) throw new Error("Authenticated user id is required.");

  const existing = await getPlanById(planId);
  if (!existing) throw new Error("Plan not found.");
  if (context.role !== "admin" && existing.requested_by !== userId) {
    throw new Error("You can only update progress for your own plans.");
  }

  const note = typeof input.note === "string" && input.note.trim().length > 0
    ? input.note.trim().slice(0, 2000)
    : null;
  const progressUpdate = {
    progress_percentage: input.progress_percentage,
    actual_start_date: input.actual_start_date ?? null,
    actual_end_date: input.actual_end_date ?? null,
    actual_hours: input.actual_hours ?? null,
    requested_team_size: input.requested_team_size ?? null,
  };

  const supabase = getClient();
  const { data: updatedPlan, error: updateError } = await supabase
    .from("production_plans")
    .update({
      ...progressUpdate,
      updated_at: new Date().toISOString(),
    })
    .eq("id", planId)
    .select()
    .single();

  if (updateError) {
    throw new Error(`Failed to update plan progress ${planId} in Supabase: ${updateError.message}`);
  }

  const { data: progressRow, error: insertError } = await supabase
    .from("plan_progress_updates")
    .insert({
      plan_id: planId,
      updated_by: userId,
      ...progressUpdate,
      note,
    })
    .select()
    .single();

  if (insertError) {
    throw new Error(`Failed to record plan progress history ${planId} in Supabase: ${insertError.message}`);
  }

  return {
    plan: {
      ...(updatedPlan as PlanRecord),
      latest_progress_note: note,
      latest_progress_updated_at: (progressRow as PlanProgressUpdateRecord).created_at,
      latest_progress_updated_by: userId,
    },
    progressUpdate: progressRow as PlanProgressUpdateRecord,
  };
}

export type ReviewAction = "archive" | "restore" | "generated" | "failed";

export async function updatePlanReviewStatus(
  planId: string,
  action: ReviewAction,
  adminId: string,
  rejectionReason?: string,
): Promise<PlanRecord> {
  const now = new Date().toISOString();
  const updates: Partial<PlanRecord> = { updated_at: now };

  if (action === "archive") {
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
        file_type: "xlsx",
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
        status: "running",
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

