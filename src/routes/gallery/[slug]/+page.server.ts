/**
 * Gallery Detail - Server Load Function
 * Fetches a single gallery by slug from Sanity.
 * The [slug] in the folder name becomes params.slug.
 */

import { client } from '$lib/sanity/client';
import { error } from '@sveltejs/kit';

export async function load({ params }) {
  // Fetch the gallery matching this slug
  // $slug is a parameterized query variable (prevents injection)
  const gallery = await client.fetch(`
    *[_type == "gallery" && slug.current == $slug][0]{
      title,
      images[]{
        "url": asset->url,
        alt
      }
    }
  `, { slug: params.slug });
  
  // If no gallery found, throw a 404 error
  if (!gallery) throw error(404, 'Gallery not found');

  // Return the gallery to the page component
  return { gallery };
}
