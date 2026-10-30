import { error } from "@sveltejs/kit";
import { blogContent } from "$lib/server/current/blogContent.server";
import type { PageServerLoad } from "./$types";

export const load = (({ url }: { url: URL }) => {
	const pages = url.searchParams.getAll("page");
	if (pages.length > 1 || (pages.length === 1 && !/^[1-9]\d*$/.test(pages[0]))) {
		throw error(404, "Blog page not found");
	}
	return blogContent.loadIndex(pages.length === 0 ? 1 : Number(pages[0]));
}) satisfies PageServerLoad;
