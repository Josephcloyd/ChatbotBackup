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
import { listAvailableTemplates, templateService } from "./services/templateService.js";
import {
  getRecentPlans,
  deletePlan,
  updatePlan,
  reassignPlans,
  getPlanById,
  countPlansForUser,
  listPlanFiles,
  createSignedPlanFileDownload,
  listGenerationRuns,
  updatePlanReviewStatus,
} from "./supabaseService.js";
import { verifyUser, listUsers, createUser, deleteUser, seedUsers, updateUserAccess, getUserAccessByUsername } from "./services/userService.js";
import { excelService } from "./services/excelService.js";
import { dynamicExcelService } from "./services/dynamicExcelService.js";
import {
  findColumnLabel,
  getSemanticCell,
} from "./services/productionPlanColumns.js";

const generationInputSchema = z.object({
  whatsappUserId: z.string().trim().min(1).max(120),
  projectDescription: z.string().trim().min(10).max(10_000),
  workbookMode: z.enum(["template", "dynamic"]).default("dynamic"),
  selectedTemplate: z.string().optional(),
  generationSource: z.enum(["whatsapp", "dashboard", "api", "admin"]).default("api"),
});

const planPatchSchema = z.object({
  project_title: z.string().trim().min(1).max(250).optional(),
  summary: z.string().trim().min(1).max(10_000).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  progress_percentage: z.number().min(0).max(100).optional(),
  planning_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  planning_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  actual_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  actual_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  actual_hours: z.number().min(0).nullable().optional(),
  requested_team_size: z.number().min(0).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.planning_start_date && value.planning_end_date && value.planning_end_date < value.planning_start_date) {
    ctx.addIssue({ code: "custom", path: ["planning_end_date"], message: "Planning end date cannot be earlier than start date." });
  }
  if (value.actual_start_date && value.actual_end_date && value.actual_end_date < value.actual_start_date) {
    ctx.addIssue({ code: "custom", path: ["actual_end_date"], message: "Actual end date cannot be earlier than start date." });
  }
});

const reviewSchema = z.object({
  action: z.enum(["under_review", "approve", "reject", "archive", "restore", "generated", "failed"]),
  rejectionReason: z.string().trim().max(2000).optional(),
});

const userPatchSchema = z.object({
  role: z.enum(["admin", "operator"]).optional(),
  active: z.boolean().optional(),
});

