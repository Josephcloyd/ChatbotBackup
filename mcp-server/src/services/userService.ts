import { getClient, createServiceRoleClient } from "../supabaseService.js";
import { config } from "../config.js";
import nodemailer from "nodemailer";

export const DEFAULT_OPERATOR_USERNAME = "operator1";
export const DEFAULT_OPERATOR_DISPLAY_NAME = "wilfredalternate6969@gmail.com";
const DEFAULT_OPERATOR_AUTH_EMAIL = DEFAULT_OPERATOR_DISPLAY_NAME;
const DEFAULT_OPERATOR_PASSWORD = "operator123";

// Helper to normalize legacy seed usernames to lifewood.local email format.
// NOTE: Only used for seeded/legacy mock accounts. New accounts use real emails.
function getLegacyEmail(username: string): string {
  const clean = username.trim();
  if (clean.includes("@")) return clean;
  return `${clean}@lifewood.local`;
}

// Derive a display username from a user's metadata or email address.
// Prefers assigned username / display_name in metadata, falling back to email or legacy domain stripping.
function getUsername(
  email: string | undefined,
  metadata?: Record<string, unknown>,
): string {
  const metaName = metadata?.username ?? metadata?.display_name;
  if (typeof metaName === "string" && metaName.trim()) {
    return metaName.trim();
  }
  if (!email) return "unknown";
  if (email === DEFAULT_OPERATOR_AUTH_EMAIL) return DEFAULT_OPERATOR_USERNAME;
  if (email.endsWith("@lifewood.local")) {
    return email.slice(0, -15);
  }
  return email;
}

export type UserAccountStatus = "pending" | "active" | "inactive";

export interface UserRecord {
  id: string;
  username: string;
  email?: string;
  displayName?: string;
  role: "admin" | "operator";
  databaseRole: "admin" | "user";
  active: boolean;
  status: UserAccountStatus;
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
  return getUserStatus(metadata) === "active";
}

function getUserStatus(
  metadata: Record<string, unknown> | undefined,
): UserAccountStatus {
  if (metadata?.status === "pending" || metadata?.active === "pending") {
    return "pending";
  }
  if (metadata?.status === "inactive" || metadata?.active === false) {
    return "inactive";
  }
  if (metadata?.status === "active" || metadata?.active === true) {
    return "active";
  }
  return metadata?.active === true ? "active" : "pending";
}

function getDisplayName(
  email: string | undefined,
  metadata: Record<string, unknown> | undefined,
): string | undefined {
  const metadataName = metadata?.display_name;
  if (typeof metadataName === "string" && metadataName.trim()) {
    return metadataName.trim();
  }
  return email;
}

