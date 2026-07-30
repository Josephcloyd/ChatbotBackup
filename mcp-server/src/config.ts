import { readFileSync } from "node:fs";
import path from "node:path";

// Manually parse .env file if present to guarantee env variables reload in watch mode
try {
  const envPath = path.resolve(".env");
  const envContent = readFileSync(envPath, "utf8");
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index > 0) {
      const key = trimmed.slice(0, index).trim();
      const val = trimmed.slice(index + 1).trim();
      process.env[key] = val;
    }
  }
} catch (e) {
  // Ignore if .env doesn't exist
}

function positiveNumber(
  name: string,
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
}

export interface AppConfig {
  port: number;
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaTimeoutMs: number;
  ollamaNumPredict: number;
  supabaseConfigured: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = positiveNumber("MCP_PORT", env.MCP_PORT, 3001);
  if (!Number.isInteger(port) || port > 65_535) {
    throw new Error("MCP_PORT must be an integer between 1 and 65535");
  }

  const ollamaBaseUrl = env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
  try {
    new URL(ollamaBaseUrl);
  } catch {
    throw new Error("OLLAMA_BASE_URL must be a valid URL");
  }

  return {
    port,
    ollamaBaseUrl: ollamaBaseUrl.replace(/\/$/, ""),
    ollamaModel: env.OLLAMA_MODEL ?? "qwen3:4b",
    ollamaTimeoutMs: positiveNumber(
      "OLLAMA_TIMEOUT_MS",
      env.OLLAMA_TIMEOUT_MS,
      600_000,
    ),
    ollamaNumPredict: positiveNumber(
      "OLLAMA_NUM_PREDICT",
      env.OLLAMA_NUM_PREDICT,
      8192,
    ),
    supabaseConfigured: Boolean(
      env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY,
    ),
  };
}

export const config = loadConfig();
