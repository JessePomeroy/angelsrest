import { beforeEach, describe, expect, it, vi } from "vitest";
import { STRIPE_API_VERSION } from "$lib/server/stripeApiVersion";

const constructStripe = vi.hoisted(() => vi.fn());
const privateEnv = vi.hoisted(
	() => ({ STRIPE_SECRET_KEY: "non-provider-test-key" }) as { STRIPE_SECRET_KEY?: string },
);

vi.mock("stripe", () => ({
	default: class Stripe {
		constructor(key: string, options: unknown) {
			constructStripe(key, options);
		}
	},
}));
vi.mock("$env/dynamic/private", () => ({ env: privateEnv }));

describe("getStripe", () => {
	beforeEach(() => {
		vi.resetModules();
		constructStripe.mockClear();
		privateEnv.STRIPE_SECRET_KEY = "non-provider-test-key";
	});

	it("constructs one client lazily with the pinned API version", async () => {
		const { getStripe } = await import("$lib/server/stripeClient");
		expect(constructStripe).not.toHaveBeenCalled();
		expect(getStripe()).toBe(getStripe());
		expect(constructStripe).toHaveBeenCalledOnce();
		expect(constructStripe).toHaveBeenCalledWith("non-provider-test-key", {
			apiVersion: STRIPE_API_VERSION,
		});
	});

	it("can be imported without a Preview Stripe secret and fails only when requested", async () => {
		privateEnv.STRIPE_SECRET_KEY = undefined;
		const { getStripe } = await import("$lib/server/stripeClient");
		expect(constructStripe).not.toHaveBeenCalled();
		expect(() => getStripe()).toThrow("Stripe is not configured");
		expect(constructStripe).not.toHaveBeenCalled();
	});
});
