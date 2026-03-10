/**
 * Shop Index - Server Load Function
 * Fetches all products, print collections, and print sets from Sanity for the shop page.
 */

import { client, urlFor } from "$lib/sanity/client";

export async function load() {
	// Fetch all products that are in stock, ordered by custom order (orderRank), then featured status, then title
	const products = await client.fetch(`
    *[_type == "product" && inStock == true] | order(orderRank, featured desc, title asc) {
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

	// Build optimized preview URLs (600px wide, webp, 80% quality)
	const productsWithOptimizedImages = products.map((product: any) => ({
		...product,
		preview: product.previewImage
			? urlFor(product.previewImage).width(600).format("webp").quality(80).url()
			: null,
	}));

	// Fetch top-level print collections (no parent)
	const collections = await client.fetch(`
    *[_type == "printCollection" && !defined(parent)] | order(orderRank, title asc) {
      title,
      "slug": slug.current,
      previewImage,
      description,
      "previewProduct": *[_type == "product" && references(^._id)][0].images[0]
    }
  `);

	// Build collection cover URLs - fallback to first product's image
	const collectionsWithImages = collections.map((collection: any) => ({
		...collection,
		alt: collection.previewImage?.alt || "",
		previewImage: collection.previewImage
			? urlFor(collection.previewImage).width(600).format("webp").quality(80).url()
			: collection.previewProduct
				? urlFor(collection.previewProduct).width(600).format("webp").quality(80).url()
				: null,
	}));

	// Fetch top-level print sets (no parent)
	const printSets = await client.fetch(`
    *[_type == "printSet" && !defined(parent) && inStock == true] | order(orderRank, featured desc, title asc) {
      title,
      "slug": slug.current,
      images[0..1],
      previewImage,
      price,
      description
    }
  `);

	// Build print set preview images (first two images for half/half display)
	const printSetsWithImages = printSets.map((set: any) => ({
		...set,
		preview1: set.images?.[0] ? urlFor(set.images[0]).width(300).format("webp").quality(80).url() : null,
		preview2: set.images?.[1] ? urlFor(set.images[1]).width(300).format("webp").quality(80).url() : null,
		previewImage: set.previewImage ? urlFor(set.previewImage).width(600).format("webp").quality(80).url() : null,
	}));

	return {
		products: productsWithOptimizedImages,
		collections: collectionsWithImages,
		printSets: printSetsWithImages,
	};
}
