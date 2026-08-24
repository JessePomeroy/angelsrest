import { describe, expect, test } from "vitest";
import type { Id } from "./_generated/dataModel";
import {
	ANGELS_REST_SITE_SETTINGS_MIGRATION,
	requireAngelsRestSiteSettingsMigrationPlan,
} from "./helpers/angelsRestSiteSettingsMigration";
import {
	createSanitySiteSettingsPlan,
	digestSanitySiteSettingsPlan,
	requireSanitySiteSettingsPlan,
	SITE_SETTINGS_OG_FALLBACK,
	type SanitySiteSettingsBuildOptions,
} from "./helpers/sanitySiteSettingsPlan";

const OG_MEDIA_ID = "site-settings-og-media" as Id<"mediaAssets">;

function sourceFixture() {
	return {
		siteSettings: [
			{
				_id: "site-settings-one",
				_rev: "site-settings-revision-1",
				_type: "siteSettings",
				artistName: "Jesse Pomeroy",
				siteTitle: "Angel's Rest",
				tagline: "artist in residence",
				logo: { asset: { _ref: "image-logo123-800x400-png" } },
				socialLinks: [
					{
						_key: "instagram",
						platform: "instagram",
						url: "https://www.instagram.com/stray_black_dog",
					},
				],
				seo: {
					description: "Photography by Jesse Pomeroy",
					keywords: ["photography", "Michigan"],
				},
			},
		],
	};
}

function options(): SanitySiteSettingsBuildOptions {
	return {
		migrationId: "R6-site-settings-fixture",
		siteUrl: "angelsrest.online",
		source: {
			projectId: "n7rvza4g",
			dataset: "production",
			perspective: "published",
		},
		decisions: {
			id: "site-settings-decisions-1",
			artistName: { action: "use-source-owner-approved" },
			siteTitle: { action: "use-source-owner-approved" },
			tagline: { action: "use-source-owner-approved" },
			socialLinks: { action: "use-source-owner-approved" },
			seoDescription: { action: "use-source-owner-approved" },
			logo: { action: "omit-unrendered-owner-approved" },
			seoKeywords: { action: "omit-unrendered-owner-approved" },
			seoImage: { action: "keep-host-fallback-owner-approved" },
		},
	};
}

