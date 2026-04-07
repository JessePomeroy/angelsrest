import { createClient } from "@sanity/client";
import { env } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";

/**
 * Preview client for Sanity — used in Visual Editing / Presentation mode.
 *
 * This client:
 * - Uses the viewer token (read-only, can see drafts)
 * - Disables CDN (needs fresh data)
 * - Uses 'previewDrafts' perspective to see unpublished changes
 */
export const previewClient = createClient({
	projectId: publicEnv.PUBLIC_SANITY_PROJECT_ID,
	dataset: publicEnv.PUBLIC_SANITY_DATASET || "production",
	apiVersion: "2024-01-01",
	useCdn: false,
	token: env.SANITY_PREVIEW_TOKEN,
	perspective: "previewDrafts",
});
