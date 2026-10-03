import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ parent }) => {
	await parent();
	// The authenticated browser query owns the complete, paginated inbox.
	return { inquiries: [] };
};
