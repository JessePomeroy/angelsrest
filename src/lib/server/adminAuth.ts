import { json, error } from '@sveltejs/kit';
import { ADMIN_PASSWORD } from '$env/static/private';

/**
 * HTTP Basic Auth protection for admin routes
 *
 * Checks the Authorization header against ADMIN_PASSWORD env var.
 * If no password is set, allows access (for development).
 *
 * Usage: Add this hook to protect admin routes:
 *   export const hooks = {
 *     handle: [
 *       { match: '/admin/**', handler: adminAuth }
 *     ]
 *   }
 */
export async function adminAuth({ event, resolve }) {
	// Skip if no password is configured (development mode)
	if (!ADMIN_PASSWORD) {
		return resolve(event);
	}

	const authHeader = event.request.headers.get('authorization');

	if (!authHeader || !authHeader.startsWith('Basic ')) {
		return new Response('Unauthorized', {
			status: 401,
			headers: {
				'WWW-Authenticate': 'Basic realm="Admin"',
				'Content-Type': 'text/plain'
			}
		});
	}

	// Decode base64 credentials
	const base64Credentials = authHeader.slice(6);
	const credentials = atob(base64Credentials);
	const [username, password] = credentials.split(':');

	if (password !== ADMIN_PASSWORD) {
		return new Response('Unauthorized', {
			status: 401,
			headers: {
				'WWW-Authenticate': 'Basic realm="Admin"',
				'Content-Type': 'text/plain'
			}
		});
	}

	return resolve(event);
}
