/**
 * Blog Listing Page - Server Load Function
 * 
 * This file runs on the SERVER only (not in the browser).
 * It fetches data before the page renders and passes it to +page.svelte.
 * 
 * The naming convention +page.server.ts means:
 * - +page = this is for a page route
 * - .server = runs only on server (safe for API keys, database calls)
 * - .ts = TypeScript
 */

import { client } from '$lib/sanity/client';

/**
 * The `load` function is a special SvelteKit function.
 * Whatever it returns becomes available as `data` in the corresponding +page.svelte.
 * 
 * This runs:
 * - On the server during SSR (Server-Side Rendering)
 * - On the server when navigating (SvelteKit fetches data before showing page)
 */
export const load = async () => {
  /**
   * GROQ Query Breakdown:
   * 
   * *[_type == "post"]              → Get all documents where type is "post"
   * | order(publishedAt desc)       → Sort by publishedAt, newest first
   * { ... }                         → Select only these fields (projection)
   * 
   * Inside the projection:
   * - _id, title, slug, etc.        → Direct fields from the post
   * - "excerpt": ...                → Computed field (creates a text preview)
   * - author->{ name, image }       → Follows the reference to author, gets their name/image
   * - categories[]->{ title }       → Follows array of category references, gets titles
   * 
   * The -> syntax "dereferences" a reference (follows the link to another document).
   */
  const posts = await client.fetch(`
    *[_type == "post"] | order(publishedAt desc) {
      _id,
      title,
      slug,
      publishedAt,
      mainImage,
      postType,
      "excerpt": array::join(string::split(pt::text(body), "")[0..200], "") + "...",
      author->{
        name,
        image
      },
      categories[]->{
        title
      }
    }
  `);

  /**
   * Return the data object.
   * This becomes `data.posts` in +page.svelte via:
   * let { data } = $props();
   * data.posts → the array we fetched
   */
  return { posts };
};
