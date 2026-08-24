/**
 * Gallery Detail - Server Load Function
 * Fetches a single gallery by slug from Sanity.
 * The [slug] in the folder name becomes params.slug.
 */

import { error } from "@sveltejs/kit";
import { portfolioContent } from "$lib/server/portfolioContent.server";

export async function load({ params, locals }) {
	const gallery = await portfolioContent.getBySlug(params.slug, locals.isPreview);
	if (!gallery) throw error(404, "Gallery not found");
	return { gallery };
}
