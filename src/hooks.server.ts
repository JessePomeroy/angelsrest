/**
 * SvelteKit Server Hooks
 *
 * Hooks run on the server before every request. We use them here to protect
 * the /admin routes with HTTP Basic Authentication and set security headers.
 */

import { env as privateEnv } from "$env/dynamic/private";

function addSecurityHeaders(response: Response): Response {
	response.headers.set("X-Frame-Options", "DENY");
	response.headers.set("X-Content-Type-Options", "nosniff");
	response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
	response.headers.set(
		"Permissions-Policy",
		"camera=(), microphone=(), geolocation=()",
	);
	return response;
}

/**
 * Main handle function - runs for every request to your server
 *
 * @param {Object} event - The request event containing URL, headers, etc.
 * @param {Function} resolve - Function to continue processing the request
 */
export async function handle({ event, resolve }) {
	// Detect Sanity preview mode from cookie (set by /api/draft/enable)
	const isPreview = event.cookies.get("__sanity_preview") === "true";
	event.locals.isPreview = isPreview;

	// Allow draft API routes without auth (Sanity Studio calls these)
	if (event.url.pathname.startsWith("/api/draft")) {
		return addSecurityHeaders(await resolve(event));
	}

	// Protect /admin and /api/admin routes
	if (
		event.url.pathname.startsWith("/admin") ||
		event.url.pathname.startsWith("/api/admin")
	) {
		// Get password from environment variables
		const ADMIN_PASSWORD = privateEnv.ADMIN_PASSWORD;

		// If no password is set, allow access (useful for local development)
		if (!ADMIN_PASSWORD) {
			return addSecurityHeaders(await resolve(event));
		}

		// Get the Authorization header from the request
		const authHeader = event.request.headers.get("authorization");

		// If no Authorization header, show the login popup
		if (!authHeader || !authHeader.startsWith("Basic ")) {
			return addSecurityHeaders(
				new Response("Unauthorized", {
					status: 401,
					headers: {
						"WWW-Authenticate": 'Basic realm="Admin"',
						"Content-Type": "text/plain",
					},
				}),
			);
		}

		// Extract the base64-encoded credentials
		const base64Credentials = authHeader.slice(6);
		const credentials = atob(base64Credentials);
		const [_username, password] = credentials.split(":");

		// If password doesn't match, show login popup again
		if (password !== ADMIN_PASSWORD) {
			return addSecurityHeaders(
				new Response("Unauthorized", {
					status: 401,
					headers: {
						"WWW-Authenticate": 'Basic realm="Admin"',
						"Content-Type": "text/plain",
					},
				}),
			);
		}

		// Password correct! Allow the request to continue
	}

	// Continue processing the request normally
	const response = await resolve(event);
	return addSecurityHeaders(response);
}
