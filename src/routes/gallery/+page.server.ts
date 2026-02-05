/**
 * Gallery Index - Server Load Function
 * Fetches all galleries from Sanity for the gallery picker page.
 */

import { client } from '$lib/sanity/client';
import { urlFor } from '$lib/sanity/image';

export async function load() {
  // Fetch all galleries, ordered by the drag-and-drop orderRank field
  const galleries = await client.fetch(`
    *[_type == "gallery"] | order(orderRank) {
      title,
      "slug": slug.current,
      "previewImage": images[0],
      category
    }
  `);

  // Build optimized preview URLs (600px wide, webp, 80% quality)
  const galleriesWithOptimizedImages = galleries.map((gallery: any) => ({
    ...gallery,
    preview: gallery.previewImage 
      ? urlFor(gallery.previewImage).width(600).format('webp').quality(80).url()
      : null
  }));

  return { galleries: galleriesWithOptimizedImages };
}
