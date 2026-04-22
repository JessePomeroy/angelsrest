import { client } from "$lib/sanity/client";

export async function load({ parent }) {
	const { isAuthenticated } = await parent();
	if (!isAuthenticated) return { galleries: [] as unknown[] };

	const galleries = await client.fetch(`
		*[_type == "gallery"] | order(orderRank) {
			_id, title, "slug": slug.current, "imageCount": count(images), featured, isVisible
		}
	`);

	return {
		galleries,
	};
}
