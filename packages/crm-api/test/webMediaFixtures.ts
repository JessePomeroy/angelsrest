import { convexTest } from "convex-test";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

export const SITE_A = { siteUrl: "site-a.example", email: "admin-a@example.com" };
export const SITE_B = { siteUrl: "site-b.example", email: "admin-b@example.com" };
export const ASSET_A = "123e4567-e89b-42d3-a456-426614174000";
export const ASSET_B = "223e4567-e89b-42d3-a456-426614174001";
export const ASSET_C = "323e4567-e89b-42d3-a456-426614174002";

export function readyAsset(siteUrl: string, assetId: string) {
	const prefix = `sites/${siteUrl}/web/${assetId}/`;
	return {
		assetId,
		originalFilename: `${assetId}.jpg`,
		source: {
			contentType: "image/jpeg" as const,
			sizeBytes: 1_000_000,
			width: 3000,
			height: 2000,
		},
		master: {
			key: `${prefix}master.webp`,
			contentType: "image/webp" as const,
			sizeBytes: 700_000,
			width: 3000,
			height: 2000,
		},
		derivatives: {
			thumb: {
				key: `${prefix}thumb.webp`,
				contentType: "image/webp" as const,
				width: 320,
				height: 213,
			},
			card: {
				key: `${prefix}card.webp`,
				contentType: "image/webp" as const,
				width: 768,
				height: 512,
			},
			display1280: {
				key: `${prefix}display-1280.webp`,
				contentType: "image/webp" as const,
				width: 1280,
				height: 853,
			},
			display2048: {
				key: `${prefix}display-2048.webp`,
				contentType: "image/webp" as const,
				width: 2048,
				height: 1365,
			},
			display2560: {
				key: `${prefix}display-2560.webp`,
				contentType: "image/webp" as const,
				width: 2560,
				height: 1707,
			},
		},
	};
}

export async function createWebMediaTenants(modules: Record<string, () => Promise<unknown>>) {
	const t = convexTest(schema, modules);
	for (const site of [SITE_A, SITE_B]) {
		await t.mutation(internal.platform.seedClient, {
			name: site.siteUrl,
			email: site.email,
			siteUrl: site.siteUrl,
			tier: "full",
			subscriptionStatus: "active",
			adminEmails: [site.email],
			role: "client",
		});
	}
	const adminA = t.withIdentity({ subject: SITE_A.email, email: SITE_A.email, emailVerified: true });
	const adminB = t.withIdentity({ subject: SITE_B.email, email: SITE_B.email, emailVerified: true });
	return { t, adminA, adminB };
}

export async function setupWebMedia(modules: Record<string, () => Promise<unknown>>) {
	const { t, adminA, adminB } = await createWebMediaTenants(modules);
	const [assetA, assetB, assetC] = await Promise.all([
		adminA.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_A.siteUrl,
			asset: readyAsset(SITE_A.siteUrl, ASSET_A),
		}),
		adminB.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_B.siteUrl,
			asset: readyAsset(SITE_B.siteUrl, ASSET_B),
		}),
		adminA.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_A.siteUrl,
			asset: readyAsset(SITE_A.siteUrl, ASSET_C),
		}),
	]);
	return { t, adminA, adminB, assetA, assetB, assetC };
}
