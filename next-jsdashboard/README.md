# Flowboard Dashboard

Flowboard is the visualization interface for the production-planner MCP backend.

## Run locally

Start the backend first:

```powershell
cd path\to\Chatbot2ProPl\mcp-server
Copy-Item .env.example .env
npm.cmd install
npm.cmd start
```

Then start the dashboard in another PowerShell window:

```powershell
cd path\to\Chatbot2ProPl\next-jsdashboard
Copy-Item .env.example .env.local
npm.cmd install
npm.cmd run dev
```

Open `http://localhost:3000`.

The browser calls same-origin Next.js API routes. Those routes proxy to the backend URL in `PLANNER_API_URL`, so backend credentials are never exposed to browser JavaScript.

Set `FLOWBOARD_ACCESS_PASSWORD` and a `FLOWBOARD_SESSION_SECRET` of at least 16 characters in `next-jsdashboard/.env.local`; the dashboard login flow requires both.

Do not put Supabase service-role credentials in `next-jsdashboard/.env.local`. Supabase credentials belong only in `mcp-server/.env`.

## Supabase history

Apply the SQL files in `mcp-server/supabase/migrations` in numeric order, then set these values in `mcp-server/.env`. The dashboard and backend expect the tables and columns added by `002_admin_dashboard_enhancements.sql`. Migration `004_repair_external_identity_column_types.sql` repairs older databases that stored WhatsApp IDs as UUIDs. Applying only `001_create_production_plans.sql` can make plan saves fail.

```dotenv
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Restart the MCP server. The dashboard badge changes to `Supabase connected`, and saved plans appear in Recent production plans. Never place the service-role key in `next-jsdashboard/.env.local` or any `NEXT_PUBLIC_*` variable.

## Verification

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
```
