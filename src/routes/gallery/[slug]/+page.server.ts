/**
 * Gallery Detail - Server Load Function
 * Fetches a single published gallery by slug from the public content boundary.
 * The [slug] in the folder name becomes params.slug.
 */

import { error } from "@sveltejs/kit";
import { portfolioContent } from "$lib/server/current/portfolioContent.server";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, parent, url }) => {
	const preview = url.searchParams.has("draftPreview") ? (await parent()).draftPreview : null;
	const gallery =
		preview?.kind === "portfolio" ? preview.gallery : await portfolioContent.getBySlug(params.slug);
	if (!gallery) throw error(404, "Gallery not found");
	return { gallery };
};
