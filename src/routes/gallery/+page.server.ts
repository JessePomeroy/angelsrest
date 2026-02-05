/**
 * Gallery Index - Server Load Function
 * Fetches all galleries from Sanity for the gallery picker page.
 */

import { client } from '$lib/sanity/client';

export async function load() {
  // Fetch all galleries, ordered by the drag-and-drop orderRank field
  // (set via @sanity/orderable-document-list in the studio)
  const galleries = await client.fetch(`
    *[_type == "gallery"] | order(orderRank) {
      title,
      "slug": slug.current,
      "preview": images[0].asset->url,
      category
    }
  `);

  // Return galleries to the page component via data prop
  return { galleries };
}
