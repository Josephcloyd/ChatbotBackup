/**
 * ollamaService.ts
 *
 * Sends a prompt to the local Ollama instance and returns the raw text response.
 * Uses the Ollama HTTP API directly — no extra SDK needed.
 */

import { config } from "./config.js";

export interface OllamaResponse {
  model?: string;
  response?: string;
  message?: {
    content?: string;
    [key: string]: unknown;
  };
  thinking?: string;
  done?: boolean;
  done_reason?: string;
  error?: string;
  [key: string]: unknown;
}

/** Parse either one JSON response or a newline-delimited stream of JSON chunks. */
export function parseOllamaResponseBody(rawBody: string): OllamaResponse[] {
  if (!rawBody.trim()) {
    throw new Error("Ollama returned an empty HTTP response body");
  }

  try {
    return [JSON.parse(rawBody) as OllamaResponse];
  } catch {
    try {
      return rawBody
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as OllamaResponse);
    } catch (error) {
      throw new Error(
        `Ollama returned a body that is neither JSON nor NDJSON: ${(error as Error).message}`,
      );
    }
  }
}

/** Extract generate.response or chat.message.content and join streamed chunks. */
export function extractOllamaText(payloads: OllamaResponse[]): string {
  const apiError = payloads.find((payload) => typeof payload.error === "string")?.error;
  if (apiError) throw new Error(`Ollama generation failed: ${apiError}`);

  const text = payloads
    .map((payload) => {
      if (typeof payload.response === "string") return payload.response;
      if (typeof payload.message?.content === "string") return payload.message.content;
      return "";
    })
    .join("")
    .trim();

  if (!text) {
    const finalPayload = payloads.at(-1);
    const fields = finalPayload ? Object.keys(finalPayload).join(", ") : "none";
    const thinkingLength = payloads.reduce(
      (length, payload) => length + (payload.thinking?.length ?? 0),
      0,
    );
    throw new Error(
      "Ollama returned an empty response body — check field extraction and streaming settings. " +
        `Expected response for /api/generate or message.content for /api/chat; ` +
        `received fields: ${fields}; done=${String(finalPayload?.done)}; ` +
        `done_reason=${String(finalPayload?.done_reason)}; thinkingLength=${thinkingLength}.`,
    );
  }

  return text;
}

/**
 * Fetch available models from Ollama and select the preferred or first available one.
 */
export async function getAvailableOllamaModel(): Promise<string> {
  const configuredModel = config.ollamaModel;
  try {
    const response = await fetch(`${config.ollamaBaseUrl}/api/tags`);
    if (!response.ok) return configuredModel;
    const data = await response.json() as { models?: { name: string }[] };
    const availableModels = data.models?.map(m => m.name) || [];
    
    if (availableModels.length === 0) return configuredModel;
    if (availableModels.includes(configuredModel)) return configuredModel;
    
    console.warn(`[ollamaService] Configured model ${configuredModel} not found. Falling back to ${availableModels[0]}`);
    return availableModels[0];
  } catch (error) {
    console.error("[ollamaService] Failed to fetch Ollama tags:", error);
    return configuredModel;
  }
}

/**
 * Send a prompt to Ollama and return the completed text response.
 * Uses non-streaming (stream: false) for simplicity.
 */
