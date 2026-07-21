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
import { getRecentPlans, deletePlan, updatePlan, reassignPlans, getPlanById } from "./supabaseService.js";
import { verifyUser, listUsers, createUser, deleteUser, seedUsers } from "./services/userService.js";
import { excelService } from "./services/excelService.js";
import { dynamicExcelService } from "./services/dynamicExcelService.js";

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
        workbookMode: z.enum(["template", "dynamic"]).default("dynamic").optional()
      }
    },
    async ({ whatsappUserId, projectDescription, workbookMode }) => {
      console.log("========== TOOL INVOKED ==========");
      console.log("whatsappUserId:", whatsappUserId);
      console.log("projectDescription:", projectDescription);
      console.log("workbookMode:", workbookMode ?? "dynamic");

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

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;
      if (typeof username !== "string" || typeof password !== "string") {
        res.status(400).json({ success: false, error: "Username and password required." });
        return;
      }
      const user = await verifyUser(username, password);
      res.json({ success: true, user });
    } catch (error) {
      res.status(401).json({
        success: false,
        error: error instanceof Error ? error.message : "Invalid credentials",
      });
    }
  });

  app.get("/api/operators", async (_req: Request, res: Response) => {
    try {
      const operators = await listUsers();
      res.json({ success: true, operators });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to list operators",
      });
    }
  });

  app.post("/api/operators", async (req: Request, res: Response) => {
    try {
      const { username, password, role } = req.body;
      if (typeof username !== "string" || typeof password !== "string") {
        res.status(400).json({ success: false, error: "Username and password required." });
        return;
      }
      const operatorRole = role === "admin" ? "admin" : "operator";
      const user = await createUser(username, password, operatorRole);
      res.json({ success: true, user });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to create operator",
      });
    }
  });

  app.delete("/api/operators/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.params.id as string;
      await deleteUser(userId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete operator",
      });
    }
  });

  app.post("/api/operators/reassign", async (req: Request, res: Response) => {
    try {
      const { fromUsername, toUsername } = req.body;
      if (typeof fromUsername !== "string" || typeof toUsername !== "string") {
        res.status(400).json({ success: false, error: "Reassignment usernames required." });
        return;
      }
      await reassignPlans(fromUsername, toUsername);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to reassign plans",
      });
    }
  });

  app.delete("/api/plans/:id", async (req: Request, res: Response) => {
    try {
      const planId = req.params.id as string;
      await deletePlan(planId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete plan",
      });
    }
  });

  app.patch("/api/plans/:id", async (req: Request, res: Response) => {
    try {
      const planId = req.params.id as string;
      const updates = req.body;
      const updated = await updatePlan(planId, updates);
      res.json({ success: true, plan: updated });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to update plan",
      });
    }
  });

  app.get("/api/plans/:id/download", async (req: Request, res: Response) => {
    try {
      const planId = req.params.id as string;
      console.log("[server] GET /api/plans/:id/download. Received planId:", planId);
      if (!config.supabaseConfigured) {
        res.status(400).json({ error: "Supabase not configured" });
        return;
      }

      const planRecord = await getPlanById(planId);
      console.log("[server] planRecord found:", planRecord ? "YES" : "NO");
      if (!planRecord) {
        res.status(404).json({ error: "Plan not found" });
        return;
      }

      const isDynamic = planRecord.raw_plan.workbook.sheets.some((s: any) =>
        ["Weekly Schedule", "Resource Allocation", "Summary"].includes(s.sheetName)
      );

      let workbookPath: string;
      if (isDynamic) {
        const plan = planRecord.raw_plan;
        const productionSheet = plan.workbook.sheets.find((sheet: any) => sheet.sheetName === "Production Plan");
        const planRows = productionSheet?.rows || [];
        const totalHours = planRows.reduce((sum: number, r: any) => sum + Number(r["Target Total Hours"] || r["Target Hours"] || 0), 0);
        const teamSize = Math.max(...planRows.map((r: any) => Number(r["Target Active Annotators"] || 1)), 1);
        const hasWeekends = planRows.some((r: any) => {
          const day = String(r["Day"] || "").toLowerCase();
          return day === "sat" || day === "sun" || day === "saturday" || day === "sunday";
        });
        const weekdaysOnly = !hasWeekends;

        const settings = {
          totalHours,
          teamSize,
          weekdaysOnly,
        } as any;

        const phases = (planRecord.phases || []).map((p: any) => ({
          name: p.phaseName || p.name || "",
          objective: p.objective || p.description || ""
        }));

        const risksSheet = plan.workbook.sheets.find((s: any) => s.sheetName === "Risks and Assumptions");
        const risks = (risksSheet?.rows || [])
          .filter((r: any) => r.Type === "Risk" || r.type === "Risk")
          .map((r: any) => ({
            risk: r.Item || r.Risk || r.risk || "",
            impact: r.Impact || r.impact || "",
            mitigation: r["Mitigation / Note"] || r.Mitigation || r.mitigation || ""
          }));

        workbookPath = await dynamicExcelService.writeDynamicProductionPlan({
          plan,
          settings,
          phases,
          risks,
        });
      } else {
        const templateDefinition = await templateService.loadDefinition();
        workbookPath = await excelService.writeProductionPlan(planRecord.raw_plan, templateDefinition);
      }

      const filename = path.basename(workbookPath);

      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.download(workbookPath, filename);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to download plan",
      });
    }
  });

  app.get("/api/plans", async (req: Request, res: Response) => {
    if (!config.supabaseConfigured) {
      // Offline fallback: Mock data (empty in test environment)
      const isTest = process.env.NODE_ENV === "test" || process.argv.some((arg) => arg.includes("test"));
      res.json({
        configured: false,
        plans: isTest ? [] : [
          {
            id: "mock-plan-1",
            whatsapp_user_id: "operator1",
            project_title: "Mock Dynamic Plan",
            summary: "This is a local mock plan since Supabase is not configured.",
            total_hours_estimate: 80,
            recommended_team_size: 2,
            key_risks: ["Mock assumption 1", "Mock assumption 2"],
            raw_plan: {
              project: {
                projectName: "Mock Dynamic Plan",
                projectDescription: "Mock Description",
                client: "Internal",
                startDate: "2026-07-15",
                deadline: "2026-07-17",
                assumptions: ["Mock assumption 1", "Mock assumption 2"],
              },
              workbook: {
                sheets: [
                  {
                    sheetName: "Production Plan",
                    rows: [
                      {
                        "No.": 1,
                        "Date": "2026-07-15",
                        "Month": "July 2026",
                        "Day": "Wednesday",
                        "Target Active Annotators": 2,
                        "Target Total Hours": 40,
                        "Target Total Hours per Annotator": 20,
                        "Status": "Not Started",
                      },
                    ],
                  },
                ],
              },
              summary: "This is a local mock plan since Supabase is not configured.",
            },
            created_at: new Date().toISOString(),
          },
        ],
      });
      return;
    }

    try {
      const userId = typeof req.query.userId === "string" ? req.query.userId.trim() : undefined;
      const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
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
    // Seed default users in Supabase Auth asynchronously
    seedUsers();
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

