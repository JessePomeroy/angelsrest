import { describe, expect, it } from "vitest";
import { env } from "$env/dynamic/private";
import {
	assertNewOrderCheckoutOpen,
	NewOrderCheckoutClosedError,
	newOrderCheckoutDecision,
} from "$lib/server/commercePurposeControls";

const openRegistry = JSON.stringify({
	version: 1,
	tenants: [
		{ siteUrl: "angelsrest.online", state: "open", generation: 1 },
		{ siteUrl: "zippymiggy.com", state: "open", generation: 1 },
	],
});

describe("new-order Checkout control", () => {
	it("resolves only the exact complete tenant registry", () => {
		expect(newOrderCheckoutDecision("angelsrest.online", openRegistry)).toEqual({
			state: "open",
			generation: 1,
			valid: true,
		});
		expect(assertNewOrderCheckoutOpen("zippymiggy.com", openRegistry)).toEqual({
			state: "open",
			generation: 1,
		});
	});

	it.each([
		"",
		"not-json",
		JSON.stringify({ version: 1, tenants: [] }),
		JSON.stringify({
			version: 1,
			tenants: [
				{ siteUrl: "angelsrest.online", state: "open", generation: 1 },
				{ siteUrl: "angelsrest.online", state: "open", generation: 1 },
			],
		}),
		JSON.stringify({
			version: 1,
			tenants: [
				{ siteUrl: "angelsrest.online", state: " open ", generation: 1 },
				{ siteUrl: "zippymiggy.com", state: "open", generation: 1 },
			],
		}),
		JSON.stringify({
			version: 1,
			tenants: [
				{ siteUrl: "angelsrest.online", state: "open", generation: 0 },
				{ siteUrl: "zippymiggy.com", state: "open", generation: 1 },
			],
		}),
	])("fails closed for malformed or incomplete registry %#", (raw) => {
		expect(newOrderCheckoutDecision("angelsrest.online", raw)).toEqual({
			state: "closed",
			generation: null,
			valid: false,
		});
		expect(() => assertNewOrderCheckoutOpen("angelsrest.online", raw)).toThrow(
			NewOrderCheckoutClosedError,
		);
	});

	it("fails closed when the runtime registry is missing", () => {
		const runtimeEnv = env as Record<string, string | undefined>;
		const previous = runtimeEnv.NEW_ORDER_CHECKOUT_CONTROL;
		runtimeEnv.NEW_ORDER_CHECKOUT_CONTROL = undefined;
		try {
			expect(newOrderCheckoutDecision("angelsrest.online")).toMatchObject({
				state: "closed",
				valid: false,
			});
		} finally {
			runtimeEnv.NEW_ORDER_CHECKOUT_CONTROL = previous;
		}
	});

	it("isolates a closed Angels Rest tuple from open Reflecting Pool", () => {
		const mixed = JSON.stringify({
			version: 1,
			tenants: [
				{ siteUrl: "angelsrest.online", state: "closed", generation: 2 },
				{ siteUrl: "zippymiggy.com", state: "open", generation: 1 },
			],
		});
		expect(newOrderCheckoutDecision("angelsrest.online", mixed)).toMatchObject({
			state: "closed",
			generation: 2,
			valid: true,
		});
		expect(assertNewOrderCheckoutOpen("zippymiggy.com", mixed)).toEqual({
			state: "open",
			generation: 1,
		});
	});
});
