import { createClient } from "@sanity/client";
import { env } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { client } from "./client";

/**
 * Preview-mode Sanity client (audit H48). Returns drafts by using the
 * `previewDrafts` perspective + a viewer-with-drafts token. Only
 * instantiated when `SANITY_PREVIEW_TOKEN` is set; otherwise we fall
 * back to the public client so dev works without the token.
 *
 * Lives in `client.server.ts` (rather than `client.ts`) because it
 * reads `SANITY_PREVIEW_TOKEN` from `$env/dynamic/private`, which
 * SvelteKit's import guard correctly refuses to bundle into browser
 * code. The browser-safe pieces (`client`, `urlFor`) live in `./client`.
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
