import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../../../..");

function source(path: string) {
	return readFileSync(resolve(projectRoot, path), "utf8");
}

describe("current checkout authority custody", () => {
	it("keeps current authority in a Convex-only module with no provider-mode seam", () => {
		const current = source("src/lib/server/current/currentCheckoutCommerce.server.ts");
		expect(current).not.toMatch(
			/\$lib\/sanity|\$env\/dynamic\/private|CHECKOUT_CATALOG_PROVIDER|CHECKOUT_SNAPSHOT_MODE|\bresolveCheckoutItem\b|from "\$lib\/server\/checkoutCommerce"/,
		);
		expect(current).toContain('from "$convex/api"');
		expect(current).toContain('provider: "convex"');

		expect(existsSync(resolve(projectRoot, "src/lib/server/checkoutCommerce.ts"))).toBe(false);
	});

	it("routes every newly initiated direct and cart purchase through Convex snapshots", () => {
		for (const path of [
			"src/lib/server/directCheckout.ts",
			"src/routes/api/checkout/+server.ts",
			"src/routes/api/cart/checkout/+server.ts",
		]) {
			const checkout = source(path);
			expect(checkout).not.toMatch(
				/\$lib\/sanity|CHECKOUT_CATALOG_PROVIDER|CHECKOUT_SNAPSHOT_MODE|\bresolveCheckoutItem\b|\bresolveCheckoutCommerce\b|createAdmittedOrderCheckoutSession/,
			);
		}

		const direct = source("src/lib/server/directCheckout.ts");
		const cart = source("src/routes/api/cart/checkout/+server.ts");
		for (const checkout of [direct, cart]) {
			expect(checkout).toContain('from "$lib/server/current/currentCheckoutCommerce.server"');
			expect(checkout).toContain('catalogProvider: "convex"');
			expect(checkout).toContain("createHandleCheckoutSession");
		}
	});

	it("omits paperIndex from fixed-price direct checkout while retaining selectable papers", () => {
		const page = source("src/routes/shop/[slug]/+page.svelte");
		expect(page).toContain("...(selectedPaperData ? { paperIndex: selectedPaperIndex } : {}),");
		const transport = source("src/lib/utils/checkout.ts");
		expect(transport).toContain(
			"...(params.paperIndex === undefined ? {} : { paperIndex: params.paperIndex }),",
		);
	});

	it("removes historical provider fulfillment and download compatibility", () => {
		const fulfillment = source("src/lib/server/snapshotFulfillment.ts");
		const download = source("src/routes/api/download/+server.ts");
		for (const current of [fulfillment, download]) {
			expect(current).toContain('catalogProvider !== "convex"');
			expect(current).not.toMatch(/sanity|legacy paid file/i);
		}
	});
});
