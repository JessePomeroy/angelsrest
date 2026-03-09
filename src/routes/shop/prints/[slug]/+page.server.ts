/**
 * Print Collection Detail - Server Load Function
 * Fetches a print collection and its products from Sanity.
 */

import { error } from "@sveltejs/kit";
import { client, urlFor } from "$lib/sanity/client";

export async function load({ params }) {
	// Fetch the collection
	const collection = await client.fetch(
		`
    *[_type == "printCollection" && slug.current == $slug][0]{
      title,
      description,
      "coverImage": coverImage.asset->{
        _ref,
        assetId,
        metadata
      },
      "alt": coverImage.alt
    }
  `,
		{ slug: params.slug },
	);

	if (!collection) {
		throw error(404, "Collection not found");
	}

	// Fetch all products in this collection
	const products = await client.fetch(
		`
    *[_type == "product" && references(*[_type == "printCollection" && slug.current == $slug]._id) && inStock == true] | order(orderRank, title asc) {
      title,
      "slug": slug.current,
      "previewImage": images[0],
      price
    }
  `,
		{ slug: params.slug },
	);

	// Build optimized image URLs
	const coverImageUrl = collection.coverImage
		? urlFor(collection.coverImage).width(800).format("webp").quality(80).url()
		: null;

	const productsWithImages = products.map((product: any) => ({
		...product,
		preview: product.previewImage
			? urlFor(product.previewImage).width(600).format("webp").quality(80).url()
			: null,
	}));

	return {
		collection: {
			title: collection.title,
			description: collection.description,
			coverImage: coverImageUrl,
			alt: collection.alt,
		},
		products: productsWithImages,
	};
}
