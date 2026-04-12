/**
 * SvelteKit Server Hooks
 *
 * Composes:
 * - Sentry request handler (audit #50a — error capture, no perf tracing)
 * - Security headers + Sanity preview detection (existing)
 *
 * The Sentry init itself lives in `instrumentation.server.ts` per
 * SvelteKit 2.31+ pattern. This file only wires the request/error hooks.
 */

import * as Sentry from "@sentry/sveltekit";
import type { Handle } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";

function addSecurityHeaders(response: Response): Response {
	const cloned = new Response(response.body, response);
	cloned.headers.set("X-Frame-Options", "DENY");
	cloned.headers.set("X-Content-Type-Options", "nosniff");
	cloned.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
	cloned.headers.set(
		"Permissions-Policy",
		"camera=(), microphone=(), geolocation=()",
	);
	cloned.headers.set(
		"Content-Security-Policy",
		// Origin allowlist by directive — every entry below was added because
		// some real piece of the site needed it. Verify before extending.
		//
		// - Fontshare CSS lives at api.fontshare.com and the font binaries at
		//   cdn.fontshare.com. Both origins must be allowed or the browser
		//   silently blocks the fonts and falls back to system default. Lesson
		//   from the 2026-04-09 Fontshare hotfix (`feedback_csp_verify_origins`).
		// - Sentry ingest (audit #50a) lives at *.ingest.sentry.io with regional
		//   variants like *.ingest.us.sentry.io. The wildcard *.sentry.io covers
		//   both. Without this entry, Sentry's SDK initializes successfully but
		//   every captured exception is silently CSP-blocked at the connect-src
		//   layer — the SDK tries to POST envelopes to ingest and the browser
		//   refuses. Caught during end-to-end Sentry verification 2026-04-11
		//   (which is exactly the kind of mistake `feedback_csp_verify_origins`
		//   was written to prevent).
		"default-src 'self'; script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com; style-src 'self' 'unsafe-inline' https://api.fontshare.com; img-src 'self' https://cdn.sanity.io data: blob:; font-src 'self' https://api.fontshare.com https://cdn.fontshare.com; connect-src 'self' wss://*.convex.cloud https://*.convex.cloud https://*.sanity.io https://*.sentry.io https://va.vercel-scripts.com; frame-ancestors 'none'",
	);
	return cloned;
}

const appHandle: Handle = async ({ event, resolve }) => {
	// Detect Sanity preview mode from cookie (set by /api/draft/enable)
	const isPreview = event.cookies.get("__sanity_preview") === "true";
	event.locals.isPreview = isPreview;

	const response = await resolve(event);

	// Skip security headers for auth API routes (response is immutable)
	if (event.url.pathname.startsWith("/api/auth")) {
		return response;
	}

	return addSecurityHeaders(response);
};

export const handle = sequence(Sentry.sentryHandle(), appHandle);

export const handleError = Sentry.handleErrorWithSentry();
