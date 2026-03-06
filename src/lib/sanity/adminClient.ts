import { createClient } from "@sanity/client";
import { env } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";

/**
 * Admin client for Sanity with write permissions
 *
 * ⚠️ IMPORTANT: This client has write access!
 * Only use this in server-side code (API routes, webhooks)
 * Never expose the write token to the frontend
 *
 * @see https://www.sanity.io/docs/js-client
 */
export const adminClient = createClient({
	projectId: publicEnv.PUBLIC_SANITY_PROJECT_ID,
	dataset: publicEnv.PUBLIC_SANITY_DATASET || "production",
	apiVersion: "2024-01-01",
	useCdn: false, // Don't use CDN for writes - we need fresh data
	token: env.SANITY_WRITE_TOKEN, // Write token from .env
});
