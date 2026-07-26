import { afterEach, describe, expect, it, vi } from "vitest";
import type { CartItem } from "$lib/shop/cart";

const attempt = (ordinal: number) => ({
	code: "CHECKOUT_ATTEMPT_REQUIRED",
	message: "Checkout attempt required",
	details: {
		attempt: `${ordinal}23e4567-e89b-42d3-a456-426614174000`,
		attemptStartedAt: 1_800_000_000_000 + ordinal,
	},
});
const response = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

describe("checkout browser transport", () => {
	it("sends the exact legacy single and cart bytes first", async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(response({ url: "https://stripe.test/single" }))
			.mockResolvedValueOnce(response({ url: "https://stripe.test/cart" }));
		vi.stubGlobal("fetch", fetcher);
		const { createCheckout } = await import("$lib/utils/checkout");
		const { createCartCheckout } = await import("$lib/utils/cartCheckout");
		await createCheckout({ productId: "print-one", coupon: null });
		const items = [
			{
				id: "cart-one",
				productSlug: "print-one",
				type: "print",
				title: "Print One",
				imageUrl: "https://cdn.test/print.jpg",
				quantity: 1,
				unitPriceCents: 4200,
			},
		] satisfies CartItem[];
		await createCartCheckout(items);
		expect(fetcher.mock.calls[0]?.[1]?.body).toBe(
			'{"productId":"print-one","coupon":null,"isPrintSet":false}',
		);
		expect(fetcher.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ items }));
	});

	it("retries once with the server UUID and clears it after a definitive conflict", async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(response(attempt(1), 428))
			.mockResolvedValueOnce(response({ code: "CHECKOUT_ATTEMPT_REJECTED" }, 409))
			.mockResolvedValueOnce(response(attempt(2), 428))
			.mockResolvedValueOnce(response({ url: "https://stripe.test/pay" }));
		vi.stubGlobal("fetch", fetcher);
		const { createCheckout } = await import("$lib/utils/checkout");
		await expect(createCheckout({ productId: "print-one", coupon: null })).rejects.toThrow();
		await expect(createCheckout({ productId: "print-one", coupon: null })).resolves.toBe(
			"https://stripe.test/pay",
		);
		const firstRetry = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
		const secondRetry = JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body));
		expect(firstRetry.attempt).toBe(attempt(1).details.attempt);
		expect(secondRetry.attempt).toBe(attempt(2).details.attempt);
	});

	it("retains an attempt across an ambiguous retry response", async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(response(attempt(1), 428))
			.mockResolvedValueOnce(response({ message: "unavailable" }, 500))
			.mockResolvedValueOnce(response(attempt(2), 428))
			.mockResolvedValueOnce(response({ url: "https://stripe.test/pay" }));
		vi.stubGlobal("fetch", fetcher);
		const { createCheckout } = await import("$lib/utils/checkout");
		await expect(createCheckout({ productId: "print-one", coupon: null })).rejects.toThrow();
		await createCheckout({ productId: "print-one", coupon: null });
		const ambiguous = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
		const retained = JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body));
		expect(retained.attempt).toBe(ambiguous.attempt);
	});
});
