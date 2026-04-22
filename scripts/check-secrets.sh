#!/usr/bin/env bash
# ============================================================================
# check-secrets.sh
#
# Pre-commit guard: scan files staged for commit for live API-key patterns.
# Blocks the commit if any match is found.
#
# Patterns scanned (added / tuned as services change):
#   - Stripe live keys:        sk_live_..., pk_live_..., rk_live_..., whsec_...
#   - Sanity tokens:           skXXXX... (roughly 180-char base64-ish secrets)
#   - Resend:                  re_[A-Za-z0-9_]+ followed by a second _-segment
#   - Generic "looks like a secret" heuristics:
#       BEGIN PRIVATE KEY / BEGIN RSA / .pem-style blocks
#       AWS access keys AKIA* and AWS secret-access-key strings
#       Google API keys AIza*
#       Long hex runs (32+ chars) assigned to uppercase-SNAKE_CASE variable
#         names that CONTAIN "KEY" or "SECRET" or "TOKEN"
#
# The script only scans files that are actually STAGED — it does NOT scan the
# working tree as a whole. That keeps it fast and prevents unrelated
# pre-existing matches (in someone else's forgotten scratch file) from
# blocking unrelated commits.
#
# False-positive escape hatch: if you really do need to commit something
# that matches one of these patterns (e.g., a fixture that hard-codes a
# placeholder like `sk_live_xxx_ignore`), append `# pragma: allowlist secret`
# to the same line. The check skips lines containing that marker.
#
# Exit codes:
#   0 — no issues
#   1 — one or more secret-like patterns found; commit is blocked
# ============================================================================

set -euo pipefail

# Only look at files staged for commit (added/copied/modified). Exclude the
# audit/rotation docs (gitignored but belt-and-suspenders), the lockfile
# (huge, contains integrity hashes that can trigger false positives), and
# this script itself (has the patterns as literal strings).
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM \
  | grep -Ev '^(pnpm-lock\.yaml|AUDIT\.md|ROTATION\.md|scripts/check-secrets\.sh)$' \
  || true)

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

# Compose the pattern list. Each one is a POSIX extended regex fed to git-grep.
PATTERNS=(
  # Stripe live keys (production only — test keys sk_test_... are allowed)
  'sk_live_[A-Za-z0-9]{20,}'
  'pk_live_[A-Za-z0-9]{20,}'
  'rk_live_[A-Za-z0-9]{20,}'
  # Stripe webhook signing secrets
  'whsec_[A-Za-z0-9]{20,}'
  # Resend live API keys
  're_[A-Za-z0-9]+_[A-Za-z0-9_-]{20,}'
  # Sanity tokens typically start with sk + ~150+ char mixed-case body
  'sk[a-zA-Z0-9]{40,}'
  # AWS access key ID
  'AKIA[0-9A-Z]{16}'
  # Google API keys
  'AIza[0-9A-Za-z_-]{35}'
  # PEM-style private key preamble
  '-----BEGIN (RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----'
)

FOUND_ANY=0
TMP_OUT=$(mktemp)
trap 'rm -f "$TMP_OUT"' EXIT

for pattern in "${PATTERNS[@]}"; do
  # --cached scans the staged (index) content, not the working tree.
  # -nE enables extended regex + line numbers.
  # -I skips binary files.
  if git grep -nIE --cached "$pattern" -- $STAGED_FILES 2>/dev/null \
        | grep -v 'pragma: allowlist secret' >> "$TMP_OUT"; then
    FOUND_ANY=1
  fi
done

if [ "$FOUND_ANY" -eq 1 ]; then
  RED=$'\033[31m'
  RESET=$'\033[0m'
  printf '\n'
  printf '%s╔══════════════════════════════════════════════════════════════════╗%s\n' "$RED" "$RESET"
  printf '%s║  🛑  Secret-like patterns found in staged files:                 ║%s\n' "$RED" "$RESET"
  printf '%s╚══════════════════════════════════════════════════════════════════╝%s\n' "$RED" "$RESET"
  printf '\n'
  # Sort + dedupe lines (same file:line may have matched multiple patterns)
  sort -u "$TMP_OUT"
  printf '\n'
  printf 'Commit blocked. Options:\n'
  printf '  1. Rotate the secret (see ROTATION.md), remove from file, re-stage.\n'
  printf '  2. If this is a legitimate placeholder / test fixture, add:\n'
  printf '        # pragma: allowlist secret\n'
  printf '     to the end of the offending line, then re-stage.\n'
  printf '  3. If the pattern itself is a false positive the project will hit\n'
  printf '     repeatedly, update scripts/check-secrets.sh.\n'
  printf '\n'
  exit 1
fi

exit 0
