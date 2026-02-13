/**
 * Product Detail Server Load Function
 * 
 * This demonstrates SvelteKit's server-side data loading pattern.
 * Key benefits:
 * 1. SEO-friendly (server-rendered content)
 * 2. Fast initial page loads
 * 3. Type safety with TypeScript
 * 4. Automatic error handling
 * 5. Data pre-loading before component renders
 * 
 * File Naming Convention:
 * - +page.server.ts runs on the server only
 * - +page.ts runs on both server and client
 * - +page.svelte is the component that renders
 * 
 * The [slug] in the folder name becomes params.slug in this function.
 */

import { client } from '$lib/sanity/client';
import { urlFor } from '$lib/sanity/client';
import { error } from '@sveltejs/kit';

/**
 * Load Function - SvelteKit's Data Loading Pattern
 * 
 * This function runs before the page component renders.
 * It receives context from SvelteKit including:
 * - params: URL parameters (our [slug])
 * - url: Full URL object
 * - request: HTTP request object
 * - locals: Server-side locals object
 * 
 * Return Value:
 * - Returned object becomes the 'data' prop in the component
 * - Must be serializable (no functions, classes, etc.)
 * - Automatically typed in the component
 */
export async function load({ params }) {
  /**
   * Sanity Query with Security
   * 
   * GROQ (Graph-Relational Object Queries) is Sanity's query language.
   * 
   * Security Features:
   * - $slug parameterized query prevents injection attacks
   * - [0] ensures single result (not array)
   * - Specific field selection reduces payload size
   * 
   * Query Breakdown:
   * - *[_type == "product"] : Find all product documents
   * - && slug.current == $slug : Where slug matches our URL
   * - { ... } : Project specific fields only
   * - images[] : Include all images in the array
   */
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
  `, { 
    slug: params.slug // Parameterized queries prevent injection
  });
  
  /**
   * 404 Error Handling
   * 
   * SvelteKit's error() function:
   * - Throws an HTTP error response
   * - Automatically renders error page
   * - SEO-friendly 404 status code
   * - Prevents component from rendering with null data
   */
  if (!product) throw error(404, 'Product not found');

  /**
   * Image Optimization Strategy
   * 
   * Sanity's urlFor() helper generates optimized image URLs.
   * We create multiple sizes for different use cases:
   * 
   * Performance Benefits:
   * - Smaller file sizes load faster
   * - WebP format for modern browsers
   * - Quality optimization balances size vs appearance
   * - Responsive images for different screen sizes
   * 
   * Use Cases:
   * - thumbnail: Product grid listings
   * - full: Main product display and lightbox
   */
  const optimizedImages = product.images.map((image: any) => ({
    /**
     * Thumbnail Images (400px)
     * 
     * Used in:
     * - Product grid thumbnails
     * - Related products
     * - Shopping cart displays
     * 
     * Configuration:
     * - 400px max width (good for grid layouts)
     * - WebP format (smaller file sizes)
     * - 80% quality (good balance for thumbnails)
     */
    thumbnail: urlFor(image).width(400).format('webp').quality(80).url(),
    
    /**
     * Full Size Images (1200px)
     * 
     * Used in:
     * - Main product display
     * - Lightbox modal
     * - High-resolution viewing
     * 
     * Configuration:
     * - 1200px max width (retina-friendly)
     * - WebP format (better compression)
     * - 90% quality (high quality for main display)
     */
    full: urlFor(image).width(1200).format('webp').quality(90).url(),
    
    /**
     * Alt Text for Accessibility
     * 
     * Fallback strategy:
     * 1. Use image's alt text if provided
     * 2. Fall back to product title
     * 
     * This ensures screen readers always have descriptive text.
     */
    alt: image.alt || product.title
  }));

  /**
   * Return Data to Component
   * 
   * Structure returned here becomes 'data' prop in component.
   * 
   * Key Additions:
   * - slug: Added from URL params (needed for checkout)
   * - images: Replaced with optimized versions
   * - All other product fields pass through unchanged
   * 
   * TypeScript Benefits:
   * - Automatic type inference in component
   * - Compile-time checks for data access
   * - IDE autocomplete for data properties
   */
  return { 
    product: {
      ...product,                    // Spread original product data
      slug: params.slug,             // Add slug from URL for checkout
      images: optimizedImages        // Replace with optimized images
    }
  };
}

/**
 * Advanced Patterns for Production:
 * 
 * 1. Caching Strategy:
 * ```typescript
 * export async function load({ params, setHeaders }) {
 *   // Cache for 1 hour, revalidate in background
 *   setHeaders({
 *     'Cache-Control': 'max-age=3600, stale-while-revalidate=86400'
 *   });
 *   // ... rest of function
 * }
 * ```
 * 
 * 2. Related Products:
 * ```typescript
 * // Add to existing query
 * const [product, relatedProducts] = await Promise.all([
 *   client.fetch(productQuery, { slug: params.slug }),
 *   client.fetch(`
 *     *[_type == "product" && category == $category && slug.current != $slug][0...4] {
 *       title, "slug": slug.current, "image": images[0], price
 *     }
 *   `, { category: product.category, slug: params.slug })
 * ]);
 * ```
 * 
 * 3. Inventory Tracking:
 * ```typescript
 * // Add inventory check
 * const inventory = await getInventoryLevel(product._id);
 * return {
 *   product: {
 *     ...product,
 *     inventoryLevel: inventory,
 *     isLowStock: inventory < 5
 *   }
 * };
 * ```
 * 
 * 4. User-Specific Data:
 * ```typescript
 * export async function load({ params, locals }) {
 *   const product = await getProduct(params.slug);
 *   
 *   // Check if user owns this product
 *   const userPurchases = locals.user 
 *     ? await getUserPurchases(locals.user.id)
 *     : [];
 *   
 *   return {
 *     product: {
 *       ...product,
 *       isPurchased: userPurchases.includes(product._id)
 *     }
 *   };
 * }
 * ```
 * 
 * 5. A/B Testing:
 * ```typescript
 * export async function load({ params, cookies }) {
 *   const product = await getProduct(params.slug);
 *   const variant = cookies.get('test_variant') || 'control';
 *   
 *   return {
 *     product,
 *     testVariant: variant,
 *     showReviews: variant === 'reviews_enabled'
 *   };
 * }
 * ```
 * 
 * 6. Analytics Data:
 * ```typescript
 * export async function load({ params, getClientAddress }) {
 *   const product = await getProduct(params.slug);
 *   
 *   // Track page view (fire and forget)
 *   analytics.track('product_viewed', {
 *     productId: product._id,
 *     category: product.category,
 *     price: product.price,
 *     ip: getClientAddress()
 *   }).catch(console.error);
 *   
 *   return { product };
 * }
 * ```
 */