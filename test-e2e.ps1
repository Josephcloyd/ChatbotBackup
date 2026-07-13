# ============================================================
# End-to-end repo test runner
# Project:
# C:\Users\Joseph Clyde\OneDrive\Desktop\Cloy's\GitHub\ChatbotBackup
# ============================================================

$ErrorActionPreference = "Continue"

$RepoRoot = "C:\Users\Joseph Clyde\OneDrive\Desktop\Cloy's\GitHub\ChatbotBackup"
$BackendDir = Join-Path $RepoRoot "mcp-server"
$DashboardDir = Join-Path $RepoRoot "next-jsdashboard"

$Report = [ordered]@{
  "Backend npm install" = "not run"
  "Backend tests" = "not run"
  "Backend typecheck" = "not run"
  "Backend health" = "not run"
  "Template readiness" = "unknown"
  "Ollama configured" = "unknown"
  "Ollama reachable" = "not run"
  "Ollama model exists" = "not run"
  "Supabase connected" = "not run"
  "Supabase insert" = "not run"
  "Workbook bucket" = "not run"
  "Workbook signed URL" = "not run"
  "Dashboard npm install" = "not run"
  "Dashboard lint" = "not run"
  "Dashboard typecheck" = "not run"
  "Dashboard build" = "not run"
  "Dashboard local run" = "not run"
  "Dashboard reaches backend" = "not run"
  "WhatsApp QR/auth" = "manual"
  "WhatsApp ping reply" = "manual"
  "WhatsApp plan reply" = "manual"
}

function MaskedEnvStatus($path, $keys) {
  if (!(Test-Path $path)) {
    Write-Host "Missing env file: $path" -ForegroundColor Yellow
    return
  }

  $content = Get-Content $path

  foreach ($key in $keys) {
    $line = $content | Where-Object { $_ -match "^$key\s*=" } | Select-Object -First 1

    if ($line) {
      $value = ($line -split "=", 2)[1].Trim()

      if ([string]::IsNullOrWhiteSpace($value)) {
        Write-Host "$key = MISSING VALUE" -ForegroundColor Yellow
      } else {
        Write-Host "$key = present" -ForegroundColor Green
      }
    } else {
      Write-Host "$key = MISSING" -ForegroundColor Yellow
    }
  }
}

function ReadEnvValue($path, $key) {
  if (!(Test-Path $path)) {
    return $null
  }

  $line = Get-Content $path | Where-Object { $_ -match "^$key\s*=" } | Select-Object -First 1

  if (!$line) {
    return $null
  }

  return (($line -split "=", 2)[1].Trim()).Trim('"').Trim("'")
}

function RunStep($name, $scriptBlock) {
  Write-Host ""
  Write-Host "============================================================"
  Write-Host "Running: $name"
  Write-Host "============================================================"

  try {
    & $scriptBlock
    if ($LASTEXITCODE -eq 0 -or $null -eq $LASTEXITCODE) {
      Write-Host "PASS: $name" -ForegroundColor Green
      return "pass"
    } else {
      Write-Host "FAIL: $name with exit code $LASTEXITCODE" -ForegroundColor Red
      return "fail"
    }
  } catch {
    Write-Host "ERROR: $name" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    return "fail"
  }
}

Write-Host ""
Write-Host "Starting full repo test-run..." -ForegroundColor Cyan
Write-Host "Repo root: $RepoRoot"

if (!(Test-Path $RepoRoot)) {
  Write-Host "Repo path does not exist. Check the path and try again." -ForegroundColor Red
  exit 1
}

# ============================================================
# Backend
# ============================================================

