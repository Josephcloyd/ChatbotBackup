#requires -Version 5.1

[CmdletBinding()]
param(
  [switch]$Install,
  [switch]$StartApps,
  [switch]$Deep,
  [switch]$SkipBuild,
  [switch]$SkipTests,
  [switch]$KeepAppsRunning
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$RepoRoot = $PSScriptRoot
$ServerDir = Join-Path $RepoRoot "mcp-server"
$DashboardDir = Join-Path $RepoRoot "next-jsdashboard"
$ServerEnv = Join-Path $ServerDir ".env"
$DashboardEnv = Join-Path $DashboardDir ".env.local"
$DashboardEnvExample = Join-Path $DashboardDir ".env.example"
$DefaultServerUrl = "http://127.0.0.1:3001"
$DefaultDashboardUrl = "http://localhost:3000"
$Results = New-Object System.Collections.Generic.List[object]
$StartedProcesses = New-Object System.Collections.Generic.List[object]

function Add-Result {
  param(
    [string]$Name,
    [string]$Status,
    [string]$Detail = ""
  )

  $Results.Add([pscustomobject]@{
    Name = $Name
    Status = $Status
    Detail = $Detail
  }) | Out-Null

  $color = "White"
  if ($Status -eq "PASS") { $color = "Green" }
  if ($Status -eq "FAIL") { $color = "Red" }
  if ($Status -eq "WARN") { $color = "Yellow" }
  if ($Status -eq "SKIP") { $color = "DarkYellow" }

  if ($Detail) {
    Write-Host ("[{0}] {1} - {2}" -f $Status, $Name, $Detail) -ForegroundColor $color
  } else {
    Write-Host ("[{0}] {1}" -f $Status, $Name) -ForegroundColor $color
  }
}

function Section {
  param([string]$Title)
  Write-Host ""
  Write-Host "============================================================"
  Write-Host $Title
  Write-Host "============================================================"
}

function Read-EnvValue {
  param(
    [string]$Path,
    [string]$Key
  )

  if (!(Test-Path -LiteralPath $Path)) {
    return $null
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match "^\s*#" -or $line -match "^\s*$") {
      continue
    }

    if ($line -match ("^\s*" + [regex]::Escape($Key) + "\s*=(.*)$")) {
      return $Matches[1].Trim().Trim([char[]]@('"', "'"))
    }
  }

  return $null
}

function Test-CommandExists {
  param([string]$CommandName)

  if (Get-Command $CommandName -ErrorAction SilentlyContinue) {
    Add-Result "Command: $CommandName" "PASS"
    return $true
  }

  Add-Result "Command: $CommandName" "FAIL" "Not found in PATH"
  return $false
}

function Run-Step {
  param(
    [string]$Name,
    [string]$Directory,
    [string]$Command,
    [string[]]$Arguments
  )

  if (!(Test-Path -LiteralPath $Directory)) {
    Add-Result $Name "FAIL" "Missing directory: $Directory"
    return $false
  }

  Section $Name
  Push-Location $Directory
  try {
    & $Command @Arguments
    $exitCode = $LASTEXITCODE
    if ($null -eq $exitCode -or $exitCode -eq 0) {
      Add-Result $Name "PASS"
      return $true
    }

    Add-Result $Name "FAIL" "Exit code $exitCode"
    return $false
  } catch {
    Add-Result $Name "FAIL" $_.Exception.Message
    return $false
  } finally {
    Pop-Location
  }
}

function Wait-Http {
  param(
    [string]$Url,
    [int]$Seconds = 30
  )

  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 4
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return $true
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }

  return $false
}

function Check-Http {
  param(
    [string]$Name,
    [string]$Url,
    [string]$FailureStatus = "FAIL"
  )

  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10
    Add-Result $Name "PASS" ("HTTP " + $response.StatusCode)
    return $true
  } catch {
    Add-Result $Name $FailureStatus $_.Exception.Message
    return $false
  }
}

