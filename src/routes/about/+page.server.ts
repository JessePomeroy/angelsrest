import { aboutContactContent } from "$lib/server/aboutContactContent.server";

export const load = async ({ locals }) => ({
	content: await aboutContactContent.load(locals.isPreview),
});
