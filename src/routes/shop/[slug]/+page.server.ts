/**
 * Product Detail — Server Load Function
 *
 * Handles both V2 print products (lumaProductV2) and V1 products
 * (postcards, tapestries, digital, merchandise). Tries V2 first,
 * falls back to V1.
 */

import { error } from "@sveltejs/kit";
import { client } from "$lib/sanity/client";
import { displayUrl, originalUrl, thumbnailUrl } from "$lib/utils/images";

const V2_QUERY = `
  *[_type == "lumaProductV2" && slug.current == $slug][0]{
    title,
    description,
    image,
    variants[enabled == true]{paper, size, retailPrice, borderWidth},
    inStock,
    featured
  }
`;

const V1_QUERY = `
  *[_type == "product" && slug.current == $slug][0]{
    title,
    description,
    price,
    category,
    featured,
    inStock,
    images[],
    availablePapers[]{
      name,
      price,
      subcategoryId,
      width,
      height
    },
    seo{
      description,
      "ogImageUrl": ogImage.asset->url
    }
  }
`;

export async function load({ params }) {
	const slug = params.slug;

	// Try V2 first (prints)
	const v2Product = await client.fetch(V2_QUERY, { slug });

	if (v2Product) {
		const image = v2Product.image;
		return {
			productType: "v2" as const,
			product: {
				title: v2Product.title,
				slug,
				description: v2Product.description,
				variants: v2Product.variants || [],
				inStock: v2Product.inStock ?? true,
				featured: v2Product.featured ?? false,
				images: image
					? [
							{
								thumbnail: thumbnailUrl(image),
								full: displayUrl(image),
								original: originalUrl(image),
								alt: image.alt || v2Product.title,
							},
						]
					: [],
			},
		};
	}

	// Fall back to V1 (merch, postcards, tapestries, digital)
	const v1Product = await client.fetch(V1_QUERY, { slug });

	if (!v1Product) throw error(404, "Product not found");

	const optimizedImages = (v1Product.images || []).map((image: any) => ({
		thumbnail: thumbnailUrl(image),
		full: displayUrl(image),
		original: originalUrl(image),
		alt: image.alt || v1Product.title,
	}));

	return {
		productType: "v1" as const,
		product: {
			...v1Product,
			slug,
			images: optimizedImages,
		},
	};
}