async function syncUserRole(
  userId: string,
  role: "admin" | "operator",
  active: boolean,
): Promise<void> {
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
    if (
      error &&
      (error.message?.includes("is_active") ||
        error.message?.includes("'active'"))
    ) {
      if (error.message.includes("is_active")) delete payload.is_active;
      if (error.message.includes("'active'")) delete payload.active;
      const retry = await supabase.from("user_roles").upsert(payload);
      error = retry.error;
    }

    if (error) {
      console.error(
        "[userService] Failed to sync public.user_roles:",
        error.message || JSON.stringify(error),
      );
    }
  } catch (error: any) {
    const message =
      error?.message ||
      (typeof error === "object" ? JSON.stringify(error) : String(error));
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

    const {
      data: { users },
      error: listError,
    } = await supabase.auth.admin.listUsers();
    if (listError) {
      console.error(
        "[userService] Failed to list users during seeding:",
        listError.message,
      );
      return;
    }

    const adminEmail = "admin@lifewood.local";
    const operatorEmail = getLegacyEmail(DEFAULT_OPERATOR_USERNAME);

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
        console.error(
          "[userService] Failed to create seed admin:",
          createAdminError.message,
        );
      }
    } else {
      const admin = users?.find((u) => u.email === adminEmail);
      if (admin) await syncUserRole(admin.id, "admin", true);
    }

    const operatorExists = users?.some((u) => u.email === operatorEmail);
    if (!operatorExists) {
      console.log(
        `[userService] Seeding default operator user: ${operatorEmail}`,
      );
      const { error: createOpError } = await supabase.auth.admin.createUser({
        email: operatorEmail,
        password: DEFAULT_OPERATOR_PASSWORD,
        email_confirm: true,
        user_metadata: {
          role: "user",
          display_name: DEFAULT_OPERATOR_DISPLAY_NAME,
          active: true,
        },
      });
      if (createOpError) {
        console.error(
          "[userService] Failed to create seed operator:",
          createOpError.message,
        );
      }
    } else {
      const operator = users?.find((u) => u.email === operatorEmail);
      if (operator) await syncUserRole(operator.id, "operator", true);
    }

    console.log("[userService] Seeding check complete.");
  } catch (err) {
    console.error(
      "[userService] Unexpected error in seeding:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

export async function verifyUser(
  username: string,
  password: string,
): Promise<VerifiedUser> {
  // If Supabase is unconfigured, fall back to mock admin/operator authentication for ease of testing
  if (!config.supabaseConfigured) {
    console.warn(
      "[userService] Supabase not configured. Authenticating using local mock configuration.",
    );
    const cleanUser = username.trim().toLowerCase();
    if (cleanUser === "admin" && password === "admin123") {
      return {
        id: "mock-admin-id",
        username: "admin",
        displayName: "admin",
        role: "admin",
      };
    }
    const defaultOperatorLogin =
      cleanUser === DEFAULT_OPERATOR_USERNAME &&
      password === DEFAULT_OPERATOR_PASSWORD;
    const legacyOperatorLogin =
      cleanUser.startsWith("operator") && password === `${cleanUser}123`;
    if (defaultOperatorLogin || legacyOperatorLogin) {
      return {
        id: `mock-${cleanUser}-id`,
        username: cleanUser,
        displayName: DEFAULT_OPERATOR_DISPLAY_NAME,
        role: "operator",
      };
    }
    throw new Error("Invalid username or password (Mock Mode).");
  }

  const supabase = createServiceRoleClient();
  const cleanUser = username.trim().toLowerCase();
  let candidateEmails: string[] = [];

  if (cleanUser === DEFAULT_OPERATOR_USERNAME) {
    candidateEmails = [getLegacyEmail(cleanUser), DEFAULT_OPERATOR_AUTH_EMAIL];
  } else if (cleanUser.includes("@")) {
    candidateEmails = [cleanUser];
  } else {
    // If a non-email username was provided, look up the corresponding email from user metadata
    const supabaseAdmin = getClient();
    const { data: listData } = await supabaseAdmin.auth.admin.listUsers();
    const matched = listData?.users?.find((u) => {
      const uName = getUsername(u.email, u.user_metadata).toLowerCase();
      const metaName = (
        u.user_metadata?.username as string | undefined
      )?.toLowerCase();
      const metaDisplay = (
        u.user_metadata?.display_name as string | undefined
      )?.toLowerCase();
      return (
        uName === cleanUser ||
        metaName === cleanUser ||
        metaDisplay === cleanUser
      );
    });
    candidateEmails = matched?.email ? [matched.email] : [cleanUser];
  }

  let authenticatedUser: Awaited<
    ReturnType<typeof supabase.auth.signInWithPassword>
  >["data"]["user"] = null;
  let lastErrorMessage = "Authentication failed";
  for (const email of candidateEmails) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (data.user) {
      authenticatedUser = data.user;
      break;
    }
    if (error?.message) lastErrorMessage = error.message;
  }

  if (!authenticatedUser) {
    throw new Error(lastErrorMessage);
  }

  const userStatus = getUserStatus(authenticatedUser.user_metadata);
  if (userStatus === "inactive") {
    throw new Error(
      "Your account has been deactivated. Please contact your administrator.",
    );
  }

  // Automatically activate pending user profiles upon successful initial login / sign up
  if (userStatus === "pending") {
    console.log(
      `[userService] Activating pending user ${authenticatedUser.id} upon successful sign in.`,
    );
    const supabaseAdmin = getClient();
    const updatedMetadata = {
      ...(authenticatedUser.user_metadata ?? {}),
      active: true,
      status: "active",
    };
    await supabaseAdmin.auth.admin.updateUserById(authenticatedUser.id, {
      user_metadata: updatedMetadata,
      ban_duration: "none",
    });
    const role = databaseRoleToFrontend(authenticatedUser.user_metadata?.role);
    await syncUserRole(authenticatedUser.id, role, true);
  }

  const role = databaseRoleToFrontend(authenticatedUser.user_metadata?.role);
  const actualUsername = getUsername(
    authenticatedUser.email,
    authenticatedUser.user_metadata,
  );
  const displayName = getDisplayName(
    authenticatedUser.email,
    authenticatedUser.user_metadata,
  );
  return {
    id: authenticatedUser.id,
    username:
      cleanUser === DEFAULT_OPERATOR_USERNAME &&
      actualUsername === DEFAULT_OPERATOR_AUTH_EMAIL
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
      {
        id: "mock-admin-id",
        username: "admin",
        role: "admin",
        databaseRole: "admin",
        active: true,
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        planCount: 0,
      },
      {
        id: "mock-op1-id",
        username: DEFAULT_OPERATOR_USERNAME,
        displayName: DEFAULT_OPERATOR_DISPLAY_NAME,
        role: "operator",
        databaseRole: "user",
        active: true,
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        planCount: 1,
      },
    ];
  }

  const supabase = getClient();
  const {
    data: { users },
    error,
  } = await supabase.auth.admin.listUsers();
  if (error) {
    throw new Error(`Failed to list users: ${error.message}`);
  }

  return (users ?? []).map((u) => {
    const userStatus = getUserStatus(u.user_metadata);
    return {
      id: u.id,
      username: getUsername(u.email, u.user_metadata),
      email: u.email ?? undefined,
      displayName: getDisplayName(u.email, u.user_metadata),
      role: databaseRoleToFrontend(u.user_metadata?.role),
      databaseRole: frontendRoleToDatabase(
        databaseRoleToFrontend(u.user_metadata?.role),
      ),
      active: userStatus === "active",
      status: userStatus,
      createdAt: u.created_at,
      updatedAt: u.updated_at,
    };
  });
}

