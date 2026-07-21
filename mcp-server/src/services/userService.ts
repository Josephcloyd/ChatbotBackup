import { getClient, createServiceRoleClient } from "../supabaseService.js";
import { config } from "../config.js";

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
  role: "admin" | "operator";
  createdAt: string;
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
    const operatorEmail = "operator1@lifewood.local";

    const adminExists = users?.some((u) => u.email === adminEmail);
    if (!adminExists) {
      console.log(`[userService] Seeding default admin user: ${adminEmail}`);
      const { error: createAdminError } = await supabase.auth.admin.createUser({
        email: adminEmail,
        password: "admin123",
        email_confirm: true,
        user_metadata: { role: "admin", display_name: "admin" },
      });
      if (createAdminError) {
        console.error("[userService] Failed to create seed admin:", createAdminError.message);
      }
    }

    const operatorExists = users?.some((u) => u.email === operatorEmail);
    if (!operatorExists) {
      console.log(`[userService] Seeding default operator user: ${operatorEmail}`);
      const { error: createOpError } = await supabase.auth.admin.createUser({
        email: operatorEmail,
        password: "operator123",
        email_confirm: true,
        user_metadata: { role: "operator", display_name: "operator1" },
      });
      if (createOpError) {
        console.error("[userService] Failed to create seed operator:", createOpError.message);
      }
    }

    console.log("[userService] Seeding check complete.");
  } catch (err) {
    console.error("[userService] Unexpected error in seeding:", err instanceof Error ? err.message : String(err));
  }
}

export async function verifyUser(username: string, password: string): Promise<{ username: string; role: "admin" | "operator" }> {
  // If Supabase is unconfigured, fall back to mock admin/operator authentication for ease of testing
  if (!config.supabaseConfigured) {
    console.warn("[userService] Supabase not configured. Authenticating using local mock configuration.");
    const cleanUser = username.trim().toLowerCase();
    if (cleanUser === "admin" && password === "admin123") {
      return { username: "admin", role: "admin" };
    }
    if (cleanUser.startsWith("operator") && password === `${cleanUser}123`) {
      return { username: cleanUser, role: "operator" };
    }
    throw new Error("Invalid username or password (Mock Mode).");
  }

  const supabase = createServiceRoleClient();
  const email = getEmail(username);

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    throw new Error(error?.message ?? "Authentication failed");
  }

  const role = data.user.user_metadata?.role === "admin" ? "admin" : "operator";
  return {
    username: getUsername(data.user.email),
    role,
  };
}

export async function listUsers(): Promise<UserRecord[]> {
  if (!config.supabaseConfigured) {
    // Return mock users for mock local development mode
    return [
      { id: "mock-admin-id", username: "admin", role: "admin", createdAt: new Date().toISOString() },
      { id: "mock-op1-id", username: "operator1", role: "operator", createdAt: new Date().toISOString() },
    ];
  }

  const supabase = getClient();
  const { data: { users }, error } = await supabase.auth.admin.listUsers();
  if (error) {
    throw new Error(`Failed to list users: ${error.message}`);
  }

  return (users ?? []).map((u) => ({
    id: u.id,
    username: getUsername(u.email),
    role: (u.user_metadata?.role === "admin" ? "admin" : "operator") as "admin" | "operator",
    createdAt: u.created_at,
  }));
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
    user_metadata: { role, display_name: username },
  });

  if (error || !user) {
    throw new Error(`Failed to create user: ${error?.message ?? "Unknown error"}`);
  }

  return {
    id: user.id,
    username: getUsername(user.email),
    role: (user.user_metadata?.role === "admin" ? "admin" : "operator") as "admin" | "operator",
    createdAt: user.created_at,
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
