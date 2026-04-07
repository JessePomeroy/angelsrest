import { client } from "$lib/sanity/client";

export async function load() {
	const galleries = await client.fetch(`
		*[_type == "gallery"] | order(orderRank) {
			_id, title, "slug": slug.current, "imageCount": count(images), featured, isVisible
		}
	`);

	return {
		galleries,
	};
}
