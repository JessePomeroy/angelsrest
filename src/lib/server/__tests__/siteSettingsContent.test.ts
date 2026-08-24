import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("$env/dynamic/private", () => ({ env: {} }));
vi.mock("$env/dynamic/public", () => ({
	env: { PUBLIC_CONVEX_URL: "https://convex.test" },
}));
vi.mock("$lib/sanity/client.server", () => ({ getSanityClient: vi.fn() }));
vi.mock("$lib/server/logger", () => ({ logStructured: vi.fn() }));

import {
	adaptConvexSiteSettings,
	adaptSanitySiteSettings,
	createSanitySiteSettingsSource,
	createSiteSettingsContentProvider,
	parseSiteSettingsProviderMode,
} from "$lib/server/siteSettingsContent.server";

const OG_SOURCE_SHA256 = "c4c238f25cd39d63f55692fefde0a4bd11ff1a9cfd232e94e2dcd952d0fb6d97";

function sanityProjection(): {
	siteSettings: Array<{
		artistName: string;
		siteTitle: string;
		tagline: string;
		logoUrl: string | null;
		socialLinks: Array<{ platform: string; url: string }>;
		seo: {
			description: string;
			ogImageUrl: string | null;
			ogImageAssetRef: string | null;
			ogImageWidth: number | null;
			ogImageHeight: number | null;
			keywords: string[] | null;
		};
	}>;
} {
	return {
		siteSettings: [
			{
				artistName: "Jesse Pomeroy",
				siteTitle: "Angel's Rest",
				tagline: "Photography and visual art by Jesse Pomeroy",
				logoUrl:
					"https://cdn.sanity.io/images/n7rvza4g/production/e5b859c8cf1fc41473f66d34c705b16b19e1c33c-32x32.png",
				socialLinks: [
					{
						platform: "instagram",
						url: "https://www.instagram.com/stray_black_dog",
					},
				],
				seo: {
					description:
						"Photography, fine art prints, and visual storytelling by Jesse Pomeroy. Explore galleries, shop archival prints, discover the world through a different lens.",
					ogImageUrl:
						"https://cdn.sanity.io/images/n7rvza4g/production/0ccd0a41f44c6387c01425cd93579ac5a4a9f341-1848x1848.png",
					ogImageAssetRef: "image-0ccd0a41f44c6387c01425cd93579ac5a4a9f341-1848x1848-png",
					ogImageWidth: 1848,
					ogImageHeight: 1848,
					keywords: null,
				},
			},
		],
	};
}

function convexProjection() {
	const assetId = "123e4567-e89b-42d3-a456-426614174000";
	return {
		revisionId: "site-settings-revision",
		publishedAt: 1,
		payload: {
			artistName: "Jesse Pomeroy",
			siteTitle: "Angel's Rest",
			tagline: "Photography and visual art by Jesse Pomeroy",
			socialLinks: [
				{
					platform: "instagram",
					url: "https://www.instagram.com/stray_black_dog",
				},
			],
			seoDescription:
				"Photography, fine art prints, and visual storytelling by Jesse Pomeroy. Explore galleries, shop archival prints, discover the world through a different lens.",
			seoOgImage: {
				assetId,
				url: `https://media.angelsrest.online/sites/angelsrest.online/web/${assetId}/display-2048.webp`,
				sourceSha256: OG_SOURCE_SHA256,
			},
		},
	};
}

function fakeSanity(value = sanityProjection()) {
	const source = createSanitySiteSettingsSource(() => ({ fetch: async () => value }));
	return { load: vi.fn((isPreview: boolean) => source.load(isPreview)) };
}

afterEach(() => {
	vi.useRealTimers();
});

