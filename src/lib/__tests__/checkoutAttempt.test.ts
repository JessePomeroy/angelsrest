import { describe, expect, it } from "vitest";
import { CheckoutAttemptTracker } from "$lib/utils/checkoutAttempt";

const first = {
	attempt: "123e4567-e89b-42d3-a456-426614174000",
	attemptStartedAt: 1_800_000_000_000,
};
const second = {
	attempt: "223e4567-e89b-42d3-a456-426614174000",
	attemptStartedAt: 1_800_000_001_000,
};

describe("checkout browser attempts", () => {
	it("retains one server challenge across ambiguous retries", () => {
		const tracker = new CheckoutAttemptTracker(() => first.attemptStartedAt);
		expect(tracker.forIntent({ product: "one" }, first)).toEqual(first);
		expect(tracker.forIntent({ product: "one" }, second)).toEqual(first);
		tracker.discard("different-attempt");
		expect(tracker.forIntent({ product: "one" }, second)).toEqual(first);
		tracker.discard(first.attempt);
		expect(tracker.forIntent({ product: "one" }, second)).toEqual(second);
	});

	it("rotates a locally stale attempt before use", () => {
		let now = first.attemptStartedAt;
		const tracker = new CheckoutAttemptTracker(() => now);
		tracker.forIntent({ product: "one" }, first);
		now += (23 * 60 + 25) * 60 * 1000;
		expect(tracker.forIntent({ product: "one" }, second)).toEqual(second);
	});

	it("rotates after definitive rejection or changed intent", () => {
		const tracker = new CheckoutAttemptTracker(() => first.attemptStartedAt);
		tracker.forIntent({ tenant: "a", quantity: 1 }, first);
		tracker.discard(first.attempt);
		expect(tracker.forIntent({ tenant: "a", quantity: 1 }, second)).toEqual(second);
		expect(tracker.forIntent({ tenant: "b", quantity: 1 }, first)).toEqual(first);
	});
});
