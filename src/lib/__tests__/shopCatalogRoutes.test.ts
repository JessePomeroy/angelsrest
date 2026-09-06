import { afterEach, expect, it, vi } from "vitest";
import { POST as shippingPricePost } from "../../routes/api/shop/shipping-price/+server";
import { POST as validateImagePost } from "../../routes/api/shop/validate-image/+server";

afterEach(() => vi.unstubAllGlobals());

it("keeps retired shop endpoints body-free and network-free with empty 410 responses", async () => {
	const fetch = vi.fn(() => {
		throw new Error("Retired endpoint attempted network I/O");
	});
	vi.stubGlobal("fetch", fetch);
	const event = Object.defineProperty({}, "request", {
		get() {
			throw new Error("Retired endpoint read the request body");
		},
	});
	for (const post of [validateImagePost, shippingPricePost]) {
		const response = await post(event as never);
		expect(response.status).toBe(410);
		expect(await response.text()).toBe("");
	}
	expect(fetch).not.toHaveBeenCalled();
});