export async function getUserAccessByUsername(
  username: string,
): Promise<{
  active: boolean;
  role: "admin" | "operator";
  id: string;
  displayName?: string;
} | null> {
  if (!config.supabaseConfigured) {
    const cleanUser = username.trim().toLowerCase();
    if (cleanUser === "admin")
      return {
        id: "mock-admin-id",
        active: true,
        role: "admin",
        displayName: "admin",
      };
    if (cleanUser.startsWith("operator"))
      return {
        id: `mock-${cleanUser}-id`,
        active: true,
        role: "operator",
        displayName: DEFAULT_OPERATOR_DISPLAY_NAME,
      };
    return null;
  }

  try {
    const supabase = getClient();
    const {
      data: { users },
      error,
    } = await supabase.auth.admin.listUsers();
    if (error || !users) {
      console.warn(
        `[userService] listUsers warning in getUserAccessByUsername: ${error?.message ?? "no users returned"}`,
      );
      return null;
    }
    const user = users.find((candidate) => {
      const candidateUsername = getUsername(
        candidate.email,
        candidate.user_metadata,
      );
      const cleanSearch = username.trim().toLowerCase();
      return (
        candidateUsername.toLowerCase() === cleanSearch ||
        candidate.email?.toLowerCase() === cleanSearch
      );
    });
    if (!user) return null;
    return {
      id: user.id,
      active: isActive(user.user_metadata),
      role: databaseRoleToFrontend(user.user_metadata?.role),
      displayName: getDisplayName(user.email, user.user_metadata),
    };
  } catch (err) {
    console.warn(
      `[userService] Exception in getUserAccessByUsername for ${username}:`,
      err,
    );
    return null;
  }
}

/**
 * Invite a new user via a Supabase email invitation link.
 *
 * Flow:
 *  1. Calls `inviteUserByEmail` — Supabase sends an invitation email with a
 *     magic link so the user can confirm their account.
 *  2. Immediately sets the provided temporary password via `updateUserById` so
 *     the account is already usable. The invited user is expected to change
 *     their password after clicking the invitation link.
 *
 * @param email    The real email address of the invited user.
 * @param username A display name stored in user metadata.
 * @param password A required temporary password set by the admin.
 * @param role     The access role for the new account.
 */