describe("Site Settings provider boundary", () => {
	it("strictly normalizes one Sanity singleton and the supported Convex projection", async () => {
		const sanity = adaptSanitySiteSettings(sanityProjection());
		const convex = adaptConvexSiteSettings(convexProjection());
		expect(convex).toEqual({
			...sanity,
			logoUrl: null,
			seo: {
				...sanity.seo,
				ogImageUrl:
					"https://media.angelsrest.online/sites/angelsrest.online/web/123e4567-e89b-42d3-a456-426614174000/display-2048.webp",
			},
		});
		const log = vi.fn();
		const provider = createSiteSettingsContentProvider({
			sanity: fakeSanity(),
			mode: () => "shadow",
			createReader: () => ({ loadPublished: vi.fn(async () => convexProjection()) }),
			log,
			acceptedOgSourceSha256: OG_SOURCE_SHA256,
		});
		await expect(provider.load(false)).resolves.toEqual(sanity);
		expect(log).not.toHaveBeenCalled();

		const duplicate = sanityProjection();
		duplicate.siteSettings.push(structuredClone(duplicate.siteSettings[0]));
		expect(() => adaptSanitySiteSettings(duplicate)).toThrow(
			"Malformed public Site Settings projection",
		);

		const missingOgImage = convexProjection();
		delete (missingOgImage.payload as Partial<typeof missingOgImage.payload>).seoOgImage;
		expect(() => adaptConvexSiteSettings(missingOgImage)).toThrow(
			"Malformed public Site Settings projection",
		);

		const fetch = vi.fn(async (_query: string) => sanityProjection());
		await createSanitySiteSettingsSource(() => ({ fetch })).load(false);
		expect(fetch).toHaveBeenCalledOnce();
		const query = fetch.mock.calls[0]?.[0];
		expect(query).toContain('*[_type == "siteSettings"][0...2]');
		expect(query?.trimStart()).toMatch(/^\{/);
	});

	it("keeps preview on Sanity, accepts later valid Convex media, and never falls back", async () => {
		expect(parseSiteSettingsProviderMode(undefined)).toBe("sanity");
		expect(parseSiteSettingsProviderMode(" convex ")).toBe("sanity");

		const sanity = fakeSanity();
		const mode = vi.fn(() => "convex");
		const createReader = vi.fn(() => ({ loadPublished: vi.fn() }));
		const provider = createSiteSettingsContentProvider({ sanity, mode, createReader });
		await provider.load(true);
		expect(sanity.load).toHaveBeenCalledWith(true);
		expect(mode).not.toHaveBeenCalled();
		expect(createReader).not.toHaveBeenCalled();

		const wrongSource = convexProjection();
		wrongSource.payload.seoOgImage.sourceSha256 = "a".repeat(64);
		const laterPublication = createSiteSettingsContentProvider({
			sanity,
			mode: () => "convex",
			createReader: () => ({ loadPublished: vi.fn(async () => wrongSource) }),
		});
		await expect(laterPublication.load(false)).resolves.toEqual(
			adaptConvexSiteSettings(wrongSource),
		);
		expect(sanity.load).toHaveBeenCalledTimes(1);

		const shadowLog = vi.fn();
		const pinnedShadow = createSiteSettingsContentProvider({
			sanity: fakeSanity(),
			mode: () => "shadow",
			createReader: () => ({ loadPublished: vi.fn(async () => wrongSource) }),
			log: shadowLog,
			acceptedOgSourceSha256: OG_SOURCE_SHA256,
		});
		await expect(pinnedShadow.load(false)).resolves.toEqual(
			adaptSanitySiteSettings(sanityProjection()),
		);
		expect(shadowLog.mock.calls[0]?.[0]).toMatchObject({
			meta: { codes: ["site_settings"], mismatchCount: 1 },
		});

		const unavailable = createSiteSettingsContentProvider({
			sanity,
			mode: () => "convex",
			createReader: () => ({ loadPublished: vi.fn(async () => null) }),
		});
		await expect(unavailable.load(false)).rejects.toMatchObject({ status: 503 });
		expect(sanity.load).toHaveBeenCalledTimes(1);
	});

	it("returns the Sanity primary and bounds shadow evidence to metadata", async () => {
		const primary = adaptSanitySiteSettings(sanityProjection());
		const changed = convexProjection();
		changed.payload.siteTitle = "Private changed title";
		const log = vi.fn();
		const provider = createSiteSettingsContentProvider({
			sanity: fakeSanity(),
			mode: () => "shadow",
			createReader: () => ({ loadPublished: vi.fn(async () => changed) }),
			log,
			acceptedOgSourceSha256: OG_SOURCE_SHA256,
		});

		await expect(provider.load(false)).resolves.toEqual(primary);
		expect(log.mock.calls[0]?.[0]).toMatchObject({
			event: "site_settings.shadow_closed",
			meta: {
				codes: ["site_settings"],
				mismatchCount: 1,
				primaryCount: 1,
				secondaryCount: 1,
			},
		});
		expect(JSON.stringify(log.mock.calls[0]?.[0])).not.toMatch(
			/Private changed title|Jesse Pomeroy|instagram/,
		);

		vi.useFakeTimers();
		const stalledLog = vi.fn();
		const stalled = createSiteSettingsContentProvider({
			sanity: fakeSanity(),
			mode: () => "shadow",
			createReader: () => ({ loadPublished: () => new Promise(() => {}) }),
			log: stalledLog,
			deadlineMs: 5,
			acceptedOgSourceSha256: OG_SOURCE_SHA256,
		});
		const result = stalled.load(false);
		await vi.advanceTimersByTimeAsync(5);
		await expect(result).resolves.toEqual(primary);
		expect(stalledLog.mock.calls[0]?.[0]).toMatchObject({
			meta: { codes: ["timeout"], mismatchCount: 1 },
		});
	});
});
