#!/usr/bin/env bash
# verify toolchain, then pnpm install + full workspace build. idempotent, safe to re-run.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

fail() {
  echo "setup failed: $1" >&2
  exit 1
}

if ! command -v node >/dev/null 2>&1; then
  fail "node not found, install node >= 22"
fi
node_version="$(node -v)"
node_major="${node_version#v}"
node_major="${node_major%%.*}"
if [ "$node_major" -lt 22 ]; then
  fail "node $node_version found, need >= 22"
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm not found, run:" >&2
  echo "  corepack enable" >&2
  echo "  corepack prepare pnpm@10.33.0 --activate" >&2
  exit 1
fi
pnpm_version="$(pnpm -v)"

pnpm install --frozen-lockfile || fail "pnpm install --frozen-lockfile failed"
pnpm -r build || fail "pnpm -r build failed"

echo "setup ok: node $node_version, pnpm $pnpm_version"
