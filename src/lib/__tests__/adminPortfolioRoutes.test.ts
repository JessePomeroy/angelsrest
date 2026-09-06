import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { load as loadSiteSettings } from "../../routes/admin/editor/+page.server";
import { load as loadProduct } from "../../routes/admin/editor/products/[productId]/+page";

describe("admin Editor route boundaries", () => {
	it("maps the current public settings into an ordered private-draft seed", async () => {
		const parent = vi.fn().mockResolvedValue({
			adminSession: {
				status: "authorized",
				email: "creator@example.com",
				tier: "full",
				isCreator: true,
			},
			siteSettings: {
				artistName: "Inherited artist",
				siteTitle: "Inherited title",
				tagline: "Inherited tagline",
				logoUrl: "https://cdn.example/logo.png",
				socialLinks: [
					{ platform: "instagram", url: "https://instagram.example/artist" },
					{ platform: "bluesky", url: "https://bsky.example/artist" },
				],
				seo: {
					description: "Inherited SEO description",
					ogImageUrl: "https://cdn.example/og.png",
					keywords: ["not", "part", "of", "the", "draft"],
				},
			},
		});

		await expect(loadSiteSettings({ parent } as never)).resolves.toEqual({
			siteSettingsEditorSeed: {
				artistName: "Inherited artist",
				siteTitle: "Inherited title",
				tagline: "Inherited tagline",
				socialLinks: [
					{ platform: "instagram", url: "https://instagram.example/artist" },
					{ platform: "bluesky", url: "https://bsky.example/artist" },
				],
				seoDescription: "Inherited SEO description",
			},
		});
		expect(parent).toHaveBeenCalledOnce();
	});

	it("normalizes absent public settings to a mutation-safe blank seed", async () => {
		await expect(
			loadSiteSettings({ parent: async () => ({ siteSettings: null }) } as never),
		).resolves.toEqual({
			siteSettingsEditorSeed: {
				artistName: "",
				siteTitle: "",
				tagline: "",
				socialLinks: [],
				seoDescription: "",
			},
		});
	});

	it("preserves the opaque product route identity and keys the editor by that visit", () => {
		expect(
			readFileSync("src/routes/admin/editor/products/[productId]/+page.svelte", "utf8"),
		).toContain("{#key data.productId}");
		expect(loadProduct({ params: { productId: "opaque-product-id" } } as never)).toEqual({
			productId: "opaque-product-id",
		});
	});
});
