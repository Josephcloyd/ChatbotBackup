import { getClient, createServiceRoleClient } from "../supabaseService.js";
import { config } from "../config.js";

export const DEFAULT_OPERATOR_USERNAME = "operator1";
export const DEFAULT_OPERATOR_DISPLAY_NAME = "wilfredalternate6969@gmail.com";
const DEFAULT_OPERATOR_AUTH_EMAIL = DEFAULT_OPERATOR_DISPLAY_NAME;
const DEFAULT_OPERATOR_PASSWORD = "operator123";

// Helper to normalize username to lifewood.local email format
function getEmail(username: string): string {
  const clean = username.trim();
  if (clean.includes("@")) {
    return clean;
  }
  return `${clean}@lifewood.local`;
}

// Helper to extract username from lifewood.local email
function getUsername(email: string | undefined): string {
  if (!email) return "unknown";
  if (email.endsWith("@lifewood.local")) {
    return email.slice(0, -15); // Remove "@lifewood.local"
  }
  return email;
}

export interface UserRecord {
  id: string;
  username: string;
  displayName?: string;
  role: "admin" | "operator";
  databaseRole: "admin" | "user";
  active: boolean;
  createdAt: string;
  updatedAt?: string;
  planCount?: number;
}

export interface VerifiedUser {
  id: string;
  username: string;
  displayName?: string;
  role: "admin" | "operator";
}

function databaseRoleToFrontend(role: unknown): "admin" | "operator" {
  return role === "admin" ? "admin" : "operator";
}

function frontendRoleToDatabase(role: unknown): "admin" | "user" {
  return role === "admin" ? "admin" : "user";
}

function isActive(metadata: Record<string, unknown> | undefined): boolean {
  return metadata?.active !== false;
}

function getDisplayName(email: string | undefined, metadata: Record<string, unknown> | undefined): string | undefined {
  const metadataName = metadata?.display_name;
  if (typeof metadataName === "string" && metadataName.trim()) {
    return metadataName.trim();
  }
  return email;
}

async function syncUserRole(userId: string, role: "admin" | "operator", active: boolean): Promise<void> {
  if (!config.supabaseConfigured) return;
  try {
    const supabase = getClient();
    
    // Default payload using user_id (standard migration schema)
    let payload: Record<string, unknown> = {
      user_id: userId,
      role: frontendRoleToDatabase(role),
      active,
      is_active: active,
      updated_at: new Date().toISOString(),
    };

    let { error } = await supabase.from("user_roles").upsert(payload);

    // If table uses 'id' instead of 'user_id'
    if (error && error.message?.includes("user_id")) {
      delete payload.user_id;
      payload.id = userId;
      const idTry = await supabase.from("user_roles").upsert(payload);
      error = idTry.error;
    }

    // If 'is_active' or 'active' columns are missing in schema cache
    if (error && (error.message?.includes("is_active") || error.message?.includes("'active'"))) {
      if (error.message.includes("is_active")) delete payload.is_active;
      if (error.message.includes("'active'")) delete payload.active;
      const retry = await supabase.from("user_roles").upsert(payload);
      error = retry.error;
    }

    if (error) {
      console.error("[userService] Failed to sync public.user_roles:", error.message || JSON.stringify(error));
    }
  } catch (error: any) {
    const message = error?.message || (typeof error === "object" ? JSON.stringify(error) : String(error));
    console.error("[userService] Failed to sync public.user_roles:", message);
  }
}

