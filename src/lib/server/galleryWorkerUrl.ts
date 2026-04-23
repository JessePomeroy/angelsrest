import { dev } from "$app/environment";
import { env } from "$env/dynamic/private";

/**
 * Resolve the gallery worker base URL. Audit H49: the old hardcoded
 * fallback silently routed to thinkingofview's worker if GALLERY_WORKER_URL
 * wasn't set — a foot-gun when the repo is cloned. Now throws in prod;
 * dev keeps the fallback for convenience.
 */
export function getGalleryWorkerUrl(): string {
	const url = env.GALLERY_WORKER_URL;
	if (url) return url;
	if (dev) return "https://gallery-worker.thinkingofview.workers.dev";
	throw new Error("GALLERY_WORKER_URL is not set. Configure it in Vercel environment variables.");
}