function adminContext(req: Request): { id: string } {
  return {
    id: String(req.get("x-flowboard-admin-id") ?? "").trim(),
  };
}

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
        workbookMode: z.enum(["template", "dynamic"]).default("dynamic").optional(),
        selectedTemplate: z.string().optional()
      }
    },
    async ({ whatsappUserId, projectDescription, workbookMode, selectedTemplate }) => {
      console.log("========== TOOL INVOKED ==========");
      console.log("whatsappUserId:", whatsappUserId);
      console.log("projectDescription:", projectDescription);
      console.log("workbookMode:", workbookMode ?? "dynamic");
      console.log("selectedTemplate:", selectedTemplate);

      const result = await generateProductionPlan({ whatsappUserId, projectDescription, workbookMode, selectedTemplate });

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

  app.get(["/api/planner/templates", "/api/templates"], (_req: Request, res: Response) => {
    res.json({ success: true, templates: listAvailableTemplates() });
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
      selectedTemplate: parsed.data.selectedTemplate,
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
      const users = await listUsers();
      const operators = await Promise.all(users.map(async (user) => {
        if (!config.supabaseConfigured) return user;
        try {
          return { ...user, planCount: await countPlansForUser(user.username) };
        } catch {
          return { ...user, planCount: 0 };
        }
      }));
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

  app.get("/api/auth/status", async (req: Request, res: Response) => {
    try {
      const username = typeof req.query.username === "string" ? req.query.username : "";
      if (!username) {
        res.status(400).json({ success: false, error: "Username is required." });
        return;
      }
      const access = await getUserAccessByUsername(username);
      if (!access) {
        res.status(404).json({ success: false, error: "User not found." });
        return;
      }
      res.json({ success: true, user: access });
    } catch (error) {
      res.status(503).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to verify user status",
      });
    }
  });

  app.patch("/api/operators/:id", async (req: Request, res: Response) => {
    try {
      const parsed = userPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Invalid user update request" });
        return;
      }
      const userId = req.params.id as string;
      const updated = await updateUserAccess(userId, parsed.data);
      res.json({ success: true, user: updated });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to update user",
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
      const parsed = planPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Invalid plan update request" });
        return;
      }
      const updated = await updatePlan(planId, parsed.data);
      res.json({ success: true, plan: updated });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to update plan",
      });
    }
  });

  app.post("/api/plans/:id/review", async (req: Request, res: Response) => {
    try {
      const parsed = reviewSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Invalid review action request" });
        return;
      }
      const admin = adminContext(req);
      if (!admin.id) {
        res.status(403).json({ success: false, error: "Administrator identity is required." });
        return;
      }
      const planId = req.params.id as string;
      const updated = await updatePlanReviewStatus(planId, parsed.data.action, admin.id, parsed.data.rejectionReason);
      res.json({ success: true, plan: updated });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to update plan review status",
      });
    }
  });

  app.get("/api/plans/:id/files", async (req: Request, res: Response) => {
    if (!config.supabaseConfigured) {
      res.json({ success: true, files: [] });
      return;
    }
    try {
      const files = await listPlanFiles(req.params.id as string);
      res.json({ success: true, files });
    } catch (error) {
      res.status(502).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to list workbook files",
      });
    }
  });

  app.post("/api/plans/:id/files/:fileId/download", async (req: Request, res: Response) => {
    try {
      const download = await createSignedPlanFileDownload(req.params.fileId as string);
      res.json({ success: true, ...download });
    } catch (error) {
      res.status(404).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to create workbook download",
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
        const plannedHoursLabel = productionSheet
          ? (
              findColumnLabel(
                productionSheet,
                plan.project.productionUnit && plan.project.productionUnit !== "hours"
                  ? "planned_hours"
                  : "planned_output",
              ) ??
              findColumnLabel(productionSheet, "planned_output")
            )
          : undefined;
        const totalHours = planRows.reduce(
          (sum: number, row: any) =>
            sum + Number(plannedHoursLabel ? row[plannedHoursLabel] : 0),
          0,
        );
        const teamSize = Math.max(
          ...planRows.map((row: any) =>
            Number(
              productionSheet
                ? getSemanticCell(row, productionSheet, "planned_staff") ?? 1
                : 1,
            ),
          ),
          1,
        );
        const dayLabel = productionSheet
          ? findColumnLabel(productionSheet, "day")
          : undefined;
        const hasWeekends = planRows.some((r: any) => {
          const day = String(dayLabel ? r[dayLabel] : "").toLowerCase();
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
          unitLabel:
            plan.project.productionUnit && plan.project.productionUnit !== "hours"
              ? String(plan.project.productionUnit)
                  .replace(/^./, (character: string) => character.toUpperCase())
              : undefined,
          totalQuantity:
            plan.project.productionUnit && plan.project.productionUnit !== "hours"
              ? Number(plan.project.totalAssets ?? 0)
              : undefined,
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
      const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 15;
      const offset = typeof req.query.offset === "string" ? Number(req.query.offset) : 0;
      const plans = await getRecentPlans(userId || undefined, limit, offset);
      res.json({ configured: true, plans });
    } catch (error) {
      res.status(502).json({
        configured: true,
        plans: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/admin/runs", async (req: Request, res: Response) => {
    if (!config.supabaseConfigured) {
      res.json({ success: true, runs: [] });
      return;
    }
    try {
      const runs = await listGenerationRuns({
        status: typeof req.query.status === "string" ? req.query.status : undefined,
        modelName: typeof req.query.modelName === "string" ? req.query.modelName : undefined,
        planId: typeof req.query.planId === "string" ? req.query.planId : undefined,
        date: typeof req.query.date === "string" ? req.query.date : undefined,
      });
      res.json({ success: true, runs });
    } catch (error) {
      res.status(502).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to list AI runs",
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

