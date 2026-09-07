// Immutable public assets in the existing Cloudflare R2 media bucket.
// Sources remain in src/lib/assets for reproducible replacement uploads.
export const publicAssets = {
	hero: "https://media.angelsrest.online/sites/angelsrest.online/site/clouds2-4e50727fe4b79453.gif",
	openGraph:
		"https://media.angelsrest.online/sites/angelsrest.online/site/og-image-3189eae23f5f64e7.png",
} as const;
