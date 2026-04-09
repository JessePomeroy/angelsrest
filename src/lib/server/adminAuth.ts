import type { Handle } from "@sveltejs/kit";
import { env as privateEnv } from "$env/dynamic/private";

/**
 * HTTP Basic Auth protection for admin routes
 *
 * Checks the Authorization header against ADMIN_PASSWORD env var.
 * If no password is set, allows access (for development).
 *
 * 💡 Why Handle type?
 * SvelteKit's Handle type properly types the { event, resolve } parameters.
 * Without it, TypeScript infers 'any' for both, causing implicit-any errors.
 *
 * 💡 Why arrow function (const adminAuth = async () => {})?
 * Assigning directly to a typed const lets TypeScript infer parameter types
 * from the Handle type, avoiding the need to manually annotate each param.
 */
export const adminAuth: Handle = async ({ event, resolve }) => {
	const ADMIN_PASSWORD = privateEnv.ADMIN_PASSWORD;

	// Skip if no password is configured (development mode)
	if (!ADMIN_PASSWORD) {
		console.warn("ADMIN_PASSWORD not set - allowing admin access");
		return resolve(event);
	}

	const authHeader = event.request.headers.get("authorization");

	if (!authHeader || !authHeader.startsWith("Basic ")) {
		return new Response("Unauthorized", {
			status: 401,
			headers: {
				"WWW-Authenticate": 'Basic realm="Admin"',
				"Content-Type": "text/plain",
			},
		});
	}

	// Decode base64 credentials
	const base64Credentials = authHeader.slice(6);
	const credentials = atob(base64Credentials);
	const [_username, password] = credentials.split(":");

	if (password !== ADMIN_PASSWORD) {
		return new Response("Unauthorized", {
			status: 401,
			headers: {
				"WWW-Authenticate": 'Basic realm="Admin"',
				"Content-Type": "text/plain",
			},
		});
	}

	return resolve(event);
};
