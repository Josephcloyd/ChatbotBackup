export const FLOWBOARD_AUTH_COOKIE = "flowboard_auth";

const SESSION_VALUE = "authenticated";

function getSessionSecret(): string {
  const secret = process.env.FLOWBOARD_SESSION_SECRET;

  if (!secret || secret.trim().length < 16) {
    throw new Error("FLOWBOARD_SESSION_SECRET must be set and at least 16 characters long.");
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

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

export async function createSessionToken(): Promise<string> {
  const signature = await createSignature(SESSION_VALUE);
  return `${SESSION_VALUE}.${signature}`;
}

export async function isValidSessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;

  const [value, signature] = token.split(".");
  if (value !== SESSION_VALUE || !signature) return false;

  const expectedSignature = await createSignature(value);
  return signature === expectedSignature;
}
