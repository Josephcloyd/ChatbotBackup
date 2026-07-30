import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createApp } from "../src/server.js";

test("health and MCP initialize endpoints respond over HTTP", async () => {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));

  try {
    const { port } = server.address() as AddressInfo;
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    const healthBody = await health.json() as {
      status: string;
      dependencies: { template: { available: boolean }; supabase: { required: boolean } };
    };
    assert.equal(healthBody.status, "ok");
    assert.equal(healthBody.dependencies.template.available, true);
    assert.equal(healthBody.dependencies.supabase.required, false);

    const history = await fetch(`http://127.0.0.1:${port}/api/plans`);
    assert.equal(history.status, 200);
    const historyBody = (await history.json()) as { configured: boolean; plans: unknown[] };
    assert.equal(typeof historyBody.configured, "boolean");
    assert.equal(Array.isArray(historyBody.plans), true);

    const invalidGeneration = await fetch(`http://127.0.0.1:${port}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectDescription: "too short" }),
    });
    assert.equal(invalidGeneration.status, 400);

    const unsafeDownload = await fetch(`http://127.0.0.1:${port}/files/..%2F.env`);
    assert.equal(unsafeDownload.status, 404);

    const initialize = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      }),
    });
    assert.equal(initialize.status, 200);
    assert.match(await initialize.text(), /production-planner-mcp/);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
});