export async function seedUsers(): Promise<void> {
  if (!config.supabaseConfigured) {
    console.warn("[userService] Supabase is not configured. Seeding skipped.");
    return;
  }

  try {
    const supabase = getClient();
    console.log("[userService] Checking and seeding default users...");

    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) {
      console.error("[userService] Failed to list users during seeding:", listError.message);
      return;
    }

    const adminEmail = "admin@lifewood.local";
    const operatorEmail = getEmail(DEFAULT_OPERATOR_USERNAME);

    const adminExists = users?.some((u) => u.email === adminEmail);
    if (!adminExists) {
      console.log(`[userService] Seeding default admin user: ${adminEmail}`);
      const { error: createAdminError } = await supabase.auth.admin.createUser({
        email: adminEmail,
        password: "admin123",
        email_confirm: true,
        user_metadata: { role: "admin", display_name: "admin", active: true },
      });
      if (createAdminError) {
        console.error("[userService] Failed to create seed admin:", createAdminError.message);
      }
    } else {
      const admin = users?.find((u) => u.email === adminEmail);
      if (admin) await syncUserRole(admin.id, "admin", true);
    }

    const operatorExists = users?.some((u) => u.email === operatorEmail);
    if (!operatorExists) {
      console.log(`[userService] Seeding default operator user: ${operatorEmail}`);
      const { error: createOpError } = await supabase.auth.admin.createUser({
        email: operatorEmail,
        password: DEFAULT_OPERATOR_PASSWORD,
        email_confirm: true,
        user_metadata: { role: "user", display_name: DEFAULT_OPERATOR_DISPLAY_NAME, active: true },
      });
      if (createOpError) {
        console.error("[userService] Failed to create seed operator:", createOpError.message);
      }
    } else {
      const operator = users?.find((u) => u.email === operatorEmail);
      if (operator) await syncUserRole(operator.id, "operator", true);
    }

    console.log("[userService] Seeding check complete.");
  } catch (err) {
    console.error("[userService] Unexpected error in seeding:", err instanceof Error ? err.message : String(err));
  }
}

export async function verifyUser(username: string, password: string): Promise<VerifiedUser> {
  // If Supabase is unconfigured, fall back to mock admin/operator authentication for ease of testing
  if (!config.supabaseConfigured) {
    console.warn("[userService] Supabase not configured. Authenticating using local mock configuration.");
    const cleanUser = username.trim().toLowerCase();
    if (cleanUser === "admin" && password === "admin123") {
      return { id: "mock-admin-id", username: "admin", displayName: "admin", role: "admin" };
    }
    const defaultOperatorLogin = cleanUser === DEFAULT_OPERATOR_USERNAME && password === DEFAULT_OPERATOR_PASSWORD;
    const legacyOperatorLogin = cleanUser.startsWith("operator") && password === `${cleanUser}123`;
    if (defaultOperatorLogin || legacyOperatorLogin) {
      return { id: `mock-${cleanUser}-id`, username: cleanUser, displayName: DEFAULT_OPERATOR_DISPLAY_NAME, role: "operator" };
    }
    throw new Error("Invalid username or password (Mock Mode).");
  }

  const supabase = createServiceRoleClient();
  const cleanUser = username.trim().toLowerCase();
  const candidateEmails = cleanUser === DEFAULT_OPERATOR_USERNAME
    ? [getEmail(cleanUser), DEFAULT_OPERATOR_AUTH_EMAIL]
    : [getEmail(cleanUser)];

  let authenticatedUser: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>["data"]["user"] = null;
  let lastErrorMessage = "Authentication failed";
  for (const email of candidateEmails) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (data.user) {
      authenticatedUser = data.user;
      break;
    }
    if (error?.message) lastErrorMessage = error.message;
  }

  if (!authenticatedUser) {
    throw new Error(lastErrorMessage);
  }

  if (!isActive(authenticatedUser.user_metadata)) {
    throw new Error("This user account is inactive.");
  }

  const role = databaseRoleToFrontend(authenticatedUser.user_metadata?.role);
  const actualUsername = getUsername(authenticatedUser.email);
  const displayName = getDisplayName(authenticatedUser.email, authenticatedUser.user_metadata);
  return {
    id: authenticatedUser.id,
    username: cleanUser === DEFAULT_OPERATOR_USERNAME && actualUsername === DEFAULT_OPERATOR_AUTH_EMAIL
      ? DEFAULT_OPERATOR_USERNAME
      : actualUsername,
    displayName,
    role,
  };
}

export async function listUsers(): Promise<UserRecord[]> {
  if (!config.supabaseConfigured) {
    // Return mock users for mock local development mode
    return [
      { id: "mock-admin-id", username: "admin", role: "admin", databaseRole: "admin", active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), planCount: 0 },
      { id: "mock-op1-id", username: DEFAULT_OPERATOR_USERNAME, displayName: DEFAULT_OPERATOR_DISPLAY_NAME, role: "operator", databaseRole: "user", active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), planCount: 1 },
    ];
  }

  const supabase = getClient();
  const { data: { users }, error } = await supabase.auth.admin.listUsers();
  if (error) {
    throw new Error(`Failed to list users: ${error.message}`);
  }

  return (users ?? []).map((u) => ({
    id: u.id,
    username: u.email === DEFAULT_OPERATOR_AUTH_EMAIL ? DEFAULT_OPERATOR_USERNAME : getUsername(u.email),
    displayName: getDisplayName(u.email, u.user_metadata),
    role: databaseRoleToFrontend(u.user_metadata?.role),
    databaseRole: frontendRoleToDatabase(databaseRoleToFrontend(u.user_metadata?.role)),
    active: isActive(u.user_metadata),
    createdAt: u.created_at,
    updatedAt: u.updated_at,
  }));
}

