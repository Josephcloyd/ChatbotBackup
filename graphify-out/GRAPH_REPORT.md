# Graph Report - ChatbotBackup  (2026-07-29)

## Corpus Check
- 122 files · ~87,473 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 868 nodes · 1704 edges · 48 communities (41 shown, 7 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c3d7c317`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- dynamicPlanService.ts
- planWorkspaceService.ts
- whatsappBot.ts
- apiAuth.ts
- mcp-server/package.json
- templateService.ts
- supabaseService.ts
- devDependencies
- compilerOptions
- app/page.tsx
- What You Must Do When Invoked
- server.ts
- Sidebar.tsx
- adminTypes.ts
- Project Continuation Prompt
- dynamicExcelService.ts
- AdminPlansPanel.tsx
- HistoryRecord
- AdminPlanDetailsPanel.tsx
- AdminOperatorsPanel.tsx
- Icon.tsx
- Chatbot2ProPl Production Planner
- compilerOptions
- Step-by-Step Continuation Prompt for ChatGPT or Gemini
- check-everything.ps1
- graphify reference: extra exports and benchmark
- ThemeProvider.tsx
- graphify reference: query, path, explain
- DashboardSkeleton.tsx
- process_user_logo.js
- Flowboard Dashboard
- generate_logos.js
- graphify reference: add a URL and watch a folder
- graphify reference: commit hook and native CLAUDE.md integration
- graphify reference: incremental update and cluster-only
- generate_poweredby.js
- graphify reference: GitHub clone and cross-repo merge
- graphify reference: transcribe video and audio
- smokeTest.ts
- AGENTS.md
- extraction-spec.md
- next.config.ts
- next-env.d.ts

## God Nodes (most connected - your core abstractions)
1. `getClient()` - 36 edges
2. `createApp()` - 31 edges
3. `buildDynamicPlan()` - 31 edges
4. `requireSession()` - 22 edges
5. `generateProductionPlan()` - 21 edges
6. `requireAdmin()` - 20 edges
7. `extractRequestedConstraints()` - 19 edges
8. `applyProposalToPlanData()` - 16 edges
9. `applyPlanWorkspaceProposal()` - 16 edges
10. `buildScheduleDates()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `PlannerResult` --references--> `ProductionPlanOutput`  [EXTRACTED]
  mcp-server/src/plannerService.ts → mcp-server/src/productionPrompt.ts
- `generateProductionPlan()` --calls--> `buildDynamicPlan()`  [EXTRACTED]
  mcp-server/src/plannerService.ts → mcp-server/src/services/dynamicPlanService.ts
- `generateProductionPlan()` --calls--> `validateDynamicProposal()`  [EXTRACTED]
  mcp-server/src/plannerService.ts → mcp-server/src/services/dynamicPlanService.ts
- `generateProductionPlan()` --calls--> `extractRequestedConstraints()`  [EXTRACTED]
  mcp-server/src/plannerService.ts → mcp-server/src/services/planningConstraintsService.ts
- `generateProductionPlan()` --calls--> `createPlanRevision()`  [EXTRACTED]
  mcp-server/src/plannerService.ts → mcp-server/src/supabaseService.ts

## Import Cycles
- None detected.

## Communities (48 total, 7 thin omitted)

### Community 0 - "dynamicPlanService.ts"
Cohesion: 0.05
Nodes (83): addDays(), collectDate(), DATE_EXPRESSION, DateInterpretation, endOfMonth(), extractNormalizedDateConstraints(), formatIsoDate(), isIsoDate() (+75 more)

### Community 1 - "planWorkspaceService.ts"
Cohesion: 0.08
Nodes (66): addChange(), applyChangesToSettings(), applyDefaultPlanningModel(), ApplyPlanProposalInput, applyPlanWorkspaceProposal(), applyProposalToPlanData(), asProductionPlan(), assistantMessageType() (+58 more)

### Community 2 - "whatsappBot.ts"
Cohesion: 0.06
Nodes (53): ChatIdentity, GroupAccessConfig, isAllowedWhatsAppGroup(), maskWhatsAppGroupId(), normalizeGroupAccessConfig(), normalizeGroupName(), getSimpleMathReply(), getSocialReply() (+45 more)

### Community 3 - "apiAuth.ts"
Cohesion: 0.09
Nodes (35): POST(), GET(), POST(), POST(), DELETE(), GET(), PATCH(), POST() (+27 more)

### Community 4 - "mcp-server/package.json"
Cohesion: 0.05
Nodes (42): exceljs, express, author, dependencies, exceljs, express, @modelcontextprotocol/sdk, qrcode-terminal (+34 more)

### Community 5 - "templateService.ts"
Cohesion: 0.08
Nodes (33): copyRowFormatting(), ExcelService, rowIsAvailable(), PlanRuleOptions, ProductionPromptInput, PromptService, promptTemplate(), todayIso() (+25 more)

### Community 6 - "supabaseService.ts"
Cohesion: 0.06
Nodes (55): extractOllamaText(), generateWithOllama(), getAvailableOllamaModel(), OllamaResponse, parseOllamaJson(), parseOllamaResponseBody(), repairTruncatedJson(), buildFriendlyFailure() (+47 more)

### Community 7 - "devDependencies"
Cohesion: 0.07
Nodes (29): eslint, eslint-config-next, next, dependencies, next, react, react-dom, devDependencies (+21 more)

### Community 8 - "compilerOptions"
Cohesion: 0.07
Nodes (27): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+19 more)

