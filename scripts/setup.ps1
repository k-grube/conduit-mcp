#!/usr/bin/env pwsh
# verify toolchain, then pnpm install + full workspace build. idempotent, safe to re-run.
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Fail([string]$msg) {
    Write-Host "setup failed: $msg" -ForegroundColor Red
    exit 1
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Fail "node not found, install node >= 22"
}
$nodeVersion = (& node -v).Trim()
if ($nodeVersion -notmatch '^v(\d+)\.') {
    Fail "could not parse node version: $nodeVersion"
}
if ([int]$Matches[1] -lt 22) {
    Fail "node $nodeVersion found, need >= 22"
}

$pnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpmCmd) {
    Write-Host "pnpm not found, run:"
    Write-Host "  corepack enable"
    Write-Host "  corepack prepare pnpm@10.33.0 --activate"
    exit 1
}
$pnpmVersion = (& pnpm -v).Trim()

& pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) {
    Fail "pnpm install --frozen-lockfile failed"
}

& pnpm -r build
if ($LASTEXITCODE -ne 0) {
    Fail "pnpm -r build failed"
}

Write-Host "setup ok: node $nodeVersion, pnpm $pnpmVersion"
