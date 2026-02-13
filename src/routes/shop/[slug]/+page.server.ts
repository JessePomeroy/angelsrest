/**
 * Product Detail - Server Load Function
 * Fetches a single product by slug from Sanity.
 * The [slug] in the folder name becomes params.slug.
 */

import { client } from '$lib/sanity/client';
import { urlFor } from '$lib/sanity/client';
import { error } from '@sveltejs/kit';

export async function load({ params }) {
  // Fetch the product matching this slug
  // $slug is a parameterized query variable (prevents injection)
  const product = await client.fetch(`
    *[_type == "product" && slug.current == $slug][0]{
      title,
      description,
      price,
      category,
      featured,
      inStock,
      images[]
    }
  `, { slug: params.slug });
  
  // If no product found, throw a 404 error
  if (!product) throw error(404, 'Product not found');

  // Build optimized image URLs
  // - thumbnail: 400px for gallery grid (webp, 80% quality)
  // - full: 1200px for main product image (webp, 90% quality)
  const optimizedImages = product.images.map((image: any) => ({
    thumbnail: urlFor(image).width(400).format('webp').quality(80).url(),
    full: urlFor(image).width(1200).format('webp').quality(90).url(),
    alt: image.alt || product.title
  }));

  return { 
    product: {
      ...product,
      slug: params.slug,
      images: optimizedImages
    }
  };
}