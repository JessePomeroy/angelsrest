import type { SanityClient } from "@sanity/client";
import type { SanityCatalogImportSource } from "../../packages/crm-api/convex/helpers/sanityCatalogImport";

/** One shared deterministic source projection for catalog dry-run and import planning. */
export function sanityCatalogSourceQuery() {
	return `{
		"prints": *[_type == "lumaProductV2"] | order(_id asc) {
			_id,
			_type,
			_rev,
			_createdAt,
			_updatedAt,
			title,
			"slug": slug.current,
			image {
				_key,
				"assetRef": asset._ref,
				"assetSource": asset->{ _id, _rev },
				alt
			},
			description,
			variants[] {
				_key,
				paper,
				size,
				retailPrice,
				enabled
			},
			bordersEnabled,
			framedEnabled,
			frameMarkupMultiplier,
			inStock,
			featured
		},
		"sets": *[_type == "lumaPrintSetV2"] | order(_id asc) {
			_id,
			_type,
			_rev,
			_createdAt,
			_updatedAt,
			title,
			"slug": slug.current,
			previewImage {
				_key,
				"assetRef": asset._ref,
				"assetSource": asset->{ _id, _rev },
				alt
			},
			description,
			images[] {
				_key,
				"assetRef": asset._ref,
				"assetSource": asset->{ _id, _rev },
				alt
			},
			"parentRef": parent._ref,
			variants[] {
				_key,
				paper,
				size,
				retailPrice,
				enabled
			},
			bordersEnabled,
			framedEnabled,
			frameMarkupMultiplier,
			inStock,
			featured
		},
		"general": *[_type == "product"] | order(_id asc) {
			_id,
			_type,
			_rev,
			_createdAt,
			_updatedAt,
			orderRank,
			title,
			"slug": slug.current,
			images[] {
				_key,
				"assetRef": asset._ref,
				"assetSource": asset->{ _id, _rev },
				alt
			},
			description,
			price,
			category,
			"collectionRef": collection._ref,
			"digitalFileRef": digitalFile.asset._ref,
			"digitalFileAsset": digitalFile.asset->{
				_id,
				_rev,
				originalFilename,
				mimeType,
				size
			},
			digitalFileVersion,
			availablePapers,
			inStock,
			featured,
			seo {
				description,
				ogImage {
					_key,
					"assetRef": asset._ref,
					"assetSource": asset->{ _id, _rev },
					alt
				}
			}
		},
		"collections": *[_type == "printCollection"] | order(_id asc) {
			_id,
			_type,
			_rev,
			_createdAt,
			_updatedAt,
			title,
			"slug": slug.current,
			"parentRef": parent._ref
		},
		"coupons": *[_type == "coupon"] | order(_id asc) {
			_id,
			_type,
			_rev,
			_createdAt,
			_updatedAt,
			code
		}
	}`;
}

export async function fetchPublishedSanityCatalogSource(client: SanityClient) {
	return await client.fetch<SanityCatalogImportSource>(
		sanityCatalogSourceQuery(),
		{},
		{ perspective: "published" },
	);
}
