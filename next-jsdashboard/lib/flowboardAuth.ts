export const FLOWBOARD_AUTH_COOKIE = "flowboard_auth";

const SESSION_VALUE = "authenticated";

function getSessionSecret(): string {
  const secret = process.env.FLOWBOARD_SESSION_SECRET;

  if (!secret || secret.trim().length < 16) {
    throw new Error(
      "FLOWBOARD_SESSION_SECRET must be set and at least 16 characters long.",
    );
  }

  return secret;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function createSignature(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(getSessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(value),
  );
  return base64UrlEncode(new Uint8Array(signature));
}

export interface SessionPayload {
  id?: string;
  username: string;
  displayName?: string;
  role: "admin" | "operator";
}

export async function createSessionToken(
  username: string,
  role: string,
  id?: string,
  displayName?: string,
): Promise<string> {
  const payload: SessionPayload = {
    id,
    username,
    displayName,
    role: role === "admin" ? "admin" : "operator",
  };
  const serialized = JSON.stringify(payload);
  const base64Payload = btoa(unescape(encodeURIComponent(serialized)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

  const signature = await createSignature(base64Payload);
  return `${base64Payload}.${signature}`;
}

export async function getSessionPayload(
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [base64Payload, signature] = parts;

  const expectedSignature = await createSignature(base64Payload);
  if (signature !== expectedSignature) return null;

  try {
    const padded = base64Payload.replace(/-/g, "+").replace(/_/g, "/");
    const jsonStr = decodeURIComponent(escape(atob(padded)));
    return JSON.parse(jsonStr) as SessionPayload;
  } catch {
    return null;
  }
}

export async function isValidSessionToken(
  token: string | undefined,
): Promise<boolean> {
  const payload = await getSessionPayload(token);
  return payload !== null;
}
