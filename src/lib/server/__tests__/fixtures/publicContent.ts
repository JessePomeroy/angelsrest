import { SITE_DOMAIN } from "$lib/config/site";

export const assetId = "10000000-0000-4000-8000-000000000001";
export const assetRoot = `https://media.${SITE_DOMAIN}/sites/${SITE_DOMAIN}/web/${assetId}`;
export const sourceSha256 = "a".repeat(64);

/** A published 3000×2000 source and its accepted, immutable Worker derivatives. */
export function webAsset() {
	const derivative = (filename: string, width: number, height: number) => ({
		key: `sites/${SITE_DOMAIN}/web/${assetId}/${filename}.webp`,
		contentType: "image/webp",
		width,
		height,
	});
	return {
		assetId,
		source: { width: 3000, height: 2000 },
		derivatives: {
			thumb: derivative("thumb", 320, 213),
			card: derivative("card", 768, 512),
			display1280: derivative("display-1280", 1280, 853),
			display2048: derivative("display-2048", 2048, 1365),
			display2560: derivative("display-2560", 2560, 1707),
		},
	};
}
