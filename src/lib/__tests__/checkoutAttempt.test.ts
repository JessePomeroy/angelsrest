import { describe, expect, it, vi } from "vitest";
import { CheckoutAttemptTracker } from "$lib/utils/checkoutAttempt";

describe("checkout browser attempts", () => {
	it("retains one UUID-v4 and start time across retry until success", () => {
		const randomUUID = vi
			.fn()
			.mockReturnValueOnce("123e4567-e89b-42d3-a456-426614174000")
			.mockReturnValueOnce("223e4567-e89b-42d3-a456-426614174000");
		const tracker = new CheckoutAttemptTracker(randomUUID, () => 1_800_000_000_000);
		const first = tracker.forIntent({ tenant: "a", product: "one" });
		expect(tracker.forIntent({ tenant: "a", product: "one" })).toEqual(first);
		expect(randomUUID).toHaveBeenCalledOnce();
		tracker.confirm("different-attempt");
		expect(tracker.forIntent({ tenant: "a", product: "one" })).toEqual(first);
		tracker.confirm(first.attempt);
		expect(tracker.forIntent({ tenant: "a", product: "one" }).attempt).not.toBe(first.attempt);
	});

	it("invalidates immediately when cart, selection, or tenant intent changes", () => {
		let ordinal = 1;
		const tracker = new CheckoutAttemptTracker(
			() => `${ordinal++}23e4567-e89b-42d3-a456-426614174000`,
			() => 1_800_000_000_000,
		);
		const first = tracker.forIntent({ tenant: "a", cart: [{ slug: "one", quantity: 1 }] });
		const cartChanged = tracker.forIntent({ tenant: "a", cart: [{ slug: "one", quantity: 2 }] });
		const tenantChanged = tracker.forIntent({ tenant: "b", cart: [{ slug: "one", quantity: 2 }] });
		expect(new Set([first.attempt, cartChanged.attempt, tenantChanged.attempt])).toHaveLength(3);
	});
});
