import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../../..");

function source(path: string) {
	return readFileSync(resolve(projectRoot, path), "utf8");
}

describe("shop catalog route boundaries", () => {
	it("keeps all four Shop loaders thin behind the private catalog provider", () => {
		const provider = source("src/lib/server/catalogShop.server.ts");
		expect(provider).toContain('from "$env/dynamic/private"');
		expect(provider).toContain("FunctionReturnType");
		expect(provider).toContain("listPublished");
		expect(provider).toContain("getPublishedBySlug");

		for (const path of [
			"src/routes/shop/+page.server.ts",
			"src/routes/shop/[slug]/+page.server.ts",
			"src/routes/shop/sets/[slug]/+page.server.ts",
			"src/routes/shop/prints/[slug]/+page.server.ts",
		]) {
			const loader = source(path);
			expect(loader).toContain('from "$lib/server/catalogShop.server"');
			expect(loader).not.toMatch(/sanity\.fetch|\$convex|catalogProductGraphs/);
		}

		expect(source("src/lib/server/checkoutCatalog.ts")).toContain("lumaPrintSetV2");
	});

	it("has no coupon state or promo input in either product checkout UI", () => {
		for (const path of [
			"src/routes/shop/[slug]/+page.svelte",
			"src/routes/shop/sets/[slug]/+page.svelte",
		]) {
			const page = source(path);
			expect(page).not.toMatch(/couponCode|promo code|promo-code|set-promo/);
			expect(page).toContain("coupon: null");
		}
		const checkoutRoute = source("src/routes/api/checkout/+server.ts");
		expect(checkoutRoute.indexOf("rejectCouponAttempt(rawBody)")).toBeLessThan(
			checkoutRoute.indexOf("const stripe = getStripe()"),
		);
	});

	it("retains historical set-shaped webhook decoding for delayed or replayed payments", () => {
		const decoder = source("src/lib/server/webhookDecoder.ts");
		expect(decoder).toContain("isPrintSet");
		expect(decoder).toContain("imageUrls");
	});
});
