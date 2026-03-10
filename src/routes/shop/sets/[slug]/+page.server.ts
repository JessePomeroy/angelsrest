/**
 * Print Set Detail - Server Load Function
 * Fetches a print set and its images from Sanity.
 */

import { error } from "@sveltejs/kit";
import { client, urlFor } from "$lib/sanity/client";

export async function load({ params }) {
	// Fetch the print set
	const printSet = await client.fetch(
		`
    *[_type == "printSet" && slug.current == $slug][0]{
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
    }
  `,
		{ slug: params.slug },
	);

	if (!printSet) {
		throw error(404, "Print set not found");
	}

	// Build optimized image URLs
	const previewImageUrl = printSet.previewImage
		? urlFor(printSet.previewImage).width(800).format("webp").quality(80).url()
		: null;

	const imagesWithUrls = (printSet.images || []).map((image: any) => ({
		full: urlFor(image).width(1200).format("webp").quality(90).url(),
		thumb: urlFor(image).width(400).format("webp").quality(80).url(),
		original: urlFor(image).url(), // Full original for LumaPrints
		alt: image.alt || "",
	}));

	return {
		printSet: {
			title: printSet.title,
			description: printSet.description,
			previewImage: previewImageUrl,
			alt: printSet.previewImage?.alt || "",
			price: printSet.price,
			availablePapers: printSet.availablePapers || [],
			parent: printSet.parent,
		},
		images: imagesWithUrls,
	};
}
