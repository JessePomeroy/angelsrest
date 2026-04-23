import { createClient } from "@sanity/client";
import { createImageUrlBuilder, type SanityImageSource } from "@sanity/image-url";
import { env } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";

/**
 * Default Sanity client: public, CDN-cached, published content only.
 */
export const client = createClient({
	projectId: publicEnv.PUBLIC_SANITY_PROJECT_ID,
	dataset: publicEnv.PUBLIC_SANITY_DATASET || "production",
	apiVersion: "2024-01-01",
	useCdn: true,
});

/**
 * Preview-mode Sanity client (audit H48). Returns drafts by using the
 * `previewDrafts` perspective + a viewer-with-drafts token. Only
 * instantiated when `SANITY_PREVIEW_TOKEN` is set; otherwise we fall
 * back to the public client so dev works without the token.
 *
 * Callers obtain this via `getSanityClient(event.locals.isPreview)`
 * so the same load functions serve drafts inside Sanity Presentation
 * and published content everywhere else.
 */
const previewClient = env.SANITY_PREVIEW_TOKEN
	? createClient({
			projectId: publicEnv.PUBLIC_SANITY_PROJECT_ID,
			dataset: publicEnv.PUBLIC_SANITY_DATASET || "production",
			apiVersion: "2024-01-01",
			useCdn: false,
			token: env.SANITY_PREVIEW_TOKEN,
			perspective: "previewDrafts",
		})
	: null;

/**
 * Pick the right Sanity client for this request. Pass
 * `event.locals.isPreview` from a SvelteKit load; returns the preview
 * client when the flag is true AND the token is configured, otherwise
 * the public client.
 */
export function getSanityClient(isPreview: boolean) {
	if (isPreview && previewClient) return previewClient;
	return client;
}

const builder = createImageUrlBuilder(client);

export function urlFor(source: SanityImageSource) {
	return builder.image(source);
}
