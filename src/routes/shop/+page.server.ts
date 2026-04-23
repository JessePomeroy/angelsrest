/**
 * Shop Index — Server Load Function
 *
 * Fetches data for the shop page:
 * 1. V2 print products (lumaProductV2) — the primary prints catalog
 * 2. V1 products (product) — postcards, tapestries, digital, merchandise
 * 3. Print collections — hierarchical groups
 * 4. V2 print sets (lumaPrintSetV2) — curated bundles
 * 5. V1 print sets (printSet) — legacy bundles not yet migrated
 *
 * V2 and V1 products are merged into a single list for display. The page
 * component doesn't need to distinguish between them — URLs work the same
 * (/shop/[slug] handles both types).
 */

import { getSanityClient } from "$lib/sanity/client";
import { imageSet, previewUrl } from "$lib/utils/images";

export async function load({ locals }) {
	const sanity = getSanityClient(locals.isPreview);
	// V2 print products
	const v2Products = await sanity.fetch(`
		*[_type == "lumaProductV2" && inStock == true]
		| order(featured desc, title asc) {
			title,
			"slug": slug.current,
			"previewImage": image,
			"category": "prints",
			featured,
			inStock,
			"startingPrice": variants[enabled == true] | order(retailPrice asc) [0].retailPrice
		}
	`);

	const v2WithImages = (v2Products as any[]).map((p) => ({
		...p,
		preview: previewUrl(p.previewImage),
		price: p.startingPrice,
	}));

	// V1 products (non-print: postcards, tapestries, digital, merchandise)
	const v1Products = await sanity.fetch(`
		*[_type == "product" && inStock == true]
		| order(featured desc, orderRank, title asc) {
			title,
			"slug": slug.current,
			"previewImage": images[0],
			price,
			category,
			featured,
			inStock,
			"collection": collection->{
				"slug": slug.current,
				title
			}
		}
	`);

	const v1WithImages = (v1Products as any[]).map((p) => ({
		...p,
		preview: previewUrl(p.previewImage),
	}));

	// Merge V2 + V1 into a single products list, featured items first
	const products = [...v2WithImages, ...v1WithImages].sort(
		(a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0),
	);

	// Print collections (shared by V1 and V2)
	const collections = await sanity.fetch(`
		*[_type == "printCollection" && !defined(parent)]
		| order(orderRank, title asc) {
			title,
			"slug": slug.current,
			previewImage,
			description
		}
	`);

	const collectionsWithImages = (collections as any[]).map((c) => ({
		...c,
		alt: c.previewImage?.alt || "",
		previewImage: previewUrl(c.previewImage),
	}));

	// V2 print sets
	const v2Sets = await sanity.fetch(`
		*[_type == "lumaPrintSetV2" && inStock == true]
		| order(featured desc, title asc) {
			title,
			"slug": slug.current,
			images[0..1],
			previewImage,
			description,
			"startingPrice": variants[enabled == true] | order(retailPrice asc) [0].retailPrice
		}
	`);

	const v2SetsWithImages = (v2Sets as any[]).map((s) => ({
		...s,
		preview1: imageSet(s.images?.[0])?.thumb,
		preview2: imageSet(s.images?.[1])?.thumb,
		previewImage: previewUrl(s.previewImage),
		price: s.startingPrice,
	}));

	// V1 print sets (legacy — will be migrated to V2)
	const v1Sets = await sanity.fetch(`
		*[_type == "printSet" && !defined(parent) && inStock == true]
		| order(featured desc, orderRank, title asc) {
			title,
			"slug": slug.current,
			images[0..1],
			previewImage,
			price,
			description
		}
	`);

	const v1SetsWithImages = (v1Sets as any[]).map((s) => ({
		...s,
		preview1: imageSet(s.images?.[0])?.thumb,
		preview2: imageSet(s.images?.[1])?.thumb,
		previewImage: previewUrl(s.previewImage),
	}));

	// Merge V2 + V1 print sets
	const printSets = [...v2SetsWithImages, ...v1SetsWithImages];

	return {
		products,
		collections: collectionsWithImages,
		printSets,
	};
}
