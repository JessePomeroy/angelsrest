import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../../..");

function source(path: string) {
	return readFileSync(resolve(projectRoot, path), "utf8");
}

describe("shop catalog route boundaries", () => {
	it("keeps active print-set storefront and checkout reads on lumaPrintSetV2", () => {
		const runtimeSources = [
			"src/lib/server/checkoutCatalog.ts",
			"src/routes/shop/+page.server.ts",
			"src/routes/shop/sets/[slug]/+page.server.ts",
			"src/routes/shop/prints/[slug]/+page.server.ts",
		];

		for (const path of runtimeSources) {
			const file = source(path);
			expect(file).toContain("lumaPrintSetV2");
			expect(file).not.toContain('_type == "printSet"');
		}

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