async function sendGmailInvitationEmail(
  email: string,
  username: string,
  redirectUrl: string,
): Promise<boolean> {
  const user = process.env.EMAIL_USER || process.env.SMTP_USER;
  const pass = process.env.EMAIL_PASS || process.env.SMTP_PASS;

  if (!user || !pass) {
    return false;
  }

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LifePlan Invitation</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f7f5; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f7f5; padding: 30px 10px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 580px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 30px rgba(4, 98, 65, 0.08); border: 1px solid #e5ebe7;" cellspacing="0" cellpadding="0">
          
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #046241 0%, #0d6345 100%); padding: 32px 30px; text-align: center;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <div style="display: inline-block; background-color: rgba(255, 255, 255, 0.15); border-radius: 50%; width: 50px; height: 50px; line-height: 50px; text-align: center; margin-bottom: 10px;">
                      <span style="font-size: 24px; color: #ffffff;">🌱</span>
                    </div>
                    <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">LifePlan</h1>
                    <p style="color: #a7f3d0; margin: 4px 0 0 0; font-size: 10px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase;">POWERED BY LIFEWOOD PH</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Email Body Content -->
          <tr>
            <td style="padding: 32px 28px 24px 28px;">
              <h2 style="color: #1e293b; font-size: 19px; font-weight: 700; margin: 0 0 12px 0;">
                Welcome aboard, ${username}!
              </h2>
              <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 20px 0;">
                You have been invited to join the <strong>LifePlan Production Planning Board</strong>. Your user profile has been created and is currently awaiting setup.
              </p>

              <!-- Account Info Box -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8faf8; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 22px;">
                <tr>
                  <td style="padding: 16px 20px;">
                    <div style="font-size: 11px; color: #64748b; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 8px;">ACCOUNT SUMMARY</div>
                    <div style="font-size: 13px; color: #1e293b; margin-bottom: 6px;">
                      <strong>Username:</strong> <span style="color: #046241; font-weight: 700;">${username}</span>
                    </div>
                    <div style="font-size: 13px; color: #1e293b; margin-bottom: 6px;">
                      <strong>Email:</strong> ${email}
                    </div>
                    <div style="font-size: 13px; color: #1e293b;">
                      <strong>Status:</strong> <span style="display: inline-block; background-color: #fff3df; color: #9a6516; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 800;">Pending Setup</span>
                    </div>
                  </td>
                </tr>
              </table>

              <p style="color: #475569; font-size: 14px; line-height: 1.5; margin: 0 0 22px 0;">
                Please click the button below to enter the temporary password provided by your administrator, set your new password, and activate your account:
              </p>

              <!-- Primary CTA Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
                <tr>
                  <td align="center">
                    <a href="${redirectUrl}" style="background-color: #046241; color: #ffffff; padding: 13px 30px; text-decoration: none; border-radius: 6px; font-weight: 700; font-size: 14px; display: inline-block; box-shadow: 0 4px 10px rgba(4, 98, 65, 0.22);">
                      Activate Account &amp; Set Password &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Fallback Direct Link -->
              <div style="background-color: #f1f5f9; padding: 12px 14px; border-radius: 6px; font-size: 12px; color: #64748b; word-break: break-all;">
                <strong>Direct Link:</strong><br/>
                <a href="${redirectUrl}" style="color: #046241; text-decoration: underline;">${redirectUrl}</a>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8faf8; border-top: 1px solid #e5ebe7; padding: 18px 28px; text-align: center;">
              <p style="color: #94a3b8; font-size: 11px; margin: 0 0 4px 0;">
                LifePlan Board &copy; ${new Date().getFullYear()} Lifewood PH. All rights reserved.
              </p>
              <p style="color: #cbd5e1; font-size: 10px; margin: 0;">
                This is an automated administrative invitation from LifePlan System.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user,
        pass,
      },
    });

    const info = await transporter.sendMail({
      from: `"LifePlan Board" <${user}>`,
      to: email,
      subject: "Invitation to LifePlan Production Board",
      html: htmlContent,
    });

    console.log(
      `[userService] Invitation email sent via Gmail SMTP to ${email} (Message ID: ${info.messageId})`,
    );
    return true;
  } catch (err) {
    console.error(
      `[userService] Error sending Gmail invitation email to ${email}:`,
      err,
    );
    return false;
  }
}