if (!(Test-Path $BackendDir)) {
  Write-Host "Missing backend folder: $BackendDir" -ForegroundColor Red
} else {
  Set-Location $BackendDir

  if (!(Test-Path ".env") -and (Test-Path ".env.example")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created mcp-server\.env from .env.example" -ForegroundColor Yellow
  }

  Write-Host ""
  Write-Host "Checking backend env vars without printing values..." -ForegroundColor Cyan

  $BackendEnv = Join-Path $BackendDir ".env"
  $BackendRequired = @(
    "MCP_PORT",
    "OLLAMA_BASE_URL",
    "OLLAMA_MODEL",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_WORKBOOK_BUCKET"
  )

  MaskedEnvStatus $BackendEnv $BackendRequired

  $Report["Backend npm install"] = RunStep "Backend npm install" {
    npm.cmd install
  }

  $Report["Backend tests"] = RunStep "Backend npm test" {
    npm.cmd test
  }

  $Report["Backend typecheck"] = RunStep "Backend typecheck" {
    npm.cmd run typecheck
  }

  # Start backend in separate process
  Write-Host ""
  Write-Host "Starting backend..." -ForegroundColor Cyan

  $BackendProcess = Start-Process `
    -FilePath "npm.cmd" `
    -ArgumentList "start" `
    -WorkingDirectory $BackendDir `
    -PassThru `
    -WindowStyle Minimized

  Start-Sleep -Seconds 6

  try {
    $Health = Invoke-RestMethod "http://127.0.0.1:3001/health" -TimeoutSec 10
    $Report["Backend health"] = "pass"

    Write-Host "Backend health response received." -ForegroundColor Green
    $Health | ConvertTo-Json -Depth 10

    $healthJson = $Health | ConvertTo-Json -Depth 10

    if ($healthJson -match "template") {
      $Report["Template readiness"] = "present in health"
    } else {
      $Report["Template readiness"] = "not obvious in health"
    }

    if ($healthJson -match "ollama") {
      $Report["Ollama configured"] = "present in health"
    } else {
      $Report["Ollama configured"] = "not obvious in health"
    }

    if ($healthJson -match "supabase") {
      $Report["Supabase connected"] = "reported in health"
    } else {
      $Report["Supabase connected"] = "not obvious in health"
    }
  } catch {
    $Report["Backend health"] = "fail"
    Write-Host "Backend health check failed." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host "Likely fix: confirm MCP_PORT=3001, backend compiled, and npm start is valid." -ForegroundColor Yellow
  }

  # ============================================================
  # Ollama
  # ============================================================

  $OllamaBaseUrl = ReadEnvValue $BackendEnv "OLLAMA_BASE_URL"
  $OllamaModel = ReadEnvValue $BackendEnv "OLLAMA_MODEL"

  if (!$OllamaBaseUrl) {
    $OllamaBaseUrl = "http://127.0.0.1:11434"
  }

  if (!$OllamaModel) {
    $OllamaModel = "qwen3:4b"
  }

  Write-Host ""
  Write-Host "Checking Ollama without printing secrets..." -ForegroundColor Cyan
  Write-Host "Ollama base URL: $OllamaBaseUrl"
  Write-Host "Configured model: $OllamaModel"

  try {
    $TagsUrl = "$OllamaBaseUrl/api/tags"
    $Tags = Invoke-RestMethod $TagsUrl -TimeoutSec 10
    $Report["Ollama reachable"] = "yes"

    $Models = @($Tags.models | ForEach-Object { $_.name })
    if ($Models -contains $OllamaModel) {
      $Report["Ollama model exists"] = "yes"
      Write-Host "Ollama model exists: $OllamaModel" -ForegroundColor Green
    } else {
      $Report["Ollama model exists"] = "no"
      Write-Host "Ollama model missing: $OllamaModel" -ForegroundColor Yellow
      Write-Host "Suggested fix: ollama pull qwen3:4b" -ForegroundColor Yellow
    }
  } catch {
    $Report["Ollama reachable"] = "no"
    $Report["Ollama model exists"] = "unknown"
    Write-Host "Ollama is not reachable at $OllamaBaseUrl" -ForegroundColor Red
    Write-Host "Likely fix: start Ollama, then run: ollama serve" -ForegroundColor Yellow
  }

  # ============================================================
  # Supabase smoke/generation
  # ============================================================

  $SupabaseUrl = ReadEnvValue $BackendEnv "SUPABASE_URL"
  $SupabaseKey = ReadEnvValue $BackendEnv "SUPABASE_SERVICE_ROLE_KEY"
  $SupabaseBucket = ReadEnvValue $BackendEnv "SUPABASE_WORKBOOK_BUCKET"

  Write-Host ""
  Write-Host "Checking Supabase config without printing values..." -ForegroundColor Cyan

  if (!$SupabaseUrl -or !$SupabaseKey) {
    $Report["Supabase connected"] = "no - env missing"
    $Report["Supabase insert"] = "not run"
    $Report["Workbook bucket"] = "not run"
    $Report["Workbook signed URL"] = "not run"

    Write-Host "Supabase env vars missing. Add these to mcp-server\.env:" -ForegroundColor Yellow
    Write-Host "SUPABASE_URL=your-project-url"
    Write-Host "SUPABASE_SERVICE_ROLE_KEY=your-service-role-key"
    Write-Host "SUPABASE_WORKBOOK_BUCKET=production-workbooks"
    Write-Host ""
    Write-Host "Do NOT put SUPABASE_SERVICE_ROLE_KEY in next-jsdashboard\.env.local." -ForegroundColor Red
  } else {
    $MigrationPath = Join-Path $BackendDir "supabase\migrations\001_create_production_plans.sql"
    if (Test-Path $MigrationPath) {
      Write-Host "Migration exists: mcp-server/supabase/migrations/001_create_production_plans.sql" -ForegroundColor Green
      Write-Host "This migration appears required if production_plans table is not yet created." -ForegroundColor Yellow
    } else {
      Write-Host "Migration file not found at expected path." -ForegroundColor Yellow
    }

    try {
      $body = @{
        whatsappUserId = "local-e2e-test"
        workbookMode = "dynamic"
        projectDescription = "Create a 1-week production plan for a student enrollment encoding project with 8 total hours."
      } | ConvertTo-Json

      $Generation = Invoke-RestMethod `
        -Method Post `
        -Uri "http://127.0.0.1:3001/api/generate" `
        -ContentType "application/json" `
        -Body $body `
        -TimeoutSec 120

      Write-Host "Generation response received." -ForegroundColor Green
      $Generation | ConvertTo-Json -Depth 10

      $genJson = $Generation | ConvertTo-Json -Depth 10

      if ($genJson -match "supabase" -or $genJson -match "storage" -or $genJson -match "signed") {
        $Report["Supabase connected"] = "likely yes"
      } else {
        $Report["Supabase connected"] = "unknown from response"
      }

      if ($genJson -match "planId" -or $genJson -match "production_plans" -or $genJson -match "saved") {
        $Report["Supabase insert"] = "likely yes"
      } else {
        $Report["Supabase insert"] = "unknown/no"
      }

      if ($SupabaseBucket) {
        $Report["Workbook bucket"] = "configured"
      } else {
        $Report["Workbook bucket"] = "not configured"
      }

      if ($genJson -match "signedUrl" -or $genJson -match "workbookSignedUrl" -or $genJson -match "downloadUrl") {
        $Report["Workbook signed URL"] = "yes"
      } else {
        $Report["Workbook signed URL"] = "no"
      }
    } catch {
      $Report["Supabase insert"] = "fail or unavailable"
      $Report["Workbook signed URL"] = "no"
      Write-Host "Plan generation/Supabase integration test failed." -ForegroundColor Red
      Write-Host $_.Exception.Message -ForegroundColor Red
      Write-Host "Likely fixes: check Supabase table migration, bucket name, RLS/storage permissions, and backend logs." -ForegroundColor Yellow
    }
  }
}

