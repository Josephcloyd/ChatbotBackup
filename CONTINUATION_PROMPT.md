# Project Continuation Prompt

You are continuing development of the **Chatbot2ProPl Production Planner** project located at:

`C:\Users\Joseph Clyde\OneDrive\Desktop\Cloy's\GitHub\ChatbotBackup`

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

## Implementation update (July 13, 2026)

Recent local verification and WhatsApp demo improvements were completed:

- Backend tests pass: `npm.cmd test` reports 24 passed, 0 failed.
- Backend TypeScript checking passes: `npm.cmd run typecheck`.
- Dashboard TypeScript checking and production build pass.
- Backend live health and plan-history endpoints were verified locally.
- Supabase is configured and `/api/plans` returns existing saved production plans.
- Dashboard API routes are protected by Flowboard login; `test-e2e.ps1` was corrected to authenticate before checking dashboard planner routes.
- WhatsApp demo bot exists using `whatsapp-web.js` and `LocalAuth`.
- WhatsApp bot is limited to the configured group name, defaulting to `test bot`.
- WhatsApp bot now normalizes bot mentions, so messages like `@bot ping` work.
- WhatsApp bot can answer simple social prompts such as `who are you?` and `help`.
- WhatsApp bot can answer simple two-number math prompts without using `eval`.
- WhatsApp bot sends generated workbooks as a document attachment named `ProductionFile.xlsx` instead of relying only on a link.

## Missing, incomplete, or risky areas

1. WhatsApp currently uses a local `whatsapp-web.js` demo session, not an official provider/webhook integration. This is useful for local testing but is not production-grade.
2. Supabase is configured locally, but production policies, backups, migrations workflow, and environment separation are still not fully documented.
3. Workbook downloads work locally and WhatsApp can send the workbook file, but production authentication, object storage policy, expiry, and access control need hardening.
4. `Accounts Details` contains a duplicate `Type` header. Do not populate credential/account sheets.
5. The server still lacks request authentication, rate limiting, structured/redacted logging, and cleanup/retention for generated files.
6. There are no Ollama contract tests with a mock server, failure-path tests for workbook output, or tests for concurrent generation requests.
7. The root `.git` directory is present but is not recognized as a valid Git repository. Do not delete or recreate it without explicit user approval.

## Recommended enhancement backlog

Prioritize these enhancements after confirming the current WhatsApp and dashboard flow still works end to end.

### Highest priority

1. Add WhatsApp access controls beyond group name.
   - Allow only approved group IDs, not only group display names.
   - Add an allowlist of approved sender phone numbers or roles.
   - Log ignored messages without exposing message contents unnecessarily.
   - Add a command such as `status` that explains whether the bot is active in the current group.

2. Add a real WhatsApp provider path for production.
   - Decide between Meta WhatsApp Cloud API, Twilio, or keeping `whatsapp-web.js` only for local demos.
   - For Cloud API/Twilio, verify webhook signatures, handle retries, and make generation idempotent.
   - Keep the current local bot as a development-only adapter.

3. Improve document delivery reliability.
   - Keep sending `ProductionFile.xlsx` in WhatsApp, but also store the workbook in Supabase Storage.
   - Return a signed fallback URL if WhatsApp document upload fails.
   - Add a size check and clear failure message if the workbook is too large to send.

4. Add generation job tracking.
   - Store request status as `queued`, `generating`, `completed`, or `failed`.
   - Prevent duplicate generation when the same WhatsApp message is retried.
   - Show job progress in Flowboard history.

### Product and UX

5. Add richer WhatsApp commands.
   - `help` lists available commands.
   - `status` checks bot, Ollama, and Supabase readiness.
   - `recent plans` shows the latest saved plans for the current WhatsApp sender.
   - `download latest` resends the most recent workbook document.
   - `cancel` cancels a queued request when cancellation becomes available.

6. Make Flowboard history more useful.
   - Search and filter plans by user, project name, date, and workbook mode.
   - Add a detail page for one saved plan.
   - Add a resend-to-WhatsApp action for saved workbooks.
   - Add visible status badges for Ollama, Supabase, and WhatsApp bot readiness.

7. Add better production-plan templates and domains.
   - Student enrollment and subject encoding.
   - Department operations planning.
   - Product line or manufacturing production.
   - QA-heavy annotation and review projects.
   - Event preparation and staffing plans.

8. Improve workbook output.
   - Add a cover sheet with project title, generated date, owner, and status.
   - Add data validation dropdowns for status fields.
   - Add conditional formatting for overdue, blocked, and high-risk rows.
   - Add a printable one-page summary sheet.

### Reliability, safety, and operations

9. Add authentication and rate limiting to backend REST endpoints.
   - Dashboard routes already require login, but backend endpoints should also protect direct access.
   - Add per-user or per-group generation limits.
   - Add payload size and frequency limits for WhatsApp requests.

10. Add observability and safer logs.
   - Add structured logs with request IDs.
   - Redact secrets, phone numbers when possible, and long user prompts.
   - Add timing metrics for Ollama, workbook generation, Supabase insert, and WhatsApp send.

11. Add cleanup and retention.
   - Delete old local workbook files after a configurable period.
   - Expire or rotate Supabase Storage files.
   - Keep database records while removing stale binary files if storage cost matters.

12. Add stronger tests.
   - Unit-test WhatsApp message parsing and access rules.
   - Add integration tests for Supabase history reads/writes with a mocked client.
   - Add a mock Ollama contract test.
   - Add concurrency tests for multiple generation requests.
   - Add a smoke test that verifies workbook attachment logic without sending a real WhatsApp message.

13. Add deployment documentation.
   - Document local demo mode separately from production provider mode.
   - Document required env vars for backend, dashboard, Supabase, Ollama, and WhatsApp.
   - Add a troubleshooting section for QR login, Chrome path, Ollama model missing, Supabase table missing, and workbook send failures.

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

- Keep the current `whatsapp-web.js` bot as a local demo adapter unless the user explicitly chooses it for ongoing local-only use.
- If moving to production, implement the chosen provider only after checking existing project configuration or receiving the provider choice from the user.
- Verify webhook signatures, normalize inbound messages, map sender IDs safely, handle retries/idempotency, and send the summary plus workbook document/link.
- Preserve the group restriction behavior and upgrade it from group name to stable group ID where possible.
- Do not invent provider credentials or silently choose a paid service.

### Phase 5 — Production hardening

- Add authentication/authorization, rate limits, redacted structured logs, graceful shutdown, concurrency controls, observability, and deployment documentation.
- Run unit, integration, typecheck, build, and one live smoke test. Record exact commands and outcomes.

## Immediate objective for this continuation

First verify the current local end-to-end flow: backend, dashboard login, Supabase history, WhatsApp group restriction, mention-based `ping`, simple social/math replies, production-plan generation, and WhatsApp workbook attachment named `ProductionFile.xlsx`. Then pick the next highest-priority item from the Recommended enhancement backlog. Do not populate or expose credential sheets. Preserve the official Excel template, existing formulas, formatting, hidden-sheet state, and user data.

At the end, report:

- files changed;
- behavior added or corrected;
- tests/builds run and their exact pass/fail counts;
- remaining blockers and risks;
- the single best next task.
