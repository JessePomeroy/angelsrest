/**
 * Shop Index - Server Load Function
 * Fetches all products and print collections from Sanity for the shop page.
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

	// Fetch print collections for the Prints category
	const collections = await client.fetch(`
    *[_type == "printCollection"] | order(orderRank, title asc) {
      title,
      "slug": slug.current,
      "coverImage": coverImage.asset->{
        _ref,
        assetId,
        metadata
      },
      "alt": coverImage.alt,
      description
    }
  `);

	// Build collection cover URLs
	const collectionsWithImages = collections.map((collection: any) => ({
		...collection,
		coverImage: collection.coverImage
			? urlFor(collection.coverImage)
					.width(600)
					.format("webp")
					.quality(80)
					.url()
			: null,
	}));

	return {
		products: productsWithOptimizedImages,
		collections: collectionsWithImages,
	};
}
