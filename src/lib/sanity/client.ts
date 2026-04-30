import { createClient } from "@sanity/client";
import { createImageUrlBuilder, type SanityImageSource } from "@sanity/image-url";
import { env as publicEnv } from "$env/dynamic/public";

/**
 * Default Sanity client: public, CDN-cached, published content only.
 * Browser-safe — does not read any private env vars, so it can be
 * imported from `+page.svelte` / browser components freely.
 *
 * The preview-aware variant (`getSanityClient`) lives in `./client.server`
 * because it needs `SANITY_PREVIEW_TOKEN` from `$env/dynamic/private`.
 * SvelteKit's `.server.ts` suffix prevents it from leaking into the
 * browser bundle.
 */
export const client = createClient({
	projectId: publicEnv.PUBLIC_SANITY_PROJECT_ID,
	dataset: publicEnv.PUBLIC_SANITY_DATASET || "production",
	apiVersion: "2024-01-01",
	useCdn: true,
});

const builder = createImageUrlBuilder(client);

export function urlFor(source: SanityImageSource) {
	return builder.image(source);
}
