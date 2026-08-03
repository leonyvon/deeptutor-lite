# deeptutor-lite install script — links the package into the pi agent directory.
#
# Usage:
#   .\install.ps1            # install (junction extension + skills + prompts into ~/.pi/agent)
#   .\install.ps1 -Uninstall # remove links only (repo files stay untouched)
#
# Extension + skills are junctioned (live edits, no reinstall needed).
# Prompts are junctioned as a directory too; if ~/.pi/agent/prompts already
# contains files not owned by this package they are moved into the repo first.

param([switch]$Uninstall)

$ErrorActionPreference = "Stop"
$repo = $PSScriptRoot
$agent = Join-Path $env:USERPROFILE ".pi\agent"

function Ensure-RepoReady {
    # config.json is user-local (gitignored); materialize from example if missing
    $cfg = Join-Path $repo "extensions\config.json"
    if (-not (Test-Path $cfg)) {
        Copy-Item (Join-Path $repo "config.example.json") $cfg
        Write-Host "[i] created extensions\config.json from config.example.json"
    }
    # runtime deps
    if (-not (Test-Path (Join-Path $repo "node_modules"))) {
        Push-Location $repo
        npm install --no-audit --no-fund
        Pop-Location
    }
}

function Remove-Link([string]$path) {
    # Get-Item (not Test-Path): a dangling junction still occupies the name
    # but Test-Path returns $false for it, which would make re-linking fail.
    if (Get-Item -LiteralPath $path -ErrorAction SilentlyContinue) {
        Remove-Item -LiteralPath $path -Force -Recurse
        Write-Host "[x] removed $path"
    }
}

function New-Junction([string]$target, [string]$link) {
    if (Get-Item -LiteralPath $link -ErrorAction SilentlyContinue) { Remove-Link $link }
    New-Item -ItemType Junction -Path $link -Target $target | Out-Null
    Write-Host "[+] linked $link -> $target"
}

if ($Uninstall) {
    Remove-Link (Join-Path $agent "extensions\deeptutor-lite")
    Get-ChildItem (Join-Path $agent "skills") -Directory -Filter "deeptutor*" -ErrorAction SilentlyContinue | ForEach-Object { Remove-Link $_.FullName }
    $prompts = Join-Path $agent "prompts"
    if ((Get-Item $prompts -ErrorAction SilentlyContinue).LinkType -eq "Junction") { Remove-Link $prompts }
    Write-Host "Done. Re-run .\install.ps1 to restore."
    exit 0
}

Ensure-RepoReady

# 1) extension
New-Junction (Join-Path $repo "extensions") (Join-Path $agent "extensions\deeptutor-lite")

# 2) skills (one junction per skill dir)
Get-ChildItem (Join-Path $repo "skills") -Directory | ForEach-Object {
    New-Junction $_.FullName (Join-Path $agent "skills\$($_.Name)")
}

# 3) prompts (directory junction; absorb foreign files first)
$agentPrompts = Join-Path $agent "prompts"
$repoPrompts = Join-Path $repo "prompts"
$existingPrompts = Get-Item -LiteralPath $agentPrompts -ErrorAction SilentlyContinue
# absorb foreign files only when prompts is a real directory (not a junction,
# which may be dangling after a repo rename and would make Get-ChildItem throw)
if ($existingPrompts -and $existingPrompts.LinkType -ne "Junction") {
    $foreign = Get-ChildItem $agentPrompts -File | Where-Object { $_.Name -notin (Get-ChildItem $repoPrompts -File | ForEach-Object Name) }
    foreach ($f in $foreign) {
        Move-Item $f.FullName $repoPrompts
        Write-Host "[m] moved $($f.Name) into repo prompts"
    }
}
New-Junction $repoPrompts $agentPrompts

Write-Host ""
Write-Host "deeptutor-lite linked. Restart pi to load."
