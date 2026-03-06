import { env as privateEnv } from '$env/dynamic/private';

console.log('[HOOKS] hooks.server.ts loaded');

/**
 * SvelteKit hooks
 *
 * Add middleware logic here that runs before each request.
 */
export const hooks = {
	handle: [
		async ({ event, resolve }) => {
			console.log('[HOOKS] Handling:', event.url.pathname);
			// Protect /admin routes
			if (event.url.pathname.startsWith('/admin')) {
				const ADMIN_PASSWORD = privateEnv.ADMIN_PASSWORD;

				console.log('[ADMIN] Password configured:', !!ADMIN_PASSWORD);

				// Skip if no password is configured (development mode)
				if (!ADMIN_PASSWORD) {
					console.warn('[ADMIN] No password set - allowing access');
					return resolve(event);
				}

				const authHeader = event.request.headers.get('authorization');
				console.log('[ADMIN] Auth header:', !!authHeader);

				if (!authHeader || !authHeader.startsWith('Basic ')) {
					console.log('[ADMIN] No auth - returning 401');
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

				console.log('[ADMIN] Password match:', password === ADMIN_PASSWORD);

				if (password !== ADMIN_PASSWORD) {
					return new Response('Unauthorized', {
						status: 401,
						headers: {
							'WWW-Authenticate': 'Basic realm="Admin"',
							'Content-Type': 'text/plain'
						}
					});
				}
			}
			return resolve(event);
		}
	]
};
