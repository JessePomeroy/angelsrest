/**
 * Sentry server-side init (audit #50a).
 *
 * Runs once at server startup. Safe no-op when PUBLIC_SENTRY_DSN is empty —
 * Sentry SDK silently disables capture if `dsn` is falsy, so unconfigured
 * environments (local dev without a Sentry project, CI, fresh forks) keep
 * working without errors.
 *
 * The DSN is read from PUBLIC_SENTRY_DSN so the same env var works on the
 * client side too. It's not actually a secret — DSNs are designed to ship
 * to browsers — and using PUBLIC_ keeps both runtimes in sync.
 *
 * Per-deployment DSNs are the migration path for the multi-tenant SaaS
 * shape: each Vercel project sets its own PUBLIC_SENTRY_DSN, so when
 * client #1 deploys their template fork they just point at a new Sentry
 * project. No code change needed.
 */

import * as Sentry from "@sentry/sveltekit";
import { env } from "$env/dynamic/public";

// Use dynamic public env so a missing PUBLIC_SENTRY_DSN doesn't fail the
// build — Sentry no-ops when dsn is undefined/empty.
Sentry.init({
	dsn: env.PUBLIC_SENTRY_DSN,
	// Tag every event with which site it came from. Lets a single Sentry
	// project serve multiple deployments (angelsrest, reflecting-pool,
	// future per-client deploys) with filterable issue lists.
	initialScope: {
		tags: { site: "angelsrest" },
	},
	// Error capture only for now. Performance, replays, profiling all off
	// to keep us comfortably under the 5K events/month free-tier ceiling.
	tracesSampleRate: 0,
	// Don't capture PII by default — order webhooks contain customer
	// emails and addresses. We'll attach scrubbed context manually via
	// the structured logger when needed.
	sendDefaultPii: false,
});
