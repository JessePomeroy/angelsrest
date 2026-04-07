/**
 * Print Set Detail - Server Load Function
 *
 * Fetches a print set and its images from Sanity.
 *
 * Image handling:
 * - Thumbnails: 400px webp for grid display
 * - Full display: 1200px webp for lightbox
 * - Original: full quality for LumaPrints printing
 */

import { error } from "@sveltejs/kit";
import { client } from "$lib/sanity/client";
import type { PrintSet } from "$lib/types/shop";
import { imageSet, previewUrl } from "$lib/utils/images";

export async function load({ params }) {
	// Fetch the print set
	const printSet = await client.fetch(
		`*[_type == "printSet" && slug.current == $slug][0]{
			title,
			description,
			previewImage,
			images,
			price,
			availablePapers,
			"parent": parent->{
				title,
				"slug": slug.current
			}
		}`,
		{ slug: params.slug },
	);

	if (!printSet) {
		throw error(404, "Print set not found");
	}

	// Build preview image URL
	const previewImageUrl = previewUrl(printSet.previewImage);

	// Build image set for each image (thumb, full, original)
	const imagesWithUrls = (printSet.images || [])
		.map((image: any) => imageSet(image))
		.filter(Boolean);

	return {
		printSet: {
			title: printSet.title,
			description: printSet.description,
			previewImage: previewImageUrl,
			alt: printSet.previewImage?.alt || "",
			price: printSet.price,
			availablePapers: printSet.availablePapers || [],
			parent: printSet.parent,
			slug: params.slug,
		},
		images: imagesWithUrls,
	};
}
