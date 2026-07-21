# Chatbot2ProPl Production Planner

Chatbot2ProPl is an early-stage production-planning assistant. Its working backend accepts a project description through MCP, asks a local Ollama model for planning context, creates and validates the schedule, writes an Excel workbook, and optionally stores the result in Supabase.

It supports two workbook modes:

- `template` preserves and fills the official company workbook.
- `dynamic` needs no external template and creates a professional workbook with an executive summary, editable production schedule, monthly rollups, phases, risks, assumptions, formulas, and input validation.

The repository now includes the Flowboard Next.js dashboard and a local WhatsApp Web demo bot.

## Current architecture

```text
OpenClaw / MCP client -> reads openclaw.json -> POST /mcp
    -> generate_production_plan -> Ollama proposal
    -> template mode -> official workbook validation and filling
    -> dynamic mode  -> deterministic schedule and workbook generation
    -> business-rule validation -> optional Supabase record
```

OpenClaw is not part of the production-planning logic itself. It is the
configured MCP client entry point for this repository. The root
`openclaw.json` file points OpenClaw to the backend MCP endpoint at
`http://localhost:3001/mcp` using the `streamable-http` transport. From there,
OpenClaw can call the backend's `generate_production_plan` tool. Any other
MCP-compatible client could call the same endpoint, which is why the backend is
described generically as an MCP server.

In template mode, the official workbook at `mcp-server/src/templates/ProductionPlanTemplate.xlsx` is the source of truth for sheet names, headers, formulas, styles, and hidden-sheet state. Dynamic mode does not read that file.

## Prerequisites

