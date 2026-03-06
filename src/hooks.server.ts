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
	 * Use match() to apply handlers to specific routes.
	 * The adminAuth handler protects all /admin/* routes.
	 */
	handle: [
		{
			match: '/admin/**',
			handler: adminAuth
		}
	]
};
