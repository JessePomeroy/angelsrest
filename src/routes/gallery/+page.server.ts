import { portfolioContent } from "$lib/server/portfolioContent.server";

export async function load() {
	return { galleries: await portfolioContent.list() };
}
