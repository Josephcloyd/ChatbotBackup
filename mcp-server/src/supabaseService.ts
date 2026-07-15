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
}

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildPlanRecord(
  whatsappUserId: string,
  projectDescription: string,
  plan: ProductionPlanOutput,
): PlanRecord {
  const productionRows = plan.workbook.sheets.find(
    (sheet) => sheet.sheetName === "Production Plan",
  )?.rows ?? [];

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
    recommended_team_size: productionRows.reduce(
      (largest, row) => Math.max(largest, numberValue(row["Target Active Annotators"])),
      0,
    ),
    key_risks: plan.project.assumptions,
    next_steps: [],
    raw_plan: plan,
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
  plan: ProductionPlanOutput
): Promise<PlanRecord> {
  const supabase = getClient();

  const record = buildPlanRecord(whatsappUserId, projectDescription, plan);

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
  requestedLimit = 12,
): Promise<PlanRecord[]> {
  const supabase = getClient();
  const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), 50);
  let query = supabase
    .from("production_plans")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

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
  const { error } = await supabase
    .from("production_plans")
    .delete()
    .eq("id", planId);

  if (error) {
    throw new Error(`Failed to delete plan ${planId} from Supabase: ${error.message}`);
  }
}

export async function updatePlan(planId: string, updates: Partial<PlanRecord>): Promise<PlanRecord> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("production_plans")
    .update(updates)
    .eq("id", planId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update plan ${planId} in Supabase: ${error.message}`);
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

