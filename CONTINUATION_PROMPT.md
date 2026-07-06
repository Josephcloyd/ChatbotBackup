# Project Continuation Prompt

You are continuing development of the **Chatbot2ProPl Production Planner** project located at:

`C:\Users\Allison rose\Desktop\JC\Chatbot2ProPl`

Act as the lead full-stack engineer. Inspect the existing source before changing anything, preserve working behavior, and implement the next highest-priority missing pieces. Do not merely describe changes: make them, test them, and report exact results.

## Project goal

Build an end-to-end production-planning assistant that accepts a project description (eventually through WhatsApp and/or a dashboard), uses a local Ollama model to create a realistic production plan, supports both official-template and template-free dynamic workbooks, optionally stores the plan in Supabase, and gives the user a usable response and workbook link/file.

## Implementation update (July 6, 2026)

The Phase 1 backend baseline has now been implemented:

- Added validated central configuration and a `/health` readiness endpoint.
- Refactored the HTTP server for graceful shutdown and deterministic endpoint testing.
- Anchored generation to the current planning date and added rules that reject past dates, duplicate dates, fabricated future actuals, incorrect requested durations, and incorrect requested total hours.
- Added a Supabase migration and now derives stored total-hour and team-size estimates from target rows.
- Added a root README, safe `.gitignore`, setup instructions, architecture, environment documentation, and known gaps.
- Added dual workbook modes: official-template mode and template-free dynamic mode.
- Dynamic mode parses day/week/month duration, team size, total hours, start date, and weekday/calendar scheduling constraints, then generates exact schedules and formulas in deterministic code.
- Dynamic workbooks include Executive Summary, Production Plan, Monthly Summary, Phases & Risks, and Assumptions sheets.
- Expanded verification to 15 passing tests; TypeScript type-checking and formula/visual QA across all five dynamic sheets pass.
- Added the Flowboard Next.js dashboard with an Ollama control panel, centered visualization board, Excel downloads, responsive layout, and Supabase history state.
- Added backend REST generation/history endpoints and validated non-guessable workbook downloads. The dashboard passes lint, type-checking, and production build; a live Next.js-to-Ollama generation returned the exact requested rows and hours.

## Current verified status (July 6, 2026)

- `mcp-server` is a TypeScript MCP server exposed through streamable HTTP at `http://localhost:3001/mcp`.
- It registers `generate_production_plan` with `whatsappUserId`, `projectDescription`, and optional `workbookMode` inputs.
- `workbookMode: "template"` fills the official workbook; `workbookMode: "dynamic"` creates a new professional workbook without reading a template.
- The dynamic pipeline is: extract constraints -> ask Ollama for compact project context -> deterministically generate dates and allocate hours -> validate business rules -> create formulas and styling -> optionally persist -> return a summary and local workbook path.
- The official template exists at `mcp-server/src/templates/ProductionPlanTemplate.xlsx`.
- The intended visible target sheet is `Production Plan`; detail and account sheets already contain data and are hidden.
- A generated workbook exists in `mcp-server/outputs`, proving that generation has worked at least once.
- `npm.cmd test` passes all 15 tests.
- `npm.cmd run typecheck` passes with no TypeScript errors.
- Ollama response parsing supports normal JSON and streamed NDJSON and has unit coverage.
- Template inspection, strict validation, formula preservation, formatting preservation, and workbook writing have an integration-style test.
- Supabase failure is intentionally non-fatal, so a workbook can still be returned without database credentials.

## Missing, incomplete, or risky areas

1. There is no WhatsApp provider/webhook integration. `whatsappUserId` is only an input field; the system does not receive or send actual WhatsApp messages.
2. Supabase code, schema, and dashboard history are implemented, but local credentials are not configured yet.
3. Workbook downloads work locally through non-guessable URLs, but production authentication, object storage, expiry, and access control are not implemented.
4. `Accounts Details` contains a duplicate `Type` header. Do not populate credential/account sheets.
5. The server still lacks request authentication, rate limiting, structured/redacted logging, and cleanup/retention for generated files.
6. There are no Ollama contract tests with a mock server, failure-path tests for workbook output, or tests for concurrent generation requests.
7. The root `.git` directory is present but is not recognized as a valid Git repository. Do not delete or recreate it without explicit user approval.

## Work order

Proceed in small, testable phases:

### Phase 1 — Make the backend reproducible and trustworthy (baseline completed)

- Add a clear root README and setup/run instructions.
- Add configuration validation and a health/readiness endpoint that reports dependencies without leaking secrets.
- Improve the generation prompt and validation so dates are current/future when appropriate, requested duration/hours are honored, target fields are planned, and unknown future actuals remain blank/zero rather than fabricated.
- Add deterministic tests for those business rules and for the MCP HTTP endpoint.
- Add the Supabase SQL migration/schema and either derive summary fields correctly or remove misleading hard-coded values.
- Fix encoding artifacts in source comments/messages.

### Phase 2 — Deliver generated workbooks properly (local baseline completed)

- Add a safe file-serving/download mechanism or object-storage upload that returns a usable URL.
- Use non-guessable identifiers, validate paths, set correct Excel content type, and define file expiry/cleanup.
- Never expose arbitrary local filesystem paths to remote users.

### Phase 3 — Build the dashboard (completed)

- Scaffold the empty `next-jsdashboard` as a current stable Next.js TypeScript application.
- Create a focused UI for project description and user ID, generation progress, validation/error feedback, result summary, and workbook download.
- Connect it through a server-side route to the MCP server; do not expose Supabase service-role credentials or unrestricted backend access in browser code.
- Add basic component/API tests and document how to run both applications together.

### Phase 4 — WhatsApp integration

- Implement the chosen provider only after checking existing project configuration or receiving the provider choice from the user.
- Verify webhook signatures, normalize inbound messages, map sender IDs safely, handle retries/idempotency, and send the summary plus workbook document/link.
- Do not invent provider credentials or silently choose a paid service.

### Phase 5 — Production hardening

- Add authentication/authorization, rate limits, redacted structured logs, graceful shutdown, concurrency controls, observability, and deployment documentation.
- Run unit, integration, typecheck, build, and one live smoke test. Record exact commands and outcomes.

## Immediate objective for this continuation

First configure and verify Supabase with real project credentials. Then choose between production-grade authenticated object storage and Phase 4 WhatsApp integration. Do not begin WhatsApp integration until the provider is known. Do not populate or expose credential sheets. Preserve the official Excel template, existing formulas, formatting, hidden-sheet state, and user data.

At the end, report:

- files changed;
- behavior added or corrected;
- tests/builds run and their exact pass/fail counts;
- remaining blockers and risks;
- the single best next task.
