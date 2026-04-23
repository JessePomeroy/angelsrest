import { getSanityClient } from "$lib/sanity/client";

export async function load({ locals }) {
	const sanity = getSanityClient(locals.isPreview);
	const siteSettings = await sanity.fetch(
		`*[_type == "siteSettings"][0]{
			artistName,
			siteTitle,
			tagline,
			"logoUrl": logo.asset->url,
			socialLinks[]{platform, url},
			seo{
				description,
				"ogImageUrl": ogImage.asset->url,
				keywords
			}
		}`,
	);

	return {
		isPreview: locals.isPreview ?? false,
		siteSettings,
	};
}
