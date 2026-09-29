import { describe, expect, it, vi } from "vitest";
import type { CartItem } from "./cart";
import { createCartCheckoutState } from "./cartCheckoutState.svelte";

const item: CartItem = {
	id: "print-1",
	productSlug: "study",
	type: "print",
	title: "Study",
	imageUrl: "/study.jpg",
	quantity: 1,
	unitPriceCents: 4500,
};

describe("cart checkout state", () => {
	it("guards an in-flight request and retains pending state through redirect", async () => {
		let resolveCheckout!: (url: string) => void;
		const create = vi.fn(
			() =>
				new Promise<string>((resolve) => {
					resolveCheckout = resolve;
				}),
		);
		const navigate = vi.fn();
		const state = createCartCheckoutState(create, navigate);
		await state.checkout([]);
		expect(create).not.toHaveBeenCalled();
		const pending = state.checkout([item]);
		expect(state.isCheckingOut).toBe(true);
		await state.checkout([item]);
		expect(create).toHaveBeenCalledTimes(1);
		resolveCheckout("https://checkout.example.test/session");
		await pending;
		expect(navigate).toHaveBeenCalledWith("https://checkout.example.test/session");
		expect(state.isCheckingOut).toBe(true);
	});

	it("clears an error for retry without affecting another cart surface", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const create = vi
				.fn()
				.mockRejectedValueOnce(new Error("Try again"))
				.mockResolvedValueOnce("/checkout");
			const navigate = vi.fn();
			const first = createCartCheckoutState(create, navigate);
			const second = createCartCheckoutState(create, navigate);
			await first.checkout([item]);
			expect(first.error).toBe("Try again");
			expect(first.isCheckingOut).toBe(false);
			expect(second.error).toBeNull();
			await first.checkout([item]);
			expect(first.error).toBeNull();
			expect(navigate).toHaveBeenCalledWith("/checkout");
		} finally {
			log.mockRestore();
		}
	});
});
