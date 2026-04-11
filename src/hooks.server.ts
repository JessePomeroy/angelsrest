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
		// Fontshare hosts the CSS at api.fontshare.com and the font files at
		// cdn.fontshare.com — both origins must be allowed or the browser
		// silently blocks the fonts and falls back to system default.
		"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://api.fontshare.com; img-src 'self' https://cdn.sanity.io data: blob:; font-src 'self' https://api.fontshare.com https://cdn.fontshare.com; connect-src 'self' wss://*.convex.cloud https://*.convex.cloud https://*.sanity.io; frame-ancestors 'none'",
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
