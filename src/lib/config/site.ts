export const SITE_DOMAIN = "angelsrest.online";
export const SITE_URL = `https://${SITE_DOMAIN}`;

/**
 * Fallback admin notification address used when `NOTIFICATION_EMAIL` env var
 * is unset. Prefer `env.NOTIFICATION_EMAIL` at call sites and fall back to
 * this constant so deployments (production, preview, test) can override
 * without touching code. Audit M39 — single source of truth; previously
 * hardcoded in four files.
 */
export const ADMIN_EMAIL = "thinkingofview@gmail.com";