# ============================================================
# Dashboard
# ============================================================

if (!(Test-Path $DashboardDir)) {
  Write-Host "Missing dashboard folder: $DashboardDir" -ForegroundColor Red
} else {
  Set-Location $DashboardDir

  if (!(Test-Path ".env.local") -and (Test-Path ".env.example")) {
    Copy-Item ".env.example" ".env.local"
    Write-Host "Created next-jsdashboard\.env.local from .env.example" -ForegroundColor Yellow
  }

  $DashboardEnv = Join-Path $DashboardDir ".env.local"

  Write-Host ""
  Write-Host "Checking dashboard env vars without printing secrets..." -ForegroundColor Cyan

  $PlannerApiUrl = ReadEnvValue $DashboardEnv "PLANNER_API_URL"
  $FlowPassword = ReadEnvValue $DashboardEnv "FLOWBOARD_ACCESS_PASSWORD"
  $FlowSecret = ReadEnvValue $DashboardEnv "FLOWBOARD_SESSION_SECRET"

  if (!$PlannerApiUrl) {
    Add-Content $DashboardEnv "`nPLANNER_API_URL=http://127.0.0.1:3001"
    Write-Host "Added PLANNER_API_URL=http://127.0.0.1:3001 to .env.local" -ForegroundColor Yellow
  } elseif ($PlannerApiUrl -ne "http://127.0.0.1:3001") {
    Write-Host "PLANNER_API_URL is set but not http://127.0.0.1:3001. Current value hidden for safety." -ForegroundColor Yellow
  } else {
    Write-Host "PLANNER_API_URL is correctly set." -ForegroundColor Green
  }

  if (!$FlowPassword) {
    Write-Host "FLOWBOARD_ACCESS_PASSWORD is missing. Add it to next-jsdashboard\.env.local" -ForegroundColor Yellow
  } else {
    Write-Host "FLOWBOARD_ACCESS_PASSWORD is present." -ForegroundColor Green
  }

  if (!$FlowSecret -or $FlowSecret.Length -lt 16) {
    Write-Host "FLOWBOARD_SESSION_SECRET is missing or shorter than 16 characters." -ForegroundColor Red
    Write-Host "Add something like: FLOWBOARD_SESSION_SECRET=replace-with-at-least-16-random-chars" -ForegroundColor Yellow
  } else {
    Write-Host "FLOWBOARD_SESSION_SECRET is present and long enough." -ForegroundColor Green
  }

  $Report["Dashboard npm install"] = RunStep "Dashboard npm install" {
    npm.cmd install
  }

  $Report["Dashboard lint"] = RunStep "Dashboard lint" {
    npm.cmd run lint
  }

  $Report["Dashboard typecheck"] = RunStep "Dashboard typecheck" {
    npm.cmd run typecheck
  }

  $Report["Dashboard build"] = RunStep "Dashboard build" {
    npm.cmd run build
  }

  Write-Host ""
  Write-Host "Starting dashboard dev server..." -ForegroundColor Cyan

  $DashboardProcess = Start-Process `
    -FilePath "npm.cmd" `
    -ArgumentList "run dev" `
    -WorkingDirectory $DashboardDir `
    -PassThru `
    -WindowStyle Minimized

  Start-Sleep -Seconds 8

  try {
    $DashboardHome = Invoke-WebRequest "http://localhost:3000" -TimeoutSec 10
    if ($DashboardHome.StatusCode -ge 200 -and $DashboardHome.StatusCode -lt 500) {
      $Report["Dashboard local run"] = "yes"
      Write-Host "Dashboard is reachable at http://localhost:3000" -ForegroundColor Green
    }
  } catch {
    $Report["Dashboard local run"] = "no"
    Write-Host "Dashboard local run failed." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
  }

  try {
    if (!$FlowPassword) {
      throw "FLOWBOARD_ACCESS_PASSWORD is missing; cannot authenticate dashboard API checks."
    }

    $DashboardSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $LoginBody = @{ password = $FlowPassword } | ConvertTo-Json

    Invoke-RestMethod `
      -Method Post `
      -Uri "http://localhost:3000/api/auth/login" `
      -ContentType "application/json" `
      -Body $LoginBody `
      -WebSession $DashboardSession `
      -TimeoutSec 15 | Out-Null

    $PlannerHealth = Invoke-RestMethod `
      -Uri "http://localhost:3000/api/planner/health" `
      -WebSession $DashboardSession `
      -TimeoutSec 15

    $PlannerPlans = Invoke-RestMethod `
      -Uri "http://localhost:3000/api/planner/plans" `
      -WebSession $DashboardSession `
      -TimeoutSec 15

    $Report["Dashboard reaches backend"] = "yes"
    Write-Host "Dashboard API can reach backend." -ForegroundColor Green
    $PlannerHealth | ConvertTo-Json -Depth 10

    if ($PlannerPlans.configured -eq $true) {
      Write-Host "Dashboard API can read Supabase-backed plan history." -ForegroundColor Green
    } else {
      Write-Host "Dashboard API reached backend, but Supabase is not configured." -ForegroundColor Yellow
    }
  } catch {
    $Report["Dashboard reaches backend"] = "no"
    Write-Host "Dashboard API could not reach backend." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host "Likely fix: confirm backend is running on 127.0.0.1:3001, PLANNER_API_URL is correct, and dashboard login env vars are present." -ForegroundColor Yellow
  }
}

# ============================================================
# WhatsApp manual startup
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "WhatsApp demo bot manual test"
Write-Host "============================================================"
Write-Host "Run this in a separate terminal:"
Write-Host ""
Write-Host "cd `"$BackendDir`""
Write-Host "npm.cmd run whatsapp:dev"
Write-Host ""
Write-Host "Confirm the QR code appears."
Write-Host "Scan it with:"
Write-Host "WhatsApp → Linked devices → Link a device"
Write-Host ""
Write-Host "After scan, logs should show authenticated/ready."
Write-Host ""
Write-Host "From a different WhatsApp account, send:"
Write-Host "ping"
Write-Host ""
Write-Host "Then send:"
Write-Host "plan: Create a 1-week production plan for a student enrollment encoding project with 8 total hours."
Write-Host ""
Write-Host "Expected result:"
Write-Host "- ping should get a simple bot reply"
Write-Host "- plan should trigger backend generation"
Write-Host "- successful response should include plan summary and/or workbook link"

# ============================================================
# Final report
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "FINAL CHECKLIST"
Write-Host "============================================================"

foreach ($item in $Report.GetEnumerator()) {
  Write-Host ("{0}: {1}" -f $item.Key, $item.Value)
}

Write-Host ""
Write-Host "Security reminder:" -ForegroundColor Cyan
Write-Host "- Do not print SUPABASE_SERVICE_ROLE_KEY."
Write-Host "- Do not place SUPABASE_SERVICE_ROLE_KEY in next-jsdashboard\.env.local."
Write-Host "- Only backend mcp-server\.env should use the service role key."
