import { portfolioContent } from "$lib/server/portfolioContent.server";

export async function load({ locals }) {
	return { galleries: await portfolioContent.list(locals.isPreview) };
}
