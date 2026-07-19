import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../../..");

function routeSource(path: string) {
	return readFileSync(resolve(projectRoot, path), "utf8");
}

describe("admin Portfolio route boundaries", () => {
	it("mounts draft Portfolio under Editor and keeps Client Galleries delivery-only", () => {
		expect(routeSource("src/routes/admin/editor/+page.ts")).toContain(
			'redirect(307, "/admin/editor/portfolio")',
		);
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

	it("leaves public gallery reads on the reversible Sanity boundary", () => {
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
});
