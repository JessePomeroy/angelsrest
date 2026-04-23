import { getSanityClient } from "$lib/sanity/client";

export async function load({ parent, locals }) {
	const { isAuthenticated } = await parent();
	if (!isAuthenticated) return { galleries: [] as unknown[] };

	const sanity = getSanityClient(locals.isPreview);
	const galleries = await sanity.fetch(`
		*[_type == "gallery"] | order(orderRank) {
			_id, title, "slug": slug.current, "imageCount": count(images), featured, isVisible
		}
	`);

	return {
		galleries,
	};
}
