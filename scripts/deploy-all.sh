#!/usr/bin/env bash
# ============================================================================
# deploy-all.sh
#
# Deploy this Convex codebase to the shared prod deployment.
#
# ★ STATUS: BREAK-GLASS, not required setup. ★
#
# The canonical deploy path is `.github/workflows/deploy-shared-convex.yml`, which
# auto-fires on every green CI run AND supports manual force-redeploys via
# Actions → Deploy shared Convex → "Run workflow" (workflow_dispatch). That
# covers ~100% of normal and emergency use cases — same effect as this
# script, runs in the cloud, no laptop or password manager needed.
#
# This script exists for the rare case where GitHub Actions itself is
# unavailable (outage, account locked, network), or for one-off local
# experimentation against prod Convex without pushing a commit. Setup is
# DEFERRED — don't install Bitwarden CLI or create the items below until
# you actually need this path.
#
# Background: all hub and spoke sites use one shared Convex deployment for
# operational data. Schema and functions live in `packages/crm-api/convex/`.
# Adding a client adds a tenant row, not a new Convex project.
#
# Local usage (requires Bitwarden CLI logged in + unlocked):
#   bw login                           # one-time
#   export BW_SESSION="$(bw unlock --raw)"
#   ./scripts/deploy-all.sh
#
# Bitwarden item layout: the shared production deploy key is stored as the
# *password* field of a Bitwarden login item named
# `convex-deploy-key-angelsrest-prod`. Keep the item in any folder; lookup is
# by name. The script accepts a session via
# either:
#   - $BW_SESSION exported in your shell (recommended), or
#   - prompting `bw unlock --raw` interactively if locked.
#
# Adding a new client does not change this script. Create the platformClients
# row and deploy the shared Convex project once if the schema/functions changed.
#
# Exit codes:
#   0 — all deploys succeeded
#   1 — preflight failure (missing bw CLI, locked vault, empty key, etc.)
#   N — first deploy that fails halts the script (set -e)
# ============================================================================

set -euo pipefail

DEPLOY_KEY_ITEM="convex-deploy-key-angelsrest-prod"

# ----- Preflight -----------------------------------------------------------

if ! command -v bw >/dev/null 2>&1; then
  echo "Error: Bitwarden CLI ('bw') not found." >&2
  echo "Install via 'brew install bitwarden-cli', then 'bw login'." >&2
  echo "Or run the deploy via CI (.github/workflows/deploy-shared-convex.yml)." >&2
  exit 1
fi

# `bw status` returns JSON like {"status":"unlocked"|"locked"|"unauthenticated"}.
# Parse without jq (one less dependency); we just need the status field.
BW_STATUS_JSON="$(bw status 2>/dev/null || echo '{"status":"unauthenticated"}')"
BW_STATUS="$(echo "$BW_STATUS_JSON" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')"

case "$BW_STATUS" in
  unauthenticated)
    echo "Error: Bitwarden CLI not logged in." >&2
    echo "Run 'bw login' once, then 'export BW_SESSION=\"\$(bw unlock --raw)\"'." >&2
    exit 1
    ;;
  locked)
    if [ -z "${BW_SESSION:-}" ]; then
      echo "Bitwarden vault is locked. Unlocking interactively…"
      echo "(Tip: 'export BW_SESSION=\"\$(bw unlock --raw)\"' avoids this prompt.)"
      BW_SESSION="$(bw unlock --raw)"
      export BW_SESSION
    else
      # $BW_SESSION is set but bw still reports locked → stale token.
      echo "Error: \$BW_SESSION is set but the vault still reports locked." >&2
      echo "Re-export: 'export BW_SESSION=\"\$(bw unlock --raw)\"'." >&2
      exit 1
    fi
    ;;
  unlocked)
    : # ready to go
    ;;
  *)
    echo "Error: unexpected bw status '$BW_STATUS'." >&2
    echo "Raw status JSON: $BW_STATUS_JSON" >&2
    exit 1
    ;;
esac

# Run from packages/crm-api/ — that's where convex/ lives after the Gap 2
# Phase 1 relocation, and where `npx convex deploy` finds the schema +
# functions. Matches the working-directory used by deploy-shared-convex.yml.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CRM_API_DIR="$REPO_ROOT/packages/crm-api"
cd "$CRM_API_DIR"

if [ ! -d convex ]; then
  echo "Error: no convex/ directory at $CRM_API_DIR — refusing to deploy." >&2
  exit 1
fi

# Sync once up-front so the cache is warm.
bw sync >/dev/null

# ----- Deploy --------------------------------------------------------------

echo "Deploying shared Convex codebase to prod..."
if ! KEY="$(bw get password "$DEPLOY_KEY_ITEM" 2>/dev/null)"; then
  echo "Error: could not read Bitwarden item '${DEPLOY_KEY_ITEM}'." >&2
  echo "Check the item exists and the password field is populated." >&2
  exit 1
fi
if [ -z "$KEY" ]; then
  echo "Error: empty shared deploy key." >&2
  echo "Check Bitwarden item '${DEPLOY_KEY_ITEM}' — password field is empty." >&2
  exit 1
fi
CONVEX_DEPLOY_KEY="$KEY" npx convex deploy

echo "✓ Shared Convex deploy complete."