export async function createUser(
  email: string,
  username: string,
  password: string,
  role: "admin" | "operator",
): Promise<UserRecord> {
  if (!config.supabaseConfigured) {
    throw new Error(
      "User creation is disabled when Supabase is not configured (Mock Mode).",
    );
  }

  const supabase = getClient();
  const userMetadata = {
    role: frontendRoleToDatabase(role),
    username: username,
    display_name: username,
    active: false,
    status: "pending",
  };

  let resolvedUser: any = null;

  const hasCustomEmailProvider = Boolean(
    (process.env.EMAIL_USER && process.env.EMAIL_PASS) ||
    (process.env.SMTP_USER && process.env.SMTP_PASS),
  );

  const redirectUrl = process.env.APP_URL
    ? `${process.env.APP_URL.replace(/\/$/, "")}/accept-invite`
    : `http://localhost:3000/accept-invite?email=${encodeURIComponent(email)}`;

  // If custom email provider (Gmail SMTP) is configured, create user account directly
  // to avoid triggering Supabase's default plain text email ("noreply@mail.app.supabase.io").
  if (hasCustomEmailProvider) {
    const { data: createData, error: createError } =
      await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: userMetadata,
      });

    if (createError || !createData?.user) {
      throw new Error(
        `Failed to create user account: ${createError?.message ?? "Unable to contact Supabase Auth service."}`,
      );
    }

    resolvedUser = createData.user;
  } else {
    // Step 1: Try sending invitation email link via Supabase Auth with redirect to /accept-invite page.
    try {
      const { data: inviteData, error: inviteError } =
        await supabase.auth.admin.inviteUserByEmail(email, {
          data: userMetadata,
          redirectTo: redirectUrl,
        });

      if (!inviteError && inviteData?.user) {
        resolvedUser = inviteData.user;
        await supabase.auth.admin.updateUserById(resolvedUser.id, {
          password,
          email_confirm: true,
        });
      } else {
        console.warn(
          `[userService] inviteUserByEmail failed (${inviteError?.message ?? "unknown"}); falling back to direct user creation.`,
        );
      }
    } catch (caughtErr) {
      console.warn(
        `[userService] inviteUserByEmail exception (${caughtErr instanceof Error ? caughtErr.message : String(caughtErr)}); falling back to direct user creation.`,
      );
    }

    // Step 2: Fallback to direct createUser if invitation link email could not be sent
    if (!resolvedUser) {
      const { data: createData, error: createError } =
        await supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: userMetadata,
        });

      if (createError || !createData?.user) {
        throw new Error(
          `Failed to create user account: ${createError?.message ?? "Unable to contact Supabase Auth service."}`,
        );
      }

      resolvedUser = createData.user;
    }
  }

  // Dispatch branded HTML invitation email via Gmail SMTP
  await sendGmailInvitationEmail(email, username, redirectUrl);

  const frontendRole = databaseRoleToFrontend(resolvedUser.user_metadata?.role);
  const userStatus = getUserStatus(resolvedUser.user_metadata);
  await syncUserRole(resolvedUser.id, frontendRole, false);

  return {
    id: resolvedUser.id,
    username,
    email: resolvedUser.email ?? email,
    role: frontendRole,
    databaseRole: frontendRoleToDatabase(frontendRole),
    active: false,
    status: userStatus,
    createdAt: resolvedUser.created_at,
    updatedAt: resolvedUser.updated_at,
  };
}

