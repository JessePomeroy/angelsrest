import { describe, expect, it, vi } from "vitest";
import { STRIPE_API_VERSION } from "$lib/server/stripeApiVersion";

const constructStripe = vi.hoisted(() => vi.fn());

vi.mock("stripe", () => ({
	default: class Stripe {
		constructor(key: string, options: unknown) {
			constructStripe(key, options);
		}
	},
}));
vi.mock("$env/static/private", () => ({ STRIPE_SECRET_KEY: "non-provider-test-key" }));

import { getStripe } from "$lib/server/stripeClient";

describe("getStripe", () => {
	it("constructs one client with the pinned API version", () => {
		expect(getStripe()).toBe(getStripe());
		expect(constructStripe).toHaveBeenCalledOnce();
		expect(constructStripe).toHaveBeenCalledWith("non-provider-test-key", {
			apiVersion: STRIPE_API_VERSION,
		});
	});
});
