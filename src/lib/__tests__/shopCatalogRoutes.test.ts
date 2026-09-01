import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { POST as shippingPricePost } from "../../routes/api/shop/shipping-price/+server";
import { POST as validateImagePost } from "../../routes/api/shop/validate-image/+server";

const projectRoot = resolve(import.meta.dirname, "../../..");

function source(path: string) {
	return readFileSync(resolve(projectRoot, path), "utf8");
}

describe("shop catalog route boundaries", () => {
	it("keeps retired LumaPrints shop paths as fixed, body-free 410 tombstones", async () => {
		for (const path of [
			"src/routes/api/shop/validate-image/+server.ts",
			"src/routes/api/shop/shipping-price/+server.ts",
		]) {
			expect(existsSync(resolve(projectRoot, path))).toBe(true);
			const route = source(path);
			expect(route).not.toMatch(/\$lib\/server\/lumaprints|fetch\(|request\.|request\[/);
		}

		const event = Object.defineProperty({}, "request", {
			get() {
				throw new Error("A compatibility tombstone must not inspect the request body");
			},
		});
		for (const post of [validateImagePost, shippingPricePost]) {
			const response = await post(event as never);
			expect(response.status).toBe(410);
			expect(await response.text()).toBe("");
		}

		const client = source("src/lib/server/lumaprints.ts");
		expect(client).not.toMatch(
			/export async function (checkImageConfig|getShippingPrice|getOrder|getShipping)\b/,
		);
	});

	it("keeps all four Shop loaders thin behind the Convex-only catalog boundary", () => {
		for (const path of [
			"src/routes/shop/+page.server.ts",
			"src/routes/shop/[slug]/+page.server.ts",
			"src/routes/shop/sets/[slug]/+page.server.ts",
			"src/routes/shop/prints/[slug]/+page.server.ts",
		]) {
			const loader = source(path);
			expect(loader).toContain('from "$lib/server/convexShop.server"');
			expect(loader).not.toMatch(/sanity\.fetch|\$convex|catalogProductGraphs|isPreview|locals/);
		}
		const boundary = source("src/lib/server/convexShop.server.ts");
		expect(boundary).toContain("api.catalogProductGraphs.listPublished");
		expect(boundary).toContain("api.catalogProductGraphs.getPublishedBySlug");
		expect(boundary).toContain("collections: []");
		expect(boundary).not.toMatch(/sanity|SHOP_CATALOG_PROVIDER|isPreview/);

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
			checkoutRoute.indexOf('runCheckoutSessionStage("checkout_stripe"'),
		);
	});

	it("renders unavailable fixed-kind details without a null price", () => {
		const page = source("src/routes/shop/[slug]/+page.svelte");
		const v1 = page.split("V1 Layout (merch, postcards, tapestries, digital)")[1];
		expect(page).toContain('typeof displayPrice === "number" && Number.isFinite(displayPrice)');
		expect(page).toContain(': "Out of stock"');
		expect(v1?.match(/{displayPriceLabel}/g)).toHaveLength(2);
	});

	it("retains historical set-shaped webhook decoding for delayed or replayed payments", () => {
		const decoder = source("src/lib/server/webhookDecoder.ts");
		expect(decoder).toContain("isPrintSet");
		expect(decoder).toContain("imageUrls");
	});
});
