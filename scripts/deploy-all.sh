#!/usr/bin/env bash
# ============================================================================
# deploy-all.sh
#
# Deploy this Convex codebase to every per-client prod deployment, serially.
#
# Background (Option A): each spoke site (angelsrest, reflecting-pool, …) has
# its own Convex project. Schema and functions live here in `convex/`, and the
# same code is deployed N times — once per client — using a different deploy
# key for each. This script is the manual / local path; the canonical CI path
# is `.github/workflows/deploy-spokes.yml`, which parallelises across the same
# client list using GitHub Secrets instead of Bitwarden.
#
# Local usage (requires Bitwarden CLI logged in + unlocked):
#   bw login                           # one-time
#   export BW_SESSION="$(bw unlock --raw)"
#   ./scripts/deploy-all.sh
#
# Bitwarden item layout: each deploy key is stored as the *password* field of
# a Bitwarden login item named `convex-deploy-key-<client>-prod`. Keep the
# items in any folder; lookup is by name. The script accepts a session via
# either:
#   - $BW_SESSION exported in your shell (recommended), or
#   - prompting `bw unlock --raw` interactively if locked.
#
# Adding a new client:
#   1. Append the client name to the CLIENTS array below.
#   2. Create a Bitwarden login item named `convex-deploy-key-<client>-prod`
#      with the deploy key in the password field.
#   3. Add a matching client entry to `.github/workflows/deploy-spokes.yml`
#      and create the GitHub Secret named CONVEX_DEPLOY_KEY_<UPPER_SNAKE>_PROD
#      (e.g. CONVEX_DEPLOY_KEY_REFLECTING_POOL_PROD).
#
# Exit codes:
#   0 — all deploys succeeded
#   1 — preflight failure (missing bw CLI, locked vault, empty key, etc.)
#   N — first deploy that fails halts the script (set -e)
# ============================================================================

set -euo pipefail

CLIENTS=(angelsrest reflecting-pool)

# ----- Preflight -----------------------------------------------------------

if ! command -v bw >/dev/null 2>&1; then
  echo "Error: Bitwarden CLI ('bw') not found." >&2
  echo "Install via 'brew install bitwarden-cli', then 'bw login'." >&2
  echo "Or run the deploy via CI (.github/workflows/deploy-spokes.yml)." >&2
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

# Run from the angelsrest repo root (this script's grandparent dir of itself).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -d convex ]; then
  echo "Error: no convex/ directory at $REPO_ROOT — refusing to deploy." >&2
  exit 1
fi

# Sync once up-front so the cache is warm; cheaper than once per client.
bw sync >/dev/null

# ----- Deploy loop ---------------------------------------------------------

echo "Deploying Convex codebase to ${#CLIENTS[@]} client(s): ${CLIENTS[*]}"
echo ""

for client in "${CLIENTS[@]}"; do
  echo "==> Deploying ${client} (prod)..."
  ITEM_NAME="convex-deploy-key-${client}-prod"
  if ! KEY="$(bw get password "$ITEM_NAME" 2>/dev/null)"; then
    echo "Error: could not read Bitwarden item '${ITEM_NAME}'." >&2
    echo "Check the item exists and the password field is populated." >&2
    exit 1
  fi
  if [ -z "$KEY" ]; then
    echo "Error: empty deploy key for ${client}." >&2
    echo "Check Bitwarden item '${ITEM_NAME}' — password field is empty." >&2
    exit 1
  fi
  CONVEX_DEPLOY_KEY="$KEY" npx convex deploy
  echo ""
done

echo "✓ All deploys complete."