function Start-App {
  param(
    [string]$Name,
    [string]$Directory,
    [string]$Command,
    [string[]]$Arguments,
    [string]$HealthUrl
  )

  if (!(Test-Path -LiteralPath $Directory)) {
    Add-Result "Start $Name" "FAIL" "Missing directory: $Directory"
    return
  }

  Write-Host "Starting $Name..." -ForegroundColor Cyan
  try {
    $process = Start-Process `
      -FilePath $Command `
      -ArgumentList $Arguments `
      -WorkingDirectory $Directory `
      -PassThru `
      -WindowStyle Hidden

    $StartedProcesses.Add($process) | Out-Null

    if (Wait-Http $HealthUrl 45) {
      Add-Result "Start $Name" "PASS" $HealthUrl
    } else {
      Add-Result "Start $Name" "FAIL" "Did not respond at $HealthUrl"
    }
  } catch {
    Add-Result "Start $Name" "FAIL" $_.Exception.Message
  }
}

function Stop-StartedApps {
  if ($KeepAppsRunning) {
    Add-Result "Stop started apps" "SKIP" "KeepAppsRunning was provided"
    return
  }

  foreach ($process in $StartedProcesses) {
    try {
      if ($process -and !$process.HasExited) {
        Stop-Process -Id $process.Id -Force
      }
    } catch {
      Write-Host ("Could not stop process {0}: {1}" -f $process.Id, $_.Exception.Message) -ForegroundColor Yellow
    }
  }

  if ($StartedProcesses.Count -gt 0) {
    Add-Result "Stop started apps" "PASS" "Stopped processes launched by this script"
  }
}

try {
  Section "Repository"
  Add-Result "Repo root" ($(if (Test-Path -LiteralPath $RepoRoot) { "PASS" } else { "FAIL" })) $RepoRoot
  Add-Result "Server folder" ($(if (Test-Path -LiteralPath $ServerDir) { "PASS" } else { "FAIL" })) $ServerDir
  Add-Result "Dashboard folder" ($(if (Test-Path -LiteralPath $DashboardDir) { "PASS" } else { "FAIL" })) $DashboardDir

  Section "Tools"
  $hasNode = Test-CommandExists "node"
  $hasNpm = Test-CommandExists "npm.cmd"
  $hasOllama = Test-CommandExists "ollama"

  if (!$hasNode -or !$hasNpm) {
    Add-Result "Required tooling" "FAIL" "Install Node.js before running project checks"
  }

  Section "Environment Files"
  if (!(Test-Path -LiteralPath $ServerEnv) -and (Test-Path -LiteralPath (Join-Path $ServerDir ".env.example"))) {
    Add-Result "Server .env" "WARN" "Missing. Create it with: Copy-Item mcp-server\.env.example mcp-server\.env"
  } elseif (Test-Path -LiteralPath $ServerEnv) {
    Add-Result "Server .env" "PASS"
  } else {
    Add-Result "Server .env" "FAIL" "Missing .env and .env.example"
  }

  if (!(Test-Path -LiteralPath $DashboardEnv) -and (Test-Path -LiteralPath $DashboardEnvExample)) {
    Add-Result "Dashboard .env.local" "WARN" "Missing. Create it with: Copy-Item next-jsdashboard\.env.example next-jsdashboard\.env.local"
  } elseif (Test-Path -LiteralPath $DashboardEnv) {
    Add-Result "Dashboard .env.local" "PASS"
  } else {
    Add-Result "Dashboard .env.local" "FAIL" "Missing .env.local and .env.example"
  }

  $ollamaBaseUrl = Read-EnvValue $ServerEnv "OLLAMA_BASE_URL"
  if (!$ollamaBaseUrl) { $ollamaBaseUrl = "http://127.0.0.1:11434" }

  $ollamaModel = Read-EnvValue $ServerEnv "OLLAMA_MODEL"
  if (!$ollamaModel) { $ollamaModel = "qwen3:4b" }

  $plannerApiUrl = Read-EnvValue $DashboardEnv "PLANNER_API_URL"
  if (!$plannerApiUrl) { $plannerApiUrl = $DefaultServerUrl }

  Add-Result "Ollama base URL" "PASS" $ollamaBaseUrl
  Add-Result "Ollama model" "PASS" $ollamaModel
  Add-Result "Dashboard planner API URL" "PASS" $plannerApiUrl

  Section "Dependency Folders"
  if ($Install) {
    Run-Step "Server npm install" $ServerDir "npm.cmd" @("install") | Out-Null
    Run-Step "Dashboard npm install" $DashboardDir "npm.cmd" @("install") | Out-Null
  } else {
    Add-Result "Server node_modules" ($(if (Test-Path -LiteralPath (Join-Path $ServerDir "node_modules")) { "PASS" } else { "WARN" })) "Use -Install to run npm install"
    Add-Result "Dashboard node_modules" ($(if (Test-Path -LiteralPath (Join-Path $DashboardDir "node_modules")) { "PASS" } else { "WARN" })) "Use -Install to run npm install"
  }

  Section "Ollama"
  if ($hasOllama) {
    try {
      $tags = Invoke-RestMethod -Uri "$ollamaBaseUrl/api/tags" -TimeoutSec 10
      Add-Result "Ollama API" "PASS" "$ollamaBaseUrl/api/tags"

      $models = @($tags.models | ForEach-Object { $_.name })
      if ($models -contains $ollamaModel) {
        Add-Result "Ollama model installed" "PASS" $ollamaModel
      } else {
        Add-Result "Ollama model installed" "FAIL" "Run: ollama pull $ollamaModel"
      }
    } catch {
      Add-Result "Ollama API" "FAIL" "Start Ollama, then try: ollama serve"
    }
  } else {
    Add-Result "Ollama API" "SKIP" "ollama command is not available"
  }

  Section "Server Checks"
  if (!$SkipTests) {
    Run-Step "Server tests" $ServerDir "npm.cmd" @("test") | Out-Null
  } else {
    Add-Result "Server tests" "SKIP"
  }
  Run-Step "Server typecheck" $ServerDir "npm.cmd" @("run", "typecheck") | Out-Null

  Section "Dashboard Checks"
  Run-Step "Dashboard typecheck" $DashboardDir "npm.cmd" @("run", "typecheck") | Out-Null
  Run-Step "Dashboard lint" $DashboardDir "npm.cmd" @("run", "lint") | Out-Null
  if (!$SkipBuild) {
    Run-Step "Dashboard build" $DashboardDir "npm.cmd" @("run", "build") | Out-Null
  } else {
    Add-Result "Dashboard build" "SKIP"
  }

  Section "Running Apps"
  if ($StartApps) {
    Start-App "server" $ServerDir "npm.cmd" @("run", "dev") "$DefaultServerUrl/health"
    Start-App "dashboard" $DashboardDir "npm.cmd" @("run", "dev") $DefaultDashboardUrl
  } else {
    Check-Http "Server health if already running" "$DefaultServerUrl/health" "WARN" | Out-Null
    Check-Http "Dashboard if already running" $DefaultDashboardUrl "WARN" | Out-Null
  }

  Section "Deep Smoke Test"
  if ($Deep) {
    if ($StartApps -or (Wait-Http "$DefaultServerUrl/health" 5)) {
      try {
        $body = @{
          whatsappUserId = "local-check-everything"
          workbookMode = "dynamic"
          projectDescription = "Create a 1-week production plan for a student enrollment encoding project with 8 total hours."
        } | ConvertTo-Json

        $generation = Invoke-RestMethod `
          -Method Post `
          -Uri "$DefaultServerUrl/api/generate" `
          -ContentType "application/json" `
          -Body $body `
          -TimeoutSec 180

        if ($generation.success -eq $true) {
          Add-Result "Generate production plan" "PASS" "Dynamic mode returned success"
          if ($generation.workbookSignedUrl) {
            Add-Result "Workbook signed URL" "PASS" "Returned by server"
          } else {
            Add-Result "Workbook signed URL" "WARN" "No signed URL. Supabase storage may be unconfigured."
          }
        } else {
          Add-Result "Generate production plan" "FAIL" "Server returned success=false"
        }
      } catch {
        Add-Result "Generate production plan" "FAIL" $_.Exception.Message
      }
    } else {
      Add-Result "Generate production plan" "SKIP" "Server is not running"
    }
  } else {
    Add-Result "Generate production plan" "SKIP" "Use -Deep to run a real generation request"
  }

  Section "WhatsApp"
  Add-Result "WhatsApp bot automated check" "SKIP" "Manual QR scan required"
  Write-Host "Manual command:"
  Write-Host ("  cd `"{0}`"" -f $ServerDir)
  Write-Host "  npm run whatsapp:dev"
  Write-Host "Then send: ping"
  Write-Host "Then send: production plan: Create a 1-week production plan for encoding work with 8 total hours."
} finally {
  Stop-StartedApps

  Section "Summary"
  $Results | Format-Table -AutoSize

  $failed = @($Results | Where-Object { $_.Status -eq "FAIL" }).Count
  $warned = @($Results | Where-Object { $_.Status -eq "WARN" }).Count

  Write-Host ""
  if ($failed -gt 0) {
    Write-Host "$failed check(s) failed. Fix the FAIL rows above, then rerun this script." -ForegroundColor Red
    exit 1
  }

  if ($warned -gt 0) {
    Write-Host "No failures, but $warned warning(s) need attention." -ForegroundColor Yellow
    exit 0
  }

  Write-Host "Everything checked out." -ForegroundColor Green
  exit 0
}
