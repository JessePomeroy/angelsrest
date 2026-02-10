/**
 * Gallery Detail - Server Load Function
 * Fetches a single gallery by slug from Sanity.
 * The [slug] in the folder name becomes params.slug.
 */

import { client } from '$lib/sanity/client';
import { urlFor } from '$lib/sanity/client';
import { error } from '@sveltejs/kit';

export async function load({ params }) {
  // Fetch the gallery matching this slug
  // $slug is a parameterized query variable (prevents injection)
  const gallery = await client.fetch(`
    *[_type == "gallery" && slug.current == $slug][0]{
      title,
      images[]
    }
  `, { slug: params.slug });
  
  // If no gallery found, throw a 404 error
  if (!gallery) throw error(404, 'Gallery not found');

  // Build optimized image URLs
  // - thumbnail: 400px for grid view (webp, 80% quality)
  // - full: 1600px for lightbox (webp, 90% quality)
  const optimizedImages = gallery.images.map((image: any) => ({
    thumbnail: urlFor(image).width(400).format('webp').quality(80).url(),
    full: urlFor(image).width(1600).format('webp').quality(90).url(),
    alt: image.alt || ''
  }));

  return { 
    gallery: {
      title: gallery.title,
      images: optimizedImages
    }
  };
}
