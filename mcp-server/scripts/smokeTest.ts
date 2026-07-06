import { readFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.MCP_BASE_URL ?? "http://127.0.0.1:3001";

function notify(message: string): void {
  process.stdout.write("\u0007");
  console.log(message);
}

async function main(): Promise<void> {
  console.log(`Checking ${baseUrl}/health ...`);
  const health = await fetch(`${baseUrl}/health`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!health.ok) {
    throw new Error(`Health check failed with HTTP ${health.status}: ${await health.text()}`);
  }

  const requestPath = path.resolve("call-tool.json");
  const requestBody = await readFile(requestPath, "utf8");
  console.log("Generating the production plan. This can take several minutes...");

  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: requestBody,
    signal: AbortSignal.timeout(660_000),
  });
  const result = await response.text();

  if (!response.ok || /"isError"\s*:\s*true|Production plan generation failed/i.test(result)) {
    throw new Error(`Generation returned an error:\n${result}`);
  }
  if (!/Excel file:/i.test(result)) {
    throw new Error(`Generation response did not contain a workbook path:\n${result}`);
  }

  notify("\n✅ DONE — production plan and Excel workbook were generated successfully.");
  console.log(result);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  notify(`\n❌ FAILED — production plan was not generated.\n${message}`);
  process.exitCode = 1;
});
