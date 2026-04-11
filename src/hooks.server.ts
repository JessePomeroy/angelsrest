/**
 * SvelteKit Server Hooks
 *
 * Security headers and Sanity preview mode detection.
 * Admin auth is handled client-side by Better Auth via the admin package.
 */

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

export async function handle({ event, resolve }) {
	// Detect Sanity preview mode from cookie (set by /api/draft/enable)
	const isPreview = event.cookies.get("__sanity_preview") === "true";
	event.locals.isPreview = isPreview;

	const response = await resolve(event);

	// Skip security headers for auth API routes (response is immutable)
	if (event.url.pathname.startsWith("/api/auth")) {
		return response;
	}

	return addSecurityHeaders(response);
}