describe("Sanity Site Settings singleton plan", () => {
	test("freezes the accepted live singleton and receipt to one operation digest", async () => {
		const binding = ANGELS_REST_SITE_SETTINGS_MIGRATION;
		const plan = createSanitySiteSettingsPlan(
			{
				siteSettings: [
					{
						_id: binding.sourceId,
						_rev: binding.sourceRevision,
						_type: "siteSettings",
						artistName: "Jesse Pomeroy",
						siteTitle: "Angel's Rest",
						tagline: "Photography and visual art by Jesse Pomeroy",
						logo: { asset: { _ref: binding.logoSourceAssetRef } },
						socialLinks: [
							{
								_key: "e76a9a36c02e",
								platform: "instagram",
								url: "https://www.instagram.com/stray_black_dog",
							},
						],
						seo: {
							description:
								"Photography, fine art prints, and visual storytelling by Jesse Pomeroy. Explore galleries, shop archival prints, discover the world through a different lens.",
							ogImage: { asset: { _ref: binding.seoOgSourceAssetRef } },
						},
					},
				],
			},
			{
				migrationId: "R6-site-settings-2026-08-24",
				siteUrl: binding.siteUrl,
				source: {
					projectId: "n7rvza4g",
					dataset: "production",
					perspective: "published",
				},
				decisions: {
					id: "R6-site-settings-current-parity-2026-08-24",
					artistName: { action: "use-source-owner-approved" },
					siteTitle: { action: "use-source-owner-approved" },
					tagline: { action: "use-source-owner-approved" },
					socialLinks: { action: "use-source-owner-approved" },
					seoDescription: { action: "use-source-owner-approved" },
					logo: { action: "omit-unrendered-owner-approved" },
					seoKeywords: { action: "confirmed-absent-owner-approved" },
					seoImage: {
						action: "extend-target-and-transfer-exact-source",
						sourceSha256: binding.seoOgSourceSha256,
						targetMediaAssetId: binding.seoOgMediaAssetId,
						targetWorkerAssetId: binding.seoOgWorkerAssetId,
						targetReceiptSha256: binding.seoOgReceiptDigest,
					},
				},
			},
		);
		expect(await digestSanitySiteSettingsPlan(plan)).toBe(binding.planDigest);
		await expect(
			requireAngelsRestSiteSettingsMigrationPlan(plan, binding.planDigest),
		).resolves.toBe(binding.planDigest);
	});

	test("binds the exact source revision, explicit omissions, and deterministic digest", async () => {
		const plan = createSanitySiteSettingsPlan(sourceFixture(), options());
		expect(plan).toMatchObject({
			sourceDocument: {
				sourceId: "site-settings-one",
				sourceRevision: "site-settings-revision-1",
			},
			decisionSet: {
				logo: { action: "omit-unrendered-owner-approved" },
				seoKeywords: { action: "omit-unrendered-owner-approved" },
				seoImage: {
					action: "keep-host-fallback-owner-approved",
					fallbackPath: SITE_SETTINGS_OG_FALLBACK,
				},
			},
			payload: {
				artistName: "Jesse Pomeroy",
				siteTitle: "Angel's Rest",
				tagline: "artist in residence",
				socialLinks: [
					{
						platform: "instagram",
						url: "https://www.instagram.com/stray_black_dog",
					},
				],
				seoDescription: "Photography by Jesse Pomeroy",
			},
		});
		const digest = await digestSanitySiteSettingsPlan(plan);
		expect(digest).toMatch(/^[a-f0-9]{64}$/);
		expect(
			await digestSanitySiteSettingsPlan(
				createSanitySiteSettingsPlan(sourceFixture(), options()),
			),
		).toBe(digest);
		await expect(requireSanitySiteSettingsPlan(plan, digest)).resolves.toBe(digest);

		const tampered = structuredClone(plan);
		tampered.payload.siteTitle = "Changed";
		await expect(digestSanitySiteSettingsPlan(tampered)).rejects.toThrow(
			"site title decision binding is invalid",
		);
	});

	test("requires explicit replacements for absent required target fields", () => {
		const source = sourceFixture();
		delete (source.siteSettings[0] as { tagline?: string }).tagline;
		const selected = options();
		expect(() => createSanitySiteSettingsPlan(source, selected)).toThrow(
			"Site Settings tagline is required",
		);
		selected.decisions.tagline = {
			action: "owner-replacement",
			value: "Photography and visual art",
		};
		expect(createSanitySiteSettingsPlan(source, selected).payload.tagline).toBe(
			"Photography and visual art",
		);
	});

	test("stops on duplicate singletons, unsafe social data, or an unbound live OG image", () => {
		const duplicate = sourceFixture();
		duplicate.siteSettings.push(structuredClone(duplicate.siteSettings[0]));
		expect(() => createSanitySiteSettingsPlan(duplicate, options())).toThrow(
			"Exactly one published Site Settings",
		);

		const duplicateSocial = sourceFixture();
		duplicateSocial.siteSettings[0].socialLinks.push({
			_key: "instagram-2",
			platform: "instagram",
			url: "https://instagram.com/another",
		});
		expect(() => createSanitySiteSettingsPlan(duplicateSocial, options())).toThrow(
			"duplicate platforms or URLs",
		);

		const image = sourceFixture();
		(image.siteSettings[0].seo as { ogImage?: { asset: { _ref: string } } }).ogImage = {
			asset: { _ref: "image-og123-1200x630-jpg" },
		};
		expect(() => createSanitySiteSettingsPlan(image, options())).toThrow(
			"SEO image decision does not match the source",
		);
	});

	test("binds a live OG image to its exact source and transfer receipt", () => {
		const source = sourceFixture();
		(source.siteSettings[0].seo as { ogImage?: { asset: { _ref: string } } }).ogImage = {
			asset: {
				_ref: "image-0ccd0a41f44c6387c01425cd93579ac5a4a9f341-1848x1848-png",
			},
		};
		const selected = options();
		selected.decisions.seoImage = {
			action: "extend-target-and-transfer-exact-source",
			sourceSha256: "a".repeat(64),
			targetMediaAssetId: OG_MEDIA_ID,
			targetWorkerAssetId: "123e4567-e89b-42d3-a456-426614174000",
			targetReceiptSha256: "b".repeat(64),
		};

		const plan = createSanitySiteSettingsPlan(source, selected);
		expect(plan.payload.seoOgImageAssetId).toBe(OG_MEDIA_ID);
		expect(plan.decisionSet.seoImage).toEqual({
			action: "extend-target-and-transfer-exact-source",
			sourceAssetRef:
				"image-0ccd0a41f44c6387c01425cd93579ac5a4a9f341-1848x1848-png",
			sourceSha256: "a".repeat(64),
			sourceWidth: 1848,
			sourceHeight: 1848,
			sourceContentType: "image/png",
			sourceCropCanonical: "null",
			sourceHotspotCanonical: "null",
			targetMediaAssetId: OG_MEDIA_ID,
			targetWorkerAssetId: "123e4567-e89b-42d3-a456-426614174000",
			targetReceiptSha256: "b".repeat(64),
		});
	});
});