### Community 9 - "app/page.tsx"
Cohesion: 0.13
Nodes (21): Dashboard(), GenerationResult, isLaborHoursColumn(), normalizedUnit(), numberValue(), selectPerResourceColumn(), selectTargetColumn(), selectTeamColumn() (+13 more)

### Community 10 - "What You Must Do When Invoked"
Cohesion: 0.08
Nodes (24): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Honesty Rules, Interpreter guard for subcommands, Part A - Structural extraction for code files (+16 more)

### Community 11 - "server.ts"
Cohesion: 0.09
Nodes (44): AppConfig, config, loadConfig(), positiveNumber(), adminContext(), applyProposalSchema, createApp(), createMcpServer() (+36 more)

### Community 12 - "Sidebar.tsx"
Cohesion: 0.08
Nodes (23): Input(), InputProps, SelectProps, Textarea(), TextareaProps, LeafLogo(), LeafLogoProps, StatusIndicator() (+15 more)

### Community 13 - "adminTypes.ts"
Cohesion: 0.16
Nodes (18): display(), fileSize(), MessageBubble(), PlanWorkspace(), PlanWorkspaceProps, safeAssistantResponse(), suggestions, CellValue (+10 more)

### Community 14 - "Project Continuation Prompt"
Cohesion: 0.11
Nodes (17): Current verified status (July 6, 2026), Highest priority, Immediate objective for this continuation, Implementation update (July 13, 2026), Implementation update (July 6, 2026), Missing, incomplete, or risky areas, Phase 1 — Make the backend reproducible and trustworthy (baseline completed), Phase 2 — Deliver generated workbooks properly (local baseline completed) (+9 more)

### Community 15 - "dynamicExcelService.ts"
Cohesion: 0.19
Nodes (13): outputPath, proposal, result, bodyFont(), COLORS, DynamicExcelService, safeCellValue(), sectionHeader() (+5 more)

### Community 16 - "AdminPlansPanel.tsx"
Cohesion: 0.36
Nodes (7): AdminPlansPanel(), formatDateTime(), SortMode, sourceOf(), statusOf(), GenerationSource, PlanStatus

### Community 17 - "HistoryRecord"
Cohesion: 0.39
Nodes (7): AdminPlansPanelProps, AdminRunsPanel(), AdminRunsPanelProps, display(), duration(), HistoryRecord, PlanGenerationRun

### Community 20 - "AdminPlanDetailsPanel.tsx"
Cohesion: 0.27
Nodes (11): AdminPlanDetailsPanel(), AdminPlanDetailsPanelProps, display(), editableValue(), fileSize(), safeList(), PlanTable(), PlanTableProps (+3 more)

