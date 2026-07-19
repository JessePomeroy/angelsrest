import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { load as loadSiteSettings } from "../../routes/admin/editor/+page.server";

const projectRoot = resolve(import.meta.dirname, "../../..");

function routeSource(path: string) {
	return readFileSync(resolve(projectRoot, path), "utf8");
}

describe("admin Editor route boundaries", () => {
	it("maps the inherited public Sanity settings into an ordered private-draft seed", async () => {
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

		const serverSource = routeSource("src/routes/admin/editor/+page.server.ts");
		expect(serverSource).not.toContain("getSanityClient");
		expect(serverSource).not.toContain("sanity.fetch");
	});

	it("normalizes absent Sanity settings to a mutation-safe blank seed", async () => {
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

	it("mounts the staged Site Settings workspace and keeps Portfolio and Client Galleries distinct", () => {
		const siteSettingsPage = routeSource("src/routes/admin/editor/+page.svelte");
		expect(siteSettingsPage).toContain("api.content.getSiteSettingsEditorState");
		expect(siteSettingsPage).toContain("api.content.saveSiteSettingsDraft");
		expect(siteSettingsPage).toContain("Copy current settings");
		expect(siteSettingsPage).toContain("Start blank");
		expect(siteSettingsPage).toContain("SiteSettingsPage");
		expect(siteSettingsPage).not.toContain("publishSiteSettings");

		expect(routeSource("src/routes/admin/editor/portfolio/+page.svelte")).toContain(
			"PortfolioGalleriesPage",
		);
		expect(routeSource("src/routes/admin/editor/portfolio/[galleryId]/+page.svelte")).toContain(
			"PortfolioGalleryPage",
		);

		const clientGalleries = routeSource("src/routes/admin/galleries/+page.svelte");
		expect(clientGalleries).toContain("ClientGalleriesPage");
		expect(clientGalleries).not.toContain("import { GalleriesPage }");
		expect(existsSync(resolve(projectRoot, "src/routes/admin/galleries/+page.server.ts"))).toBe(
			false,
		);
	});

	it("mounts the staged Contact draft workspace without adding a public Contact route", () => {
		expect(routeSource("src/routes/admin/editor/pages/+page.svelte")).toContain("EditorPagesPage");
		expect(routeSource("src/routes/admin/editor/pages/contact/+page.svelte")).toContain(
			"ContactPage",
		);
		expect(existsSync(resolve(projectRoot, "src/routes/contact"))).toBe(false);
	});

	it("leaves public site settings and Portfolio reads on the reversible Sanity boundary", () => {
		const rootLayout = routeSource("src/routes/+layout.server.ts");
		expect(rootLayout).toContain('from "$lib/sanity/client.server"');
		expect(rootLayout).toContain('*[_type == "siteSettings"][0]');
		expect(rootLayout).not.toContain("$convex");

		for (const path of [
			"src/routes/gallery/+page.server.ts",
			"src/routes/gallery/[slug]/+page.server.ts",
		]) {
			const source = routeSource(path);
			expect(source).toContain('from "$lib/sanity/client.server"');
			expect(source).not.toContain("$convex");
			expect(source).not.toContain("portfolioGalleries");
		}
	});

	it("leaves the public Contact read Sanity-only inside the About route", () => {
		const aboutServer = routeSource("src/routes/about/+page.server.ts");
		expect(aboutServer).toContain('from "$lib/sanity/client.server"');
		expect(aboutServer).toContain('*[_type == "contactPage"][0]');
		expect(aboutServer).not.toContain("$convex");
		expect(aboutServer).not.toContain("getPublishedContactPageWithRevision");
	});
});
