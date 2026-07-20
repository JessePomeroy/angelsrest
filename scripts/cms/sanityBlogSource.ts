import type { SanityClient } from "@sanity/client";
import type { SanityBlogImportSource } from "../../packages/crm-api/convex/helpers/sanityBlogImport";

export { readSanitySourceConfig as readSanityBlogSourceConfig } from "./sanitySourceConfig";

/** One shared, deterministic projection for dry-run and execution planning. */
export function sanityBlogSourceQuery() {
	return `{
		"authors": *[_type == "author"] | order(_id asc) {
			_id,
			_type,
			name,
			slug,
			image {
				_key,
				asset,
				alt,
				caption
			},
			bio
		},
		"categories": *[_type == "category"] | order(_id asc) {
			_id,
			_type,
			title,
			description
		},
		"posts": *[_type == "post"] | order(_id asc) {
			_id,
			_type,
			title,
			postType,
			slug,
			author,
			mainImage {
				_key,
				asset,
				alt,
				caption
			},
			categories,
			publishedAt,
			brief,
			approach,
			result,
			gearUsed,
			body
		}
	}`;
}

export async function fetchPublishedSanityBlogSource(client: SanityClient) {
	return await client.fetch<SanityBlogImportSource>(
		sanityBlogSourceQuery(),
		{},
		{ perspective: "published" },
	);
}