export async function getUserAccessByUsername(username: string): Promise<{ active: boolean; role: "admin" | "operator"; id: string; displayName?: string } | null> {
  if (!config.supabaseConfigured) {
    const cleanUser = username.trim().toLowerCase();
    if (cleanUser === "admin") return { id: "mock-admin-id", active: true, role: "admin", displayName: "admin" };
    if (cleanUser.startsWith("operator")) return { id: `mock-${cleanUser}-id`, active: true, role: "operator", displayName: DEFAULT_OPERATOR_DISPLAY_NAME };
    return null;
  }

  const supabase = getClient();
  const { data: { users }, error } = await supabase.auth.admin.listUsers();
  if (error) throw new Error(`Failed to list users: ${error.message}`);
  const user = users?.find((candidate) => {
    const candidateUsername = candidate.email === DEFAULT_OPERATOR_AUTH_EMAIL ? DEFAULT_OPERATOR_USERNAME : getUsername(candidate.email);
    return candidateUsername === username;
  });
  if (!user) return null;
  return {
    id: user.id,
    active: isActive(user.user_metadata),
    role: databaseRoleToFrontend(user.user_metadata?.role),
    displayName: getDisplayName(user.email, user.user_metadata),
  };
}

export async function createUser(username: string, password: string, role: "admin" | "operator"): Promise<UserRecord> {
  if (!config.supabaseConfigured) {
    throw new Error("User creation is disabled when Supabase is not configured (Mock Mode).");
  }

  const supabase = getClient();
  const email = getEmail(username);

  const { data: { user }, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role: frontendRoleToDatabase(role), display_name: username, active: true },
  });

  if (error || !user) {
    throw new Error(`Failed to create user: ${error?.message ?? "Unknown error"}`);
  }

  const frontendRole = databaseRoleToFrontend(user.user_metadata?.role);
  const active = isActive(user.user_metadata);
  await syncUserRole(user.id, frontendRole, active);

  return {
    id: user.id,
    username: getUsername(user.email),
    role: frontendRole,
    databaseRole: frontendRoleToDatabase(frontendRole),
    active,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

export async function updateUserAccess(
  userId: string,
  updates: { role?: "admin" | "operator"; active?: boolean },
): Promise<UserRecord> {
  if (!config.supabaseConfigured) {
    throw new Error("User updates are disabled when Supabase is not configured (Mock Mode).");
  }

  const supabase = getClient();
  const { data: existingData, error: getError } = await supabase.auth.admin.getUserById(userId);
  if (getError || !existingData.user) {
    throw new Error(`Failed to load user: ${getError?.message ?? "Unknown error"}`);
  }

  const metadata = { ...(existingData.user.user_metadata ?? {}) };
  if (updates.role) metadata.role = frontendRoleToDatabase(updates.role);
  if (typeof updates.active === "boolean") metadata.active = updates.active;

  const { data: { user }, error } = await supabase.auth.admin.updateUserById(userId, {
    user_metadata: metadata,
  });

  if (error || !user) {
    throw new Error(`Failed to update user: ${error?.message ?? "Unknown error"}`);
  }

  const frontendRole = databaseRoleToFrontend(user.user_metadata?.role);
  const active = isActive(user.user_metadata);
  await syncUserRole(user.id, frontendRole, active);

  return {
    id: user.id,
    username: getUsername(user.email),
    role: frontendRole,
    databaseRole: frontendRoleToDatabase(frontendRole),
    active,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

export async function deleteUser(userId: string): Promise<void> {
  if (!config.supabaseConfigured) {
    throw new Error("User deletion is disabled when Supabase is not configured (Mock Mode).");
  }

  const supabase = getClient();
  const { error } = await supabase.auth.admin.deleteUser(userId);

  if (error) {
    throw new Error(`Failed to delete user: ${error.message}`);
  }
}
