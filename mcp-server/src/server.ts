import express from "express";
import type { Request, Response } from "express";
import type { Server } from "node:http";
import { access } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { generateProductionPlan } from "./plannerService.js";
import { config } from "./config.js";
import { templateService } from "./services/templateService.js";
import { getRecentPlans } from "./supabaseService.js";

const generationInputSchema = z.object({
  whatsappUserId: z.string().trim().min(1).max(120),
  projectDescription: z.string().trim().min(10).max(10_000),
  workbookMode: z.enum(["template", "dynamic"]).default("dynamic"),
});

export function createMcpServer() {
  const server = new McpServer({
    name: "production-planner-mcp",
    version: "1.0.0"
  });

  server.registerTool(
    "generate_production_plan",
    {
      title: "Generate Production Plan",
      description:
        "Generate a production plan using either the official template or a professional template-free workbook.",
      inputSchema: {
        whatsappUserId: z.string(),
        projectDescription: z.string(),
        workbookMode: z.enum(["template", "dynamic"]).optional()
      }
    },
    async ({ whatsappUserId, projectDescription, workbookMode }) => {
      console.log("========== TOOL INVOKED ==========");
      console.log("whatsappUserId:", whatsappUserId);
      console.log("projectDescription:", projectDescription);
      console.log("workbookMode:", workbookMode ?? "template");

      const result = await generateProductionPlan({ whatsappUserId, projectDescription, workbookMode });

      if (!result.success) {
        return {
          isError: true,
          content: [{ type: "text", text: result.whatsappSummary }],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `${result.whatsappSummary}\n\nExcel file: ${result.workbookPath}`,
          }
        ]
      };
    }
  );

  return server;
}

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", async (_req: Request, res: Response) => {
    let templateAvailable = true;
    try {
      await access(templateService.templatePath);
    } catch {
      templateAvailable = false;
    }

    res.status(200).json({
      status: "ok",
      service: "production-planner-mcp",
      dependencies: {
        template: { available: templateAvailable, requiredFor: "template mode only" },
        ollama: {
          configured: true,
          baseUrl: config.ollamaBaseUrl,
          model: config.ollamaModel,
          reachability: "checked during generation",
        },
        supabase: {
          configured: config.supabaseConfigured,
          required: false,
        },
      },
    });
  });

  app.post("/api/generate", async (req: Request, res: Response) => {
    const parsed = generationInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: "Invalid production-plan request",
        details: parsed.error.flatten(),
      });
      return;
    }

    const result = await generateProductionPlan(parsed.data);
    if (!result.success || !result.workbookPath) {
      res.status(422).json(result);
      return;
    }

    const filename = path.basename(result.workbookPath);
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const localDownloadUrl = `${baseUrl}/files/${encodeURIComponent(filename)}`;

    res.json({
      ...result,
      workbookMode: parsed.data.workbookMode,
      filename,
      downloadUrl: result.workbookSignedUrl ?? localDownloadUrl,
      localDownloadUrl,
      signedUrlExpiresInSeconds: result.workbookSignedUrlExpiresInSeconds,
    });
  });

  app.get("/api/plans", async (req: Request, res: Response) => {
    if (!config.supabaseConfigured) {
      res.json({ configured: false, plans: [] });
      return;
    }

    try {
      const userId = typeof req.query.userId === "string" ? req.query.userId.trim() : undefined;
      const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 12;
      const plans = await getRecentPlans(userId || undefined, limit);
      res.json({ configured: true, plans });
    } catch (error) {
      res.status(502).json({
        configured: true,
        plans: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/files/:filename", (req: Request, res: Response) => {
    const filename = req.params.filename;
    const safeName = /^(?:dynamic-)?production-plan-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.xlsx$/i;
    if (typeof filename !== "string" || !safeName.test(filename)) {
      res.status(404).json({ error: "Workbook not found" });
      return;
    }

    const filePath = path.join(path.resolve("outputs"), filename);
    res.setHeader("Cache-Control", "private, no-store");
    res.download(filePath, filename, (error) => {
      if (error && !res.headersSent) res.status(404).json({ error: "Workbook not found" });
    });
  });

  app.post("/mcp", async (req: Request, res: Response) => {
    const server = createMcpServer();

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });

    try {
      await server.connect(transport);

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP request failed:", error);

      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error"
          },
          id: null
        });
      }
    } finally {
      await transport.close();
      await server.close();
    }
  });

  return app;
}

export function startServer(): Server {
  const app = createApp();
  const httpServer = app.listen(config.port, "127.0.0.1", () => {
    console.log(`Production Planner MCP server running at http://localhost:${config.port}/mcp`);
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} received; closing HTTP server...`);
    httpServer.close((error) => {
      if (error) {
        console.error("Graceful shutdown failed:", error);
        process.exitCode = 1;
      }
    });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  return httpServer;
}

const entryPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryPath) startServer();