export async function updateUserAccess(
  userId: string,
  updates: { role?: "admin" | "operator"; active?: boolean },
): Promise<UserRecord> {
  if (!config.supabaseConfigured) {
    throw new Error(
      "User updates are disabled when Supabase is not configured (Mock Mode).",
    );
  }

  const supabase = getClient();
  const { data: existingData, error: getError } =
    await supabase.auth.admin.getUserById(userId);
  if (getError || !existingData.user) {
    throw new Error(
      `Failed to load user: ${getError?.message ?? "Unknown error"}`,
    );
  }

  const metadata = { ...(existingData.user.user_metadata ?? {}) };
  if (updates.role) metadata.role = frontendRoleToDatabase(updates.role);
  if (typeof updates.active === "boolean") {
    metadata.active = updates.active;
    metadata.status = updates.active ? "active" : "inactive";
  }

  // Build the update payload. When deactivating, we also set a Supabase-native
  // ban so the user cannot authenticate even bypassing the app's metadata check.
  // ban_duration='none' lifts the ban on reactivation.
  const updatePayload: Parameters<
    typeof supabase.auth.admin.updateUserById
  >[1] = {
    user_metadata: metadata,
  };
  if (typeof updates.active === "boolean") {
    updatePayload.ban_duration = updates.active ? "none" : "87600h"; // 10 years ≈ permanent ban
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.admin.updateUserById(userId, updatePayload);

  if (error || !user) {
    throw new Error(
      `Failed to update user: ${error?.message ?? "Unknown error"}`,
    );
  }

  const frontendRole = databaseRoleToFrontend(user.user_metadata?.role);
  const userStatus = getUserStatus(user.user_metadata);
  const active = userStatus === "active";
  await syncUserRole(user.id, frontendRole, active);

  return {
    id: user.id,
    username: getUsername(user.email, user.user_metadata),
    email: user.email ?? undefined,
    role: frontendRole,
    databaseRole: frontendRoleToDatabase(frontendRole),
    active,
    status: userStatus,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

/**
 * Confirms an invitation and updates the temporary password to a new password.
 * Transitions account status from "pending" to "active".
 *
 * @param identifier        Email address or username of the invited user.
 * @param temporaryPassword The temporary password assigned by admin.
 * @param newPassword       The new password chosen by the user.
 */
export async function confirmInvitePassword(
  identifier: string,
  temporaryPassword: string,
  newPassword: string,
): Promise<VerifiedUser> {
  // If Supabase is unconfigured (Mock Mode)
  if (!config.supabaseConfigured) {
    const cleanUser = identifier.trim().toLowerCase();
    return {
      id: `mock-${cleanUser}-id`,
      username: cleanUser,
      displayName: cleanUser,
      role: "operator",
    };
  }

  const supabaseAdmin = getClient();
  let targetUser: any = null;

  // 1. Try verifying user using identifier and temporaryPassword
  try {
    const verified = await verifyUser(identifier, temporaryPassword);
    const { data: userData } = await supabaseAdmin.auth.admin.getUserById(
      verified.id,
    );
    if (userData?.user) {
      targetUser = userData.user;
    }
  } catch (verifyErr) {
    console.warn(
      `[userService] verifyUser in confirmInvitePassword caught error (${verifyErr instanceof Error ? verifyErr.message : String(verifyErr)}); attempting admin resolution.`,
    );
  }

  // 2. If verifyUser failed (e.g. unconfirmed email or temporary password mismatch), resolve target user via admin listUsers
  if (!targetUser) {
    const cleanSearch = identifier.trim().toLowerCase();
    const { data: listData } = await supabaseAdmin.auth.admin.listUsers();
    targetUser = listData?.users?.find((u) => {
      const uName = getUsername(u.email, u.user_metadata).toLowerCase();
      const metaName = (
        u.user_metadata?.username as string | undefined
      )?.toLowerCase();
      const metaDisplay = (
        u.user_metadata?.display_name as string | undefined
      )?.toLowerCase();
      return (
        uName === cleanSearch ||
        metaName === cleanSearch ||
        metaDisplay === cleanSearch ||
        u.email?.toLowerCase() === cleanSearch
      );
    });

    if (!targetUser) {
      throw new Error(
        "User account not found. Please check your username or email.",
      );
    }
  }

  // 3. Update user password to newPassword, confirm email, and transition status to "active"
  const updatedMetadata = {
    ...(targetUser.user_metadata ?? {}),
    active: true,
    status: "active",
  };

  const { data: updatedData, error: updateError } =
    await supabaseAdmin.auth.admin.updateUserById(targetUser.id, {
      password: newPassword,
      email_confirm: true,
      user_metadata: updatedMetadata,
      ban_duration: "none",
    });

  if (updateError || !updatedData.user) {
    throw new Error(
      `Failed to update password: ${updateError?.message ?? "Unknown error"}`,
    );
  }

  // 4. Sync user role to active in user_roles table
  const role = databaseRoleToFrontend(updatedData.user.user_metadata?.role);
  await syncUserRole(targetUser.id, role, true);

  const actualUsername = getUsername(
    updatedData.user.email,
    updatedData.user.user_metadata,
  );
  const displayName = getDisplayName(
    updatedData.user.email,
    updatedData.user.user_metadata,
  );

  return {
    id: targetUser.id,
    username: actualUsername,
    displayName,
    role,
  };
}

export async function deleteUser(userId: string): Promise<void> {
  if (!config.supabaseConfigured) {
    throw new Error(
      "User deletion is disabled when Supabase is not configured (Mock Mode).",
    );
  }

  const supabase = getClient();
  const { error } = await supabase.auth.admin.deleteUser(userId);

  if (error) {
    throw new Error(`Failed to delete user: ${error.message}`);
  }
}
