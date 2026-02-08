/**
 * Single Blog Post - Server Load Function
 * 
 * This file fetches a SINGLE post by its slug.
 * 
 * The folder name [slug] is a DYNAMIC ROUTE:
 * - /blog/my-first-post → params.slug = "my-first-post"
 * - /blog/photography-tips → params.slug = "photography-tips"
 * 
 * The brackets [] tell SvelteKit "this part of the URL is a variable"
 */

import { client } from '$lib/sanity/client';
import { error } from '@sveltejs/kit';

/**
 * The load function receives a context object with useful properties.
 * We destructure `params` from it, which contains URL parameters.
 * 
 * params.slug comes from the folder name [slug]
 */
export const load = async ({ params }) => {
  /**
   * GROQ Query Breakdown:
   * 
   * *[_type == "post" && slug.current == $slug]
   *   ↑ Filter: type is "post" AND slug matches our parameter
   * 
   * [0]
   *   ↑ Get first result (there should only be one with this slug)
   * 
   * $slug is a query parameter - we pass it in the second argument
   * to client.fetch(). This is safer than string interpolation
   * (prevents injection attacks).
   */
  const post = await client.fetch(
    `
    *[_type == "post" && slug.current == $slug][0] {
      _id,
      title,
      slug,
      publishedAt,
      mainImage,
      body,
      author->{
        name,
        image,
        bio
      },
      categories[]->{
        title
      }
    }
  `,
    { slug: params.slug }  // Pass the slug as a query parameter
  );

  /**
   * Error handling:
   * If no post was found, throw a 404 error.
   * SvelteKit will show the nearest +error.svelte page.
   */
  if (!post) {
    throw error(404, 'Post not found');
  }

  // Return the post data to +page.svelte
  return { post };
};
