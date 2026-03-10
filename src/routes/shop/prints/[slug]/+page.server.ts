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
      coverImage,
      "parent": parent->{
        title,
        "slug": slug.current
      }
    }
  `,
		{ slug: params.slug },
	);

	if (!collection) {
		throw error(404, "Collection not found");
	}

	// Fetch sub-collections (child collections)
	const subCollections = await client.fetch(
		`
    *[_type == "printCollection" && references(*[_type == "printCollection" && slug.current == $slug]._id)] | order(orderRank, title asc) {
      title,
      "slug": slug.current,
      coverImage
    }
  `,
		{ slug: params.slug },
	);

	// Fetch print sets in this collection
	const printSets = await client.fetch(
		`
    *[_type == "printSet" && references(*[_type == "printCollection" && slug.current == $slug]._id) && inStock == true] | order(orderRank, title asc) {
      title,
      "slug": slug.current,
      images[0..1],
      coverImage,
      price
    }
  `,
		{ slug: params.slug },
	);

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

	// Build sub-collection cover URLs
	const subCollectionsWithImages = subCollections.map((sub: any) => ({
		...sub,
		alt: sub.coverImage?.alt || "",
		coverImage: sub.coverImage
			? urlFor(sub.coverImage).width(600).format("webp").quality(80).url()
			: null,
	}));

	// Build print set cover URLs
	const printSetsWithImages = printSets.map((set: any) => ({
		...set,
		preview1: set.images?.[0] ? urlFor(set.images[0]).width(300).format("webp").quality(80).url() : null,
		preview2: set.images?.[1] ? urlFor(set.images[1]).width(300).format("webp").quality(80).url() : null,
		coverImage: set.coverImage ? urlFor(set.coverImage).width(600).format("webp").quality(80).url() : null,
	}));

	return {
		collection: {
			title: collection.title,
			description: collection.description,
			coverImage: coverImageUrl,
			alt: collection.coverImage?.alt || "",
			parent: collection.parent,
		},
		subCollections: subCollectionsWithImages,
		printSets: printSetsWithImages,
		products: productsWithImages,
	};
}