- Node.js 20 or newer
- npm
- [Ollama](https://ollama.com/) running locally
- The configured Ollama model (default: `qwen3:4b`)
- Optional: a Supabase project for plan history

## Setup

From PowerShell:

```powershell
git clone <your-main-repository-url>
cd Chatbot2ProPl

cd mcp-server
npm.cmd install
Copy-Item .env.example .env
ollama pull qwen3:4b
npm.cmd start
```

The MCP endpoint is `http://127.0.0.1:3001/mcp`. Health information is available at `http://127.0.0.1:3001/health`.

Start the dashboard in a second PowerShell window:

```powershell
cd path\to\Chatbot2ProPl\next-jsdashboard
Copy-Item .env.example .env.local
npm.cmd install
npm.cmd run dev
```

Open `http://localhost:3000`. The dashboard provides the Ollama request panel, production-plan visualization, Excel download, and Supabase-backed history when credentials are configured.

Node does not automatically load `.env` in every runtime. Either export the variables before starting the server or start Node with an environment-file option. The defaults work for a local Ollama instance; Supabase is optional.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `MCP_PORT` | `3001` | HTTP server port |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama HTTP API |
| `OLLAMA_MODEL` | `qwen3:4b` | Generation model |
| `OLLAMA_NUM_PREDICT` | `8192` | Maximum generated tokens |
| `OLLAMA_TIMEOUT_MS` | `600000` | Generation timeout |
| `SUPABASE_URL` | none | Optional Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | none | Optional server-only database key |
| `SUPABASE_WORKBOOK_BUCKET` | none | Optional Supabase Storage bucket for generated workbooks |
| `SUPABASE_SIGNED_URL_EXPIRES_IN_SECONDS` | `3600` | Optional workbook signed URL lifetime |
| `WHATSAPP_CLIENT_ID` | auto/reuse existing | Local WhatsApp Web session name under `.wwebjs_auth`; leave blank unless setting up a new session intentionally |
| `WHATSAPP_ALLOWED_GROUP_ID` | none | Optional exact WhatsApp group ID to allow |
| `WHATSAPP_ALLOWED_GROUP_NAME` | `test bot` | Temporary group-name fallback before the group ID is known |
| `WHATSAPP_BOT_MENTION_NAME` | `wil alt` | Display-name mention the bot responds to |
| `WHATSAPP_BOT_MENTION_ID` | none | Optional comma-separated mention IDs for the bot |
| `WHATSAPP_LOG_FULL_GROUP_ID` | `1` in example | Prints full group IDs during first-run setup |
| `WHATSAPP_CHROME_PATH` | auto-detected | Optional path to Chrome when it is installed somewhere unusual |
| `WHATSAPP_HEADLESS` | `1` | Keeps Chrome hidden during WhatsApp bot runs; set to `0` only for QR/login troubleshooting |
| `WHATSAPP_AUTH_TIMEOUT_MS` | `120000` | Startup wait time for WhatsApp Web internals |
| `WHATSAPP_USER_AGENT` | modern Windows Chrome | Optional override for WhatsApp Web browser user agent |

Never place `SUPABASE_SERVICE_ROLE_KEY` in browser code or commit a real `.env` file.

Dashboard-only variables belong in `next-jsdashboard/.env.local`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PLANNER_API_URL` | `http://127.0.0.1:3001` | Backend API URL used by Next.js routes |
| `FLOWBOARD_ACCESS_PASSWORD` | none | Password accepted by the dashboard login page |
| `FLOWBOARD_SESSION_SECRET` | none | At least 16 characters; signs the dashboard session cookie |

## Collaborator Quick Check

After copying the example env files, collaborators can run the repo check from the repository root:

```powershell
.\check-everything.ps1 -Install
```

To start both apps during the check:

```powershell
.\check-everything.ps1 -Install -StartApps -KeepAppsRunning
```

## Supabase

Apply `mcp-server/supabase/migrations/001_create_production_plans.sql` in the Supabase SQL editor or migration workflow. The service-role key is used only by the backend. Database failure is non-fatal: workbook generation still succeeds.

## WhatsApp Web Demo Bot

The WhatsApp bot uses `whatsapp-web.js` and Chrome through Puppeteer. It is intended for local/manual testing, not production webhook hosting.

First run:

```powershell
cd mcp-server
npm.cmd run whatsapp:dev
```

Scan the QR code from WhatsApp with `Linked devices -> Link a device`. In the allowed test group, mention the bot:

```text
@wil alt ping
```

For the first setup, keep `WHATSAPP_ALLOWED_GROUP_ID` blank and `WHATSAPP_LOG_FULL_GROUP_ID=1` in `mcp-server/.env`. The bot will print the full group ID when it sees the configured fallback group name. Copy that ID into `WHATSAPP_ALLOWED_GROUP_ID`, set `WHATSAPP_LOG_FULL_GROUP_ID=0`, then restart the bot.

Plan generation test:

```text
@wil alt plan: Create a 1-week production plan for a student enrollment encoding project with 8 total hours.
```

If startup prints `WhatsApp client disconnected: LOGOUT`, `Execution context was destroyed`, or `EBUSY ... first_party_sets.db`, the local WhatsApp Web session is stale or locked by Chrome. Close the bot, close Chrome/WhatsApp Web, then delete these ignored local folders from `mcp-server`:

```powershell
Remove-Item -LiteralPath .wwebjs_auth\session-production-planner-v2 -Recurse -Force
Remove-Item -LiteralPath .wwebjs_cache -Recurse -Force
```

Then remove the old linked device in WhatsApp under `Linked devices`, rerun `npm.cmd run whatsapp:dev`, and scan the QR again.

If the bot asks for QR even though WhatsApp still shows it as linked, check `WHATSAPP_CLIENT_ID`. Changing that value changes the local session folder. Leave it blank to let the bot reuse an existing `session-production-planner-demo` or `session-production-planner-v2` folder automatically.

On a new collaborator machine, QR is expected once because `.wwebjs_auth` is local and is not pushed to Git. By default, `WHATSAPP_HEADLESS=1` keeps Chrome hidden and the QR code prints in the terminal. If the terminal reaches `Failed to initialize: TimeoutError`, temporarily set `WHATSAPP_HEADLESS=0` to debug the WhatsApp Web screen, then close Chrome, remove the stale folders above, and run `npm.cmd run whatsapp:dev` again.

## Verification

```powershell
cd mcp-server
npm.cmd test
npm.cmd run typecheck
```

Tests cover Ollama JSON/NDJSON parsing, both workbook modes, template preservation, dynamic formulas and styling, flexible constraints, semantic plan rules, health reporting, and MCP initialization over HTTP.

## Run a notified live smoke test

Start the MCP server in one PowerShell window, then run this in a second window:

```powershell
cd mcp-server
npm.cmd run smoke
```

The command waits for Ollama and then prints and sounds a terminal notification:

- `✅ DONE` means the plan and workbook were generated.
- `❌ FAILED` means the health check or generation failed; the error follows the notification.

It exits with code `0` on success and `1` on failure, so it can also be used by automation. The request can be edited in `mcp-server/call-tool.json` before running it. Restart the MCP server after changing application code.

## Example MCP inputs

Dynamic mode, without a template:

```json
{
  "whatsappUserId": "dashboard-test",
  "workbookMode": "dynamic",
  "projectDescription": "Create a production plan for a class of 4 annotators over 4 calendar months with 400 total hours, starting today."
}
```

Template mode:

```json
{
  "whatsappUserId": "dashboard-test",
  "workbookMode": "template",
  "projectDescription": "Create a production plan for a data annotation project with a 30-day duration and 60 total hours."
}
```

If `workbookMode` is omitted, `template` is used for backward compatibility. Dynamic constraints recognize days, weeks, calendar months, total hours, team/class size, ISO or named start dates, weekdays-only schedules, and calendar-day schedules. Target hours are distributed exactly and future actuals remain editable and blank.

To create the verified dynamic demonstration workbook without calling Ollama:

```powershell
npm.cmd run demo:dynamic
```

The demonstration output is written under `mcp-server/outputs/dual-mode-demo`.

## Known gaps

- The WhatsApp integration is a local WhatsApp Web demo bot, not a production webhook/provider integration.
- Ollama reachability is checked only when generation runs; `/health` reports configuration and template readiness.
- Authentication, rate limiting, file retention, object storage, and production deployment are not implemented. Workbook URLs are non-guessable local-development links, not a production authorization system.
- The root `.git` directory is not currently recognized as a valid Git repository; it has deliberately not been modified.

See `CONTINUATION_PROMPT.md` for the broader delivery roadmap.