export async function generateWithOllama(prompt: string): Promise<string> {
  const modelToUse = await getAvailableOllamaModel();
  console.log(`[ollamaService] Sending prompt to ${modelToUse}...`);

  const body = JSON.stringify({
    model: modelToUse,
    prompt,
    format: "json",
    stream: false,
    think: false,
    options: {
      temperature: 0.3,   // low temp for structured JSON output
      top_p: 0.9,
      num_predict: config.ollamaNumPredict,
    },
  });

  const baseUrls = [
    config.ollamaBaseUrl,
    config.ollamaBaseUrl.includes("127.0.0.1")
      ? config.ollamaBaseUrl.replace("127.0.0.1", "localhost")
      : config.ollamaBaseUrl.includes("localhost")
        ? config.ollamaBaseUrl.replace("localhost", "127.0.0.1")
        : undefined,
  ].filter((u): u is string => Boolean(u));

  let lastError: Error | undefined;

  for (const baseUrl of baseUrls) {
    const url = `${baseUrl}/api/generate`;
    const maxRetries = 2;

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Connection": "close",
          },
          body,
          signal: AbortSignal.timeout(config.ollamaTimeoutMs),
        });

        const rawBody = await response.text();

        if (!response.ok) {
          throw new Error(`Ollama request failed (${response.status}): ${rawBody}`);
        }

        const payloads = parseOllamaResponseBody(rawBody);
        const unmodifiedPayload = payloads.length === 1 ? payloads[0] : payloads;
        console.log(
          "[ollamaService] Unmodified Ollama JSON response:",
          JSON.stringify(unmodifiedPayload, null, 2),
        );

        const finalPayload = payloads.at(-1);
        console.log(
          `[ollamaService] Response received, chunks=${payloads.length}, done=${String(finalPayload?.done)}`,
        );
        return extractOllamaText(payloads);
      } catch (error) {
        lastError = error as Error;
        const errMsg = lastError.message;
        const causeMsg = lastError.cause ? ` (cause: ${String(lastError.cause)})` : "";
        console.warn(`[ollamaService] Attempt ${attempt}/${maxRetries} to ${url} failed: ${errMsg}${causeMsg}`);
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }
  }

  const detailedMsg = lastError?.message || "Unknown error";
  if (detailedMsg === "fetch failed" || lastError?.name === "TypeError") {
    throw new Error(
      `Cannot connect to local Ollama server at ${config.ollamaBaseUrl}. Please ensure Ollama is running locally ('ollama serve') and model '${modelToUse}' is pulled.`
    );
  }
  throw lastError ?? new Error("Ollama generation failed");
}

/**
 * Parse the JSON output from Ollama, stripping any accidental markdown fences
 * and gracefully repairing truncated JSON if output tokens ran out.
 */
export function parseOllamaJson<T>(rawText: string): T {
  if (typeof rawText !== "string" || !rawText.trim()) {
    throw new Error("Cannot parse Ollama JSON because the extracted response text is empty");
  }

  // Strip markdown code fences if model added them despite instructions
  let cleaned = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  // Find the first { to handle any leading text
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace > 0) {
    cleaned = cleaned.slice(firstBrace);
  }

  // Find the last } to handle any trailing text
  const lastBrace = cleaned.lastIndexOf("}");
  if (lastBrace !== -1 && lastBrace < cleaned.length - 1) {
    cleaned = cleaned.slice(0, lastBrace + 1);
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch (initialError) {
    console.warn("[ollamaService] Initial JSON parse failed, attempting truncated JSON repair...");
    try {
      const repaired = repairTruncatedJson(cleaned);
      return JSON.parse(repaired) as T;
    } catch {
      throw initialError;
    }
  }
}

function repairTruncatedJson(jsonString: string): string {
  let str = jsonString.trim();

  // Remove any incomplete trailing key or property
  str = str.replace(/,\s*"[^"]*"?\s*:\s*"?[^"]*$/s, "");
  str = str.replace(/,\s*"[^"]*"$/s, "");

  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '"' && (i === 0 || str[i - 1] !== "\\")) {
      inString = !inString;
    } else if (!inString) {
      if (char === "{") openBraces++;
      else if (char === "}") openBraces--;
      else if (char === "[") openBrackets++;
      else if (char === "]") openBrackets--;
    }
  }

  if (inString) str += '"';

  while (openBrackets > 0) {
    str += "]";
    openBrackets--;
  }
  while (openBraces > 0) {
    str += "}";
    openBraces--;
  }

  return str;
}
