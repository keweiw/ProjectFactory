# ProjectFactory Install Script
# Scaffolds the ProjectFactory framework into a target project.
#
# Usage:
#   .\install.ps1 -TargetPath "C:\path\to\your\project"
#   .\install.ps1                          # installs into current directory

param(
    [string]$TargetPath = (Get-Location).Path
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RolesSource = Join-Path $ScriptDir "roles"

function Write-Step($msg) { Write-Host "  --> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [!]  $msg" -ForegroundColor Yellow }

Write-Host ""
Write-Host "ProjectFactory Installer" -ForegroundColor White
Write-Host "Target: $TargetPath"
Write-Host ""

# Validate target
if (-not (Test-Path $TargetPath)) {
    Write-Error "Target path does not exist: $TargetPath"
    exit 1
}

if (-not (Test-Path $RolesSource)) {
    Write-Error "roles/ folder not found next to install.ps1. Run this script from the ProjectFactory directory."
    exit 1
}

# Create directory structure
$dirs = @(
    ".claude\roles",
    ".claude\commands",
    "specs",
    "summaries"
)

foreach ($dir in $dirs) {
    $full = Join-Path $TargetPath $dir
    if (-not (Test-Path $full)) {
        New-Item -ItemType Directory -Path $full -Force | Out-Null
        Write-Step "Created $dir"
    } else {
        Write-Warn "Already exists, skipping: $dir"
    }
}

# Copy role profiles
Write-Step "Copying role profiles..."
$roleFiles = Get-ChildItem -Path $RolesSource -Filter "*.md"
foreach ($file in $roleFiles) {
    $dest = Join-Path $TargetPath ".claude\roles\$($file.Name)"
    if (Test-Path $dest) {
        Write-Warn "Already exists, skipping: .claude\roles\$($file.Name)"
    } else {
        Copy-Item $file.FullName -Destination $dest
        Write-Ok ".claude\roles\$($file.Name)"
    }
}

# Create AGENTS.md stub if not present
$agentsMd = Join-Path $TargetPath "AGENTS.md"
if (-not (Test-Path $agentsMd)) {
    Write-Step "Creating AGENTS.md stub..."
    @"
# AGENTS.md — Project-Specific Agent Rules
#
# Add a section below for each agent role you want to customise.
# Sections are optional — only include roles that need project-specific rules.
# Agents load their own section and ignore others.

## Design Agent

## Architect Agent

## Spec Reviewer Agent

## Coding Agent

## Code Review Agent

## Testing Agent
"@ | Set-Content -Path $agentsMd -Encoding utf8
    Write-Ok "AGENTS.md"
} else {
    Write-Warn "AGENTS.md already exists, skipping."
}

Write-Host ""
Write-Host "Done. ProjectFactory framework installed into:" -ForegroundColor Green
Write-Host "  $TargetPath" -ForegroundColor White
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Edit AGENTS.md with project-specific rules for each agent role."
Write-Host "  2. Run /pf-design inside Claude Code to start the Design Agent."
Write-Host ""
