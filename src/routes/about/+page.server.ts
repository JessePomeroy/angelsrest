import { getSanityClient, urlFor } from "$lib/sanity/client";

export const load = async ({ locals }) => {
	const sanity = getSanityClient(locals.isPreview);
	const [about, contactPage] = await Promise.all([
		sanity.fetch(
			`*[_type == "about"][0]{
				name,
				portrait,
				bio,
				shortBio,
				email,
				social,
				seo{
					description,
					"ogImageUrl": ogImage.asset->url
				}
			}`,
		),
		sanity.fetch(
			`*[_type == "contactPage"][0]{
				heading,
				intro,
				email,
				phone,
				bookingEnabled,
				bookingUrl,
				bookingTypes[]{name, duration, startingPrice, description},
				seo{
					description,
					"ogImageUrl": ogImage.asset->url
				}
			}`,
		),
	]);

	return {
		about,
		contactPage,
		portraitUrl: about?.portrait ? urlFor(about.portrait).width(800).url() : null,
	};
};
