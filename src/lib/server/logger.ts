/**
 * Structured logging wrapper (audit #50a).
 *
 * Replaces ad-hoc `console.log` / `console.error` calls in the print
 * processing pipeline with a single typed function that:
 *
 *   1. Emits a JSON line to stdout — Vercel + Convex Logs both index
 *      JSON, so structured fields become filterable instead of buried
 *      in free-text strings.
 *   2. Adds a Sentry breadcrumb so successful steps appear as context
 *      when a later error fires (audit #50a).
 *   3. Forwards `level: "error"` events to `Sentry.captureException`
 *      with the structured fields attached as scope.
 *
 * Designed to be a no-op for Sentry when the SDK is uninitialized
 * (no PUBLIC_SENTRY_DSN). The Sentry SDK silently drops calls in that
 * case so this module is safe to import from anywhere.
 *
 * Why a wrapper instead of calling Sentry directly at each call site:
 * - Single source of truth for the field shape, so dashboards in
 *   Sentry/Vercel can rely on `event`, `orderId`, `stage`, `durationMs`
 *   always being named the same.
 * - Lets the entire pipeline get retrofitted with one find-and-replace
 *   pattern (`console.log("Created order ...")` → `logStructured(...)`)
 *   instead of hand-writing breadcrumb + JSON serialization at every
 *   call site.
 * - Centralizes the rules around PII scrubbing, sampling, and
 *   error-vs-info routing — change them once, every call site updates.
 */

import * as Sentry from "@sentry/sveltekit";

export type LogLevel = "info" | "warn" | "error";

/**
 * Stages map to the audit #50a alert dashboard sections:
 * "download" / "composite" / "upload" / "submit" — see
 * `refactor-audit-2026-04-09.md` §50a for the alert rule list.
 *
 * Add new stages as the pipeline grows. Keep them lowercase, kebab-free,
 * single words so Sentry tag filters stay readable.
 */
export type LogStage =
	| "webhook"
	| "order_create"
	| "fee_capture"
	| "sharp_composite"
	| "lumaprints_submit"
	| "lumaprints_validate"
	| "lumaprints_shipping"
	| "stripe_refund"
	| "stripe_session_create"
	| "fulfillment_failure"
	| "email_customer"
	| "email_admin";

export interface StructuredLogEntry {
	/** Short event name in `noun.verb` form, e.g. `order.created`. */
	event: string;
	/** Severity. Errors get forwarded to Sentry.captureException. */
	level?: LogLevel;
	/** Pipeline stage — used as a Sentry tag for dashboard filtering. */
	stage?: LogStage;
	/** Order number (e.g. ORD-042) when an order is in scope. */
	orderId?: string;
	/** Stripe checkout session id when in scope. */
	sessionId?: string;
	/** Duration of the operation in milliseconds — surfaces on the p95/p99 dashboard. */
	durationMs?: number;
	/** Optional error object. Forwarded to Sentry as the captured exception. */
	error?: unknown;
	/** Free-form structured metadata. Avoid PII. */
	meta?: Record<string, unknown>;
}

/**
 * Emit a structured log entry. Always writes JSON to console; routes
 * errors to Sentry; adds a breadcrumb otherwise.
 */
export function logStructured(entry: StructuredLogEntry): void {
	const level = entry.level ?? "info";
	const payload = {
		ts: new Date().toISOString(),
		level,
		event: entry.event,
		stage: entry.stage,
		orderId: entry.orderId,
		sessionId: entry.sessionId,
		durationMs: entry.durationMs,
		...entry.meta,
		...(entry.error !== undefined
			? {
					errorMessage: entry.error instanceof Error ? entry.error.message : String(entry.error),
				}
			: {}),
	};

	// Drop undefined keys so log lines stay scannable
	const cleaned = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));

	// Use the matching console method so Vercel + dev terminals colorize correctly
	if (level === "error") {
		console.error(JSON.stringify(cleaned));
	} else if (level === "warn") {
		console.warn(JSON.stringify(cleaned));
	} else {
		console.log(JSON.stringify(cleaned));
	}

	// Sentry routing
	if (level === "error" && entry.error !== undefined) {
		Sentry.withScope((scope) => {
			if (entry.stage) scope.setTag("stage", entry.stage);
			if (entry.orderId) scope.setTag("orderId", entry.orderId);
			if (entry.sessionId) scope.setTag("sessionId", entry.sessionId);
			if (entry.durationMs !== undefined) {
				scope.setExtra("durationMs", entry.durationMs);
			}
			if (entry.meta) scope.setContext("meta", entry.meta);
			scope.setExtra("event", entry.event);
			Sentry.captureException(entry.error);
		});
	} else {
		// Successful step → breadcrumb so it shows up in the trail of any
		// later error fired in the same request
		Sentry.addBreadcrumb({
			category: entry.stage ?? "app",
			message: entry.event,
			level: level === "warn" ? "warning" : "info",
			data: cleaned,
		});
	}
}

/**
 * Convenience helper: time an async operation and log its duration.
 *
 * ```ts
 * const result = await timed(
 *   { event: "lumaprints.submitted", stage: "lumaprints_submit", orderId },
 *   () => createLumaPrintsOrder(lpOrder),
 * );
 * ```
 *
 * On success: logs an info entry with the elapsed durationMs.
 * On failure: logs an error entry with the error attached AND re-throws,
 * so the caller's existing error-handling path is preserved unchanged.
 */
export async function timed<T>(
	entry: Omit<StructuredLogEntry, "level" | "durationMs" | "error">,
	fn: () => Promise<T>,
): Promise<T> {
	const start = Date.now();
	try {
		const result = await fn();
		logStructured({
			...entry,
			level: "info",
			durationMs: Date.now() - start,
		});
		return result;
	} catch (err) {
		logStructured({
			...entry,
			level: "error",
			durationMs: Date.now() - start,
			error: err,
		});
		throw err;
	}
}
