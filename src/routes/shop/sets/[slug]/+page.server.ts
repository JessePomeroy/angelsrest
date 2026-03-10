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
      coverImage,
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
	const coverImageUrl = printSet.coverImage
		? urlFor(printSet.coverImage).width(800).format("webp").quality(80).url()
		: null;

	const imagesWithUrls = (printSet.images || []).map((image: any) => ({
		full: urlFor(image).width(1200).format("webp").quality(90).url(),
		thumb: urlFor(image).width(400).format("webp").quality(80).url(),
		alt: image.alt || "",
	}));

	return {
		printSet: {
			title: printSet.title,
			description: printSet.description,
			coverImage: coverImageUrl,
			alt: printSet.coverImage?.alt || "",
			price: printSet.price,
			availablePapers: printSet.availablePapers || [],
			parent: printSet.parent,
		},
		images: imagesWithUrls,
	};
}
