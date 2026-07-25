import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../../..");

function source(path: string) {
	return readFileSync(resolve(projectRoot, path), "utf8");
}

describe("shop catalog route boundaries", () => {
	it("keeps the Sanity catalog behind one server-only adapter and all four loaders thin", () => {
		const adapter = source("src/lib/server/sanityShop.server.ts");
		expect(adapter).toContain('from "$lib/sanity/client.server"');
		expect(adapter).toContain("lumaPrintSetV2");
		expect(adapter).not.toContain('_type == "printSet"');
		expect(adapter).not.toContain("$convex");
		expect(adapter).not.toContain("catalogProductGraphs");
		expect(adapter).not.toContain("catalogProducts");
		expect(adapter).not.toContain("listPublished");
		expect(adapter).not.toContain("getPublishedBySlug");

		for (const path of [
			"src/routes/shop/+page.server.ts",
			"src/routes/shop/[slug]/+page.server.ts",
			"src/routes/shop/sets/[slug]/+page.server.ts",
			"src/routes/shop/prints/[slug]/+page.server.ts",
		]) {
			const loader = source(path);
			expect(loader).toContain('from "$lib/server/sanityShop.server"');
			expect(loader).not.toContain("sanity.fetch");
			expect(loader).not.toContain("$convex");
			expect(loader).not.toContain("catalogProductGraphs");
			expect(loader).not.toContain("catalogProducts");
			expect(loader).not.toContain("listPublished");
			expect(loader).not.toContain("getPublishedBySlug");
		}

		const checkout = source("src/lib/server/checkoutCatalog.ts");
		expect(checkout).toContain("lumaPrintSetV2");
		expect(checkout).not.toContain('_type == "printSet"');

		const detailPage = source("src/routes/shop/sets/[slug]/+page.svelte");
		expect(detailPage).not.toContain("data.setType");
		expect(detailPage).not.toContain("handleV1");
		expect(detailPage).not.toContain("selectedPaperIndex");
	});

	it("retains historical set-shaped webhook decoding for delayed or replayed payments", () => {
		const decoder = source("src/lib/server/webhookDecoder.ts");
		expect(decoder).toContain("isPrintSet");
		expect(decoder).toContain("imageUrls");
	});
});
