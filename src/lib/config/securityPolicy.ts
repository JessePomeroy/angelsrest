export const contentSecurityPolicy =
	"default-src 'self'; script-src https://app.cal.com 'self' 'unsafe-inline' https://va.vercel-scripts.com https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://api.fontshare.com; img-src 'self' https://gallery-worker.thinkingofview.workers.dev https://media.angelsrest.online data: blob:; media-src 'self' https://gallery-worker.thinkingofview.workers.dev; font-src 'self' https://api.fontshare.com https://cdn.fontshare.com; connect-src 'self' wss://*.convex.cloud https://*.convex.cloud https://*.sentry.io https://va.vercel-scripts.com https://gallery-worker.thinkingofview.workers.dev https://cms-media-worker.thinkingofview.workers.dev; frame-src https://app.cal.com https://challenges.cloudflare.com; frame-ancestors 'none'";

/** Delivery uploads and playback follow the host's server-owned Worker origin. */
export function getContentSecurityPolicy(galleryWorkerUrl?: string): string {
	if (!galleryWorkerUrl) return contentSecurityPolicy;
	let origin: string;
	try {
		const parsed = new URL(galleryWorkerUrl);
		if (parsed.protocol !== "https:" || parsed.origin !== galleryWorkerUrl.replace(/\/+$/, "")) {
			return contentSecurityPolicy;
		}
		origin = parsed.origin;
	} catch {
		return contentSecurityPolicy;
	}
	return contentSecurityPolicy
		.split("; ")
		.map((directive) => {
			const [name, ...sources] = directive.split(" ");
			return ["connect-src", "img-src", "media-src"].includes(name) && !sources.includes(origin)
				? `${directive} ${origin}`
				: directive;
		})
		.join("; ");
}
