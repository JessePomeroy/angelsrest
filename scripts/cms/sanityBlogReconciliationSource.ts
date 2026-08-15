import type { SanityClient } from "@sanity/client";
import type { SanityBlogReconciliationSource } from "../../packages/crm-api/convex/helpers/sanityBlogReconciliationPlan";

/** Full documents keep unexpected fields visible to the fail-closed decision inventory. */
export function sanityBlogReconciliationSourceQuery() {
	return `{
		"authors": *[_type == "author"] | order(_id asc) {
			...,
			_id,
			_rev,
			_type
		},
		"categories": *[_type == "category"] | order(_id asc) {
			...,
			_id,
			_rev,
			_type
		},
		"posts": *[_type == "post"] | order(_id asc) {
			...,
			_id,
			_rev,
			_type
		}
	}`;
}

export async function fetchPublishedSanityBlogReconciliationSource(client: SanityClient) {
	return await client.fetch<SanityBlogReconciliationSource>(
		sanityBlogReconciliationSourceQuery(),
		{},
		{ perspective: "published" },
	);
}
