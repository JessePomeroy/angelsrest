import { adminAuth } from '$lib/server/adminAuth';

/**
 * SvelteKit hooks
 *
 * Add middleware logic here that runs before each request.
 */
export const hooks = {
	/**
	 * Handle HTTP requests
	 *
	 * Applies adminAuth to routes starting with /admin
	 */
	handle: [
		async ({ event, resolve }) => {
			// Protect /admin routes
			if (event.url.pathname.startsWith('/admin')) {
				return adminAuth({ event, resolve });
			}
			return resolve(event);
		}
	]
};
