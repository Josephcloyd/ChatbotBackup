# Flowboard Dashboard

Flowboard is the visualization interface for the production-planner MCP backend.

## Run locally

Start the backend first:

```powershell
cd "C:\Users\Allison rose\Desktop\JC\Chatbot2ProPl\mcp-server"
npm.cmd start
```

Then start the dashboard in another PowerShell window:

```powershell
cd "C:\Users\Allison rose\Desktop\JC\Chatbot2ProPl\next-jsdashboard"
Copy-Item .env.example .env.local
npm.cmd install
npm.cmd run dev
```

Open `http://localhost:3000`.

The browser calls same-origin Next.js API routes. Those routes proxy to the backend URL in `PLANNER_API_URL`, so backend credentials are never exposed to browser JavaScript.

## Supabase history

Apply the migration at `mcp-server/supabase/migrations/001_create_production_plans.sql`, then set these values in `mcp-server/.env`:

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
