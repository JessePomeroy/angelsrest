/**
 * SvelteKit Server Hooks 🔐
 *
 * Hooks run on the server before every request. We use them here to protect
 * the /admin routes with HTTP Basic Authentication.
 *
 * 💡 What is HTTP Basic Auth?
 * It's the simplest form of authentication - when you visit a protected page,
 * the browser shows a popup asking for username/password.
 *
 * How it works:
 * 1. User visits /admin/orders
 * 2. Server checks for Authorization header
 * 3. If missing, server returns 401 with "WWW-Authenticate" header
 * 4. Browser shows login popup
 * 5. User enters password
 * 6. Browser sends credentials in "Authorization: Basic base64(username:password)"
 * 7. Server verifies password
 * 8. If correct, serve the page; if not, show 401 again
 *
 * Pros: Simple, no database needed, works in all browsers
 * Cons: No "logout" button, can't have multiple users with different permissions
 *
 * For more users/permissions, you'd want OAuth, session cookies, or a service like Clerk.
 */

import { env as privateEnv } from "$env/dynamic/private";

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
		return resolve(event);
	}

	// Protect /admin routes - check if the URL starts with /admin
	if (event.url.pathname.startsWith("/admin")) {
		// Get password from environment variables
		const ADMIN_PASSWORD = privateEnv.ADMIN_PASSWORD;

		// If no password is set, allow access (useful for local development)
		if (!ADMIN_PASSWORD) {
			return resolve(event);
		}

		// Get the Authorization header from the request
		// This header contains the username:password encoded in base64
		const authHeader = event.request.headers.get("authorization");

		// If no Authorization header, show the login popup
		if (!authHeader || !authHeader.startsWith("Basic ")) {
			// 401 = Unauthorized
			// "WWW-Authenticate: Basic" tells the browser to show a login popup
			return new Response("Unauthorized", {
				status: 401,
				headers: {
					"WWW-Authenticate": 'Basic realm="Admin"',
					"Content-Type": "text/plain",
				},
			});
		}

		// Extract the base64-encoded credentials from "Basic dXNlcm5hbWU6cGFzc3dvcmQ="
		const base64Credentials = authHeader.slice(6); // Remove "Basic "

		// Decode from base64 to "username:password"
		const credentials = atob(base64Credentials);

		// Split into username and password
		const [_username, password] = credentials.split(":");

		// If password doesn't match, show login popup again
		if (password !== ADMIN_PASSWORD) {
			return new Response("Unauthorized", {
				status: 401,
				headers: {
					"WWW-Authenticate": 'Basic realm="Admin"',
					"Content-Type": "text/plain",
				},
			});
		}

		// Password correct! Allow the request to continue
	}

	// Continue processing the request normally
	return resolve(event);
}
