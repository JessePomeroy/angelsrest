import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ parent }) => {
	// The authenticated browser query owns the complete, paginated inbox.
	await parent();
};
