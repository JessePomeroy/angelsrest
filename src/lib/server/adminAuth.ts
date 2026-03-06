import { json, error } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';

/**
 * HTTP Basic Auth protection for admin routes
 *
 * Checks the Authorization header against ADMIN_PASSWORD env var.
 * If no password is set, allows access (for development).
 */
export async function adminAuth({ event, resolve }) {
	const ADMIN_PASSWORD = privateEnv.ADMIN_PASSWORD;

	// Skip if no password is configured (development mode)
	if (!ADMIN_PASSWORD) {
		console.warn('ADMIN_PASSWORD not set - allowing admin access');
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
