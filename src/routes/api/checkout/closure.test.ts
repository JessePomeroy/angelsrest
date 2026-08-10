import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "$env/dynamic/private";

const mocks = vi.hoisted(() => ({
	stripeCreate: vi.fn(),
	getStripe: vi.fn(),
	resolveTenant: vi.fn(),
	sanityFetch: vi.fn(),
}));

vi.mock("$env/static/public", () => ({
	PUBLIC_SITE_URL: "https://www.angelsrest.online",
}));
vi.mock("$lib/sanity/client", () => ({
	client: { fetch: mocks.sanityFetch },
}));
vi.mock("$lib/server/stripeClient", () => ({ getStripe: mocks.getStripe }));
vi.mock("$lib/server/stripeTenant", () => ({
	resolveStripeTenantForSite: mocks.resolveTenant,
}));

import { POST as cartCheckout } from "../cart/checkout/+server";
import { POST as directCheckout } from "./+server";

const closedRegistry = JSON.stringify({
	version: 1,
	tenants: [
		{ siteUrl: "angelsrest.online", state: "closed", generation: 2 },
		{ siteUrl: "zippymiggy.com", state: "open", generation: 1 },
	],
});

describe("new-order Checkout closure", () => {
	let previousControl: string | undefined;

	beforeEach(() => {
		vi.clearAllMocks();
		previousControl = env.NEW_ORDER_CHECKOUT_CONTROL;
		(env as Record<string, string | undefined>).NEW_ORDER_CHECKOUT_CONTROL = closedRegistry;
		mocks.getStripe.mockReturnValue({
			checkout: { sessions: { create: mocks.stripeCreate } },
		});
	});

	afterEach(() => {
		(env as Record<string, string | undefined>).NEW_ORDER_CHECKOUT_CONTROL = previousControl;
	});

	it("rejects direct Checkout before catalog, tenant, or Stripe work", async () => {
		const request = new Request("https://www.angelsrest.online/api/checkout", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{}",
		});
		await expect(
			directCheckout({ request, cookies: {} } as Parameters<typeof directCheckout>[0]),
		).rejects.toMatchObject({
			status: 503,
			body: { code: "UNAVAILABLE", message: "Checkout is temporarily unavailable" },
		});
		expect(mocks.sanityFetch).not.toHaveBeenCalled();
		expect(mocks.resolveTenant).not.toHaveBeenCalled();
		expect(mocks.getStripe).not.toHaveBeenCalled();
		expect(mocks.stripeCreate).not.toHaveBeenCalled();
	});

	it("rejects cart Checkout before catalog, tenant, or Stripe Session creation", async () => {
		const request = new Request("https://www.angelsrest.online/api/cart/checkout", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ items: [] }),
		});
		await expect(
			cartCheckout({ request, cookies: {} } as Parameters<typeof cartCheckout>[0]),
		).rejects.toMatchObject({
			status: 503,
			body: { message: "Checkout is temporarily unavailable" },
		});
		expect(mocks.sanityFetch).not.toHaveBeenCalled();
		expect(mocks.resolveTenant).not.toHaveBeenCalled();
		expect(mocks.getStripe).toHaveBeenCalledOnce();
		expect(mocks.stripeCreate).not.toHaveBeenCalled();
	});
});