### Community 21 - "AdminOperatorsPanel.tsx"
Cohesion: 0.27
Nodes (8): Button(), ButtonProps, Spinner(), AdminOperatorsPanel(), AdminOperatorsPanelProps, displayDate(), FrontendRole, OperatorAccount

### Community 22 - "Icon.tsx"
Cohesion: 0.22
Nodes (8): Icon(), IconName, IconProps, MetricCard(), MetricCardProps, DashboardMetricsProps, DashboardLayout(), DashboardLayoutProps

### Community 23 - "Chatbot2ProPl Production Planner"
Cohesion: 0.15
Nodes (12): Chatbot2ProPl Production Planner, Collaborator Quick Check, Current architecture, Environment variables, Example MCP inputs, Known gaps, Prerequisites, Run a notified live smoke test (+4 more)

### Community 24 - "compilerOptions"
Cohesion: 0.17
Nodes (11): compilerOptions, esModuleInterop, module, moduleResolution, skipLibCheck, strict, target, include (+3 more)

### Community 25 - "Step-by-Step Continuation Prompt for ChatGPT or Gemini"
Cohesion: 0.17
Nodes (11): Backend, Current blocker, Current verified project status, Dashboard, How you must guide me, Immediate objective, Important project rules, Project location (+3 more)

### Community 26 - "check-everything.ps1"
Cohesion: 0.36
Nodes (8): Add-Result(), Check-Http(), Run-Step(), Section(), Start-App(), Stop-StartedApps(), Test-CommandExists(), Wait-Http()

### Community 27 - "graphify reference: extra exports and benchmark"
Cohesion: 0.22
Nodes (8): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7a - FalkorDB export (only if --falkordb or --falkordb-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

### Community 29 - "ThemeProvider.tsx"
Cohesion: 0.24
Nodes (7): metadata, ThemeToggle(), Theme, ThemeContext, ThemeContextType, ThemeProvider(), useTheme()

### Community 30 - "graphify reference: query, path, explain"
Cohesion: 0.33
Nodes (5): For /graphify explain, For /graphify path, graphify reference: query, path, explain, Step 0 — Constrained query expansion (REQUIRED before traversal), Step 1 — Traversal

### Community 31 - "DashboardSkeleton.tsx"
Cohesion: 0.40
Nodes (4): Skeleton(), SkeletonProps, DashboardSkeleton(), skeletonBarHeights

### Community 32 - "process_user_logo.js"
Cohesion: 0.40
Nodes (5): fs, outputDir, path, processLogo(), sharp

### Community 33 - "Flowboard Dashboard"
Cohesion: 0.40
Nodes (4): Flowboard Dashboard, Run locally, Supabase history, Verification

### Community 34 - "generate_logos.js"
Cohesion: 0.40
Nodes (4): fs, fullLogoDarkSvg, path, publicDir

### Community 35 - "graphify reference: add a URL and watch a folder"
Cohesion: 0.50
Nodes (3): For /graphify add, For --watch, graphify reference: add a URL and watch a folder

### Community 36 - "graphify reference: commit hook and native CLAUDE.md integration"
Cohesion: 0.50
Nodes (3): For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration

### Community 37 - "graphify reference: incremental update and cluster-only"
Cohesion: 0.50
Nodes (3): For --cluster-only, For --update (incremental re-extraction), graphify reference: incremental update and cluster-only

### Community 38 - "generate_poweredby.js"
Cohesion: 0.50
Nodes (3): fs, path, publicDir

## Knowledge Gaps
- **259 isolated node(s):** `name`, `version`, `description`, `type`, `main` (+254 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `generateProductionPlan()` connect `supabaseService.ts` to `dynamicPlanService.ts`, `planWorkspaceService.ts`, `whatsappBot.ts`, `server.ts`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `PlanTable()` connect `AdminPlanDetailsPanel.tsx` to `adminTypes.ts`, `devDependencies`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Why does `react` connect `devDependencies` to `AdminPlanDetailsPanel.tsx`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _259 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `dynamicPlanService.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05351170568561873 - nodes in this community are weakly interconnected._
- **Should `planWorkspaceService.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07715260017050299 - nodes in this community are weakly interconnected._
- **Should `whatsappBot.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.059907834101382486 - nodes in this community are weakly interconnected._