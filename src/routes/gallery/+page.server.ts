import { portfolioContent } from "$lib/server/current/portfolioContent.server";

export async function load() {
	return { galleries: await portfolioContent.list() };
}
