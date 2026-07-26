import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import {
	CheckoutBridgeError,
	createTenantPrintCheckoutSession,
	signCheckoutBridgeBody,
	type TenantPrintCheckoutOptions,
} from "../checkoutBridge";

const SECRET = "checkout-bridge-secret";
const NOW = 1_800_000_000_000;
const ATTEMPT = "123e4567-e89b-42d3-a456-426614174000";
const HANDLE = "223e4567-e89b-42d3-a456-426614174000";
const SNAPSHOT_ITEM = {
	productKey: "sanity-product",
	revisionId: "published-revision",
	productKind: "print",
	variantKey: "archival-8x10",
	materialOptionKey: "archival-matte",
	sizeOptionKey: "8x10",
	borderOptionKey: null,
	frameOptionKey: null,
};

function makeBody(overrides: Record<string, unknown> = {}) {
	return JSON.stringify({
		siteUrl: "zippymiggy.com",
		amountCents: 10_000,
		productName: "Digital Headshot Print",
		productDescription: "Archival Matte print, 8x10 inches",
		imageUrl: "https://cdn.example/print.jpg",
		successUrl: "https://zippymiggy.com/shop/success?session_id={CHECKOUT_SESSION_ID}",
		cancelUrl: "https://zippymiggy.com/shop/cancelled",
		metadata: {
			imageUrl: "https://cdn.example/print.jpg",
			imageTitle: "Digital Headshot",
			paperSubcategoryId: "103001",
			paperWidth: "8",
			paperHeight: "10",
			paperName: "Archival Matte",
			paperSizeLabel: "8x10",
			productSlug: "digital-headshot",
		},
		...overrides,
	});
}

function snapshot(items: unknown[] = [SNAPSHOT_ITEM], catalogProvider: unknown = "sanity") {
	return { schemaVersion: 1, catalogProvider, items };
}

function makeHandleBody(overrides: Record<string, unknown> = {}) {
	return makeBody({
		attempt: ATTEMPT,
		attemptStartedAt: NOW,
		checkoutSnapshot: snapshot([SNAPSHOT_ITEM], "convex"),
		...overrides,
	});
}

function makeHeaders(bodyText: string, timestamp = NOW) {
	return new Headers({
		"x-checkout-bridge-timestamp": String(timestamp),
		"x-checkout-bridge-signature": signCheckoutBridgeBody({
			bodyText,
			secret: SECRET,
			timestamp,
		}),
	});
}

function makeStripe(events?: string[]) {
	const create = vi.fn(
		async (_params: Stripe.Checkout.SessionCreateParams, _options?: Stripe.RequestOptions) => {
			events?.push("stripe");
			return { id: "cs_test_123", url: "https://stripe.test/pay" };
		},
	);
	const stripe = {
		checkout: {
			sessions: { create },
		},
	} as unknown as Stripe;
	return { stripe, create };
}

function makeReservation(events?: string[]) {
	return {
		reserve: vi.fn(async (_input: unknown) => {
			events?.push("reserve");
			return { handle: HANDLE };
		}),
		bind: vi.fn(async () => {
			events?.push("bind");
		}),
	};
}

function handleOptions(
	bodyText: string,
	stripe: Stripe,
	reservationClient: NonNullable<TenantPrintCheckoutOptions["reservationClient"]>,
	overrides: Partial<TenantPrintCheckoutOptions> = {},
): TenantPrintCheckoutOptions {
	return {
		bodyText,
		headers: makeHeaders(bodyText),
		stripe,
		tenant: { siteUrl: "zippymiggy.com", stripeConnectedAccountId: "acct_1234567890TenantA" },
		secrets: [SECRET],
		allowedRedirectOrigins: ["https://zippymiggy.com"],
		snapshotMode: "handle-v2",
		globalSnapshotMode: "handle-v2",
		reservationClient,
		now: NOW,
		...overrides,
	};
}

describe("checkout bridge", () => {
	it("keeps default legacy results and Stripe parameters", async () => {
		const bodyText = makeBody();
		const { stripe, create } = makeStripe();

		const result = await createTenantPrintCheckoutSession({
			bodyText,
			headers: makeHeaders(bodyText),
			stripe,
			tenant: {
				siteUrl: "zippymiggy.com",
				stripeConnectedAccountId: "acct_123",
			},
			secrets: [SECRET],
			allowedRedirectOrigins: ["https://zippymiggy.com"],
			now: NOW,
		});

		expect(result).toEqual({
			sessionId: "cs_test_123",
			url: "https://stripe.test/pay",
			platformFeeAmount: 500,
		});

		const params = create.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
		const requestOptions = create.mock.calls[0]?.[1] as Stripe.RequestOptions | undefined;
		expect(params.line_items?.[0]?.price_data?.unit_amount).toBe(10_000);
		expect(params.success_url).toBe(
			"https://zippymiggy.com/shop/success?session_id={CHECKOUT_SESSION_ID}",
		);
		expect(params.payment_intent_data).toEqual({
			application_fee_amount: 500,
			metadata: { commerceTenantSiteUrl: "zippymiggy.com" },
		});
		expect(params.metadata).toMatchObject({
			productSlug: "digital-headshot",
			paperSubcategoryId: "103001",
			commerceTenantSiteUrl: "zippymiggy.com",
		});
		expect(requestOptions).toEqual({ stripeAccount: "acct_123" });
	});

	it("rejects a missing signature", async () => {
		const { stripe } = makeStripe();

		await expect(
			createTenantPrintCheckoutSession({
				bodyText: makeBody(),
				headers: new Headers(),
				stripe,
				tenant: { siteUrl: "zippymiggy.com" },
				secrets: [SECRET],
				allowedRedirectOrigins: ["https://zippymiggy.com"],
				now: NOW,
			}),
		).rejects.toMatchObject(new CheckoutBridgeError(401, "Missing checkout bridge signature"));
	});

	it("rejects an expired signature", async () => {
		const bodyText = makeBody();
		const { stripe } = makeStripe();
		const oldTimestamp = NOW - 301_000;

		await expect(
			createTenantPrintCheckoutSession({
				bodyText,
				headers: makeHeaders(bodyText, oldTimestamp),
				stripe,
				tenant: { siteUrl: "zippymiggy.com" },
				secrets: [SECRET],
				allowedRedirectOrigins: ["https://zippymiggy.com"],
				now: NOW,
			}),
		).rejects.toMatchObject(new CheckoutBridgeError(401, "Expired checkout bridge signature"));
	});

	it("rejects a body signed for a different payload", async () => {
		const signedBody = makeBody();
		const tamperedBody = makeBody({ amountCents: 20_000 });
		const { stripe } = makeStripe();

		await expect(
			createTenantPrintCheckoutSession({
				bodyText: tamperedBody,
				headers: makeHeaders(signedBody),
				stripe,
				tenant: { siteUrl: "zippymiggy.com" },
				secrets: [SECRET],
				allowedRedirectOrigins: ["https://zippymiggy.com"],
				now: NOW,
			}),
		).rejects.toMatchObject(new CheckoutBridgeError(401, "Invalid checkout bridge signature"));
	});

	it("rejects siteUrl mismatches after signature verification", async () => {
		const bodyText = makeBody({ siteUrl: "other-client.com" });
		const { stripe } = makeStripe();

		await expect(
			createTenantPrintCheckoutSession({
				bodyText,
				headers: makeHeaders(bodyText),
				stripe,
				tenant: { siteUrl: "zippymiggy.com" },
				secrets: [SECRET],
				allowedRedirectOrigins: ["https://zippymiggy.com"],
				now: NOW,
			}),
		).rejects.toMatchObject(new CheckoutBridgeError(400, "Tenant siteUrl mismatch"));
	});

	it("accepts either bounded tenant secret during rotation", async () => {
		const bodyText = makeBody();
		const { stripe } = makeStripe();

		await expect(
			createTenantPrintCheckoutSession({
				bodyText,
				headers: makeHeaders(bodyText),
				stripe,
				tenant: { siteUrl: "zippymiggy.com" },
				secrets: ["new-tenant-secret".repeat(2), SECRET],
				allowedRedirectOrigins: ["https://zippymiggy.com"],
				now: NOW,
			}),
		).resolves.toMatchObject({ sessionId: "cs_test_123" });
	});

	it("rejects a signature that belongs to another tenant", async () => {
		const bodyText = makeBody();
		const { stripe } = makeStripe();

		await expect(
			createTenantPrintCheckoutSession({
				bodyText,
				headers: makeHeaders(bodyText),
				stripe,
				tenant: { siteUrl: "zippymiggy.com" },
				secrets: ["other-tenant-secret".repeat(2)],
				allowedRedirectOrigins: ["https://zippymiggy.com"],
				now: NOW,
			}),
		).rejects.toMatchObject(new CheckoutBridgeError(401, "Invalid checkout bridge signature"));
	});

	it.each(["successUrl", "cancelUrl"])("rejects an unlisted %s origin", async (field) => {
		const bodyText = makeBody({ [field]: "https://attacker.example/checkout" });
		const { stripe, create } = makeStripe();

		await expect(
			createTenantPrintCheckoutSession({
				bodyText,
				headers: makeHeaders(bodyText),
				stripe,
				tenant: { siteUrl: "zippymiggy.com" },
				secrets: [SECRET],
				allowedRedirectOrigins: ["https://zippymiggy.com"],
				now: NOW,
			}),
		).rejects.toMatchObject(new CheckoutBridgeError(400, `Disallowed ${field} origin`));
		expect(create).not.toHaveBeenCalled();
	});

	it("keeps default legacy bytes and behavior without inspecting handle fields", async () => {
		const bodyText = makeBody({ attempt: "bad", checkoutSnapshot: { extra: "ignored" } });
		const reservationClient = makeReservation();
		const { stripe, create } = makeStripe();
		const result = await createTenantPrintCheckoutSession({
			bodyText,
			headers: makeHeaders(bodyText),
			stripe,
			tenant: { siteUrl: "zippymiggy.com", stripeConnectedAccountId: "acct_123" },
			secrets: [SECRET],
			allowedRedirectOrigins: ["https://zippymiggy.com"],
			reservationClient,
			now: NOW,
		});
		expect(result).toEqual({
			sessionId: "cs_test_123",
			url: "https://stripe.test/pay",
			platformFeeAmount: 500,
		});
		expect(create.mock.calls[0]?.[0]).toMatchObject({
			metadata: expect.objectContaining({ productSlug: "digital-headshot" }),
		});
		expect(reservationClient.reserve).not.toHaveBeenCalled();
	});

	it.each([
		["absent", undefined],
		["empty", ""],
		["invalid", "HANDLE-V2"],
	] as const)("keeps a tenant handle gate in legacy when global mode is %s", async (_label, mode) => {
		const bodyText = makeHandleBody();
		const reservationClient = makeReservation();
		const { stripe, create } = makeStripe();
		await expect(
			createTenantPrintCheckoutSession(
				handleOptions(bodyText, stripe, reservationClient, { globalSnapshotMode: mode }),
			),
		).resolves.toMatchObject({ sessionId: "cs_test_123" });
		expect(create.mock.calls[0]?.[0]).toMatchObject({
			metadata: expect.objectContaining({ productSlug: "digital-headshot" }),
		});
		expect(reservationClient.reserve).not.toHaveBeenCalled();
	});

	it("keeps a global handle gate in legacy when the tenant gate is absent", async () => {
		const bodyText = makeHandleBody();
		const reservationClient = makeReservation();
		const { stripe, create } = makeStripe();
		await expect(
			createTenantPrintCheckoutSession(
				handleOptions(bodyText, stripe, reservationClient, { snapshotMode: undefined }),
			),
		).resolves.toMatchObject({ sessionId: "cs_test_123" });
		expect(create.mock.calls[0]?.[0]).toMatchObject({
			metadata: expect.objectContaining({ productSlug: "digital-headshot" }),
		});
		expect(reservationClient.reserve).not.toHaveBeenCalled();
	});

	it("uses handle mode only when both global and tenant gates are exact", async () => {
		const publicOrigin = "https://reflecting-pool.vercel.app";
		const bodyText = makeHandleBody({
			successUrl: `${publicOrigin}/shop/success?session_id={CHECKOUT_SESSION_ID}`,
			cancelUrl: `${publicOrigin}/shop/cancelled`,
		});
		const events: string[] = [];
		const reservationClient = makeReservation(events);
		const { stripe, create } = makeStripe(events);
		const result = await createTenantPrintCheckoutSession(
			handleOptions(bodyText, stripe, reservationClient, {
				allowedRedirectOrigins: [publicOrigin],
				abuseGate: () => {
					events.push("gate");
				},
			}),
		);
		expect(events).toEqual(["gate", "reserve", "stripe", "bind"]);
		expect(result).toEqual({
			sessionId: "cs_test_123",
			url: "https://stripe.test/pay",
			platformFeeAmount: 500,
		});
		expect(reservationClient.reserve).toHaveBeenCalledWith({
			site: "zippymiggy.com",
			attempt: ATTEMPT,
			account: "acct_1234567890TenantA",
			catalogProvider: "convex",
			items: [SNAPSHOT_ITEM],
		});
		const params = create.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
		expect(params.metadata).toEqual({
			checkoutSnapshotVersion: "2",
			checkoutSnapshotHandle: HANDLE,
			commerceTenantSiteUrl: "zippymiggy.com",
		});
		expect(params.line_items?.[0]?.price_data).toMatchObject({
			unit_amount: 10_000,
			product_data: {
				name: "Digital Headshot Print",
				description: "Archival Matte print, 8x10 inches",
				images: ["https://cdn.example/print.jpg"],
			},
		});
	});

	it.each([
		["extra request field", { extra: true }],
		["oversized title", { productName: "x".repeat(501) }],
		["malformed attempt", { attempt: "bad" }],
		["malformed attempt time", { attemptStartedAt: String(NOW) }],
		["stale attempt", { attemptStartedAt: NOW - 86_100_000 }],
		["future attempt", { attemptStartedAt: NOW + 301_000 }],
		["unsupported provider", { checkoutSnapshot: snapshot([SNAPSHOT_ITEM], "shadow") }],
		[
			"unsupported kind",
			{ checkoutSnapshot: snapshot([{ ...SNAPSHOT_ITEM, productKind: "book" }]) },
		],
		["missing item", { checkoutSnapshot: snapshot([]) }],
		["multiple items", { checkoutSnapshot: snapshot([SNAPSHOT_ITEM, SNAPSHOT_ITEM]) }],
		[
			"oversized item",
			{ checkoutSnapshot: snapshot([{ ...SNAPSHOT_ITEM, productKey: "x".repeat(129) }]) },
		],
	] as const)("rejects %s before reservation and Stripe", async (_label, overrides) => {
		const bodyText = makeHandleBody(overrides);
		const reservationClient = makeReservation();
		const { stripe, create } = makeStripe();
		await expect(
			createTenantPrintCheckoutSession(handleOptions(bodyText, stripe, reservationClient)),
		).rejects.toBeInstanceOf(Error);
		expect(reservationClient.reserve).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
	});

	it("withholds Stripe after reserve failure and the URL after bind failure", async () => {
		const bodyText = makeHandleBody();
		const { stripe, create } = makeStripe();
		await expect(
			createTenantPrintCheckoutSession(
				handleOptions(bodyText, stripe, {
					reserve: vi.fn().mockRejectedValue(new Error("reserve failed")),
					bind: vi.fn(),
				}),
			),
		).rejects.toThrow("reserve failed");
		expect(create).not.toHaveBeenCalled();
		await expect(
			createTenantPrintCheckoutSession(
				handleOptions(bodyText, stripe, {
					reserve: vi.fn().mockResolvedValue({ handle: HANDLE }),
					bind: vi.fn().mockRejectedValue(new Error("bind failed")),
				}),
			),
		).rejects.toThrow("bind failed");
		expect(create).toHaveBeenCalledOnce();
	});

	it("conflicts when one signed attempt changes snapshot identity", async () => {
		let reserved = "";
		const reservationClient = makeReservation();
		reservationClient.reserve.mockImplementation(async (input) => {
			const candidate = JSON.stringify(input);
			if (reserved && candidate !== reserved) throw new Error("snapshot conflict");
			reserved = candidate;
			return { handle: HANDLE };
		});
		const { stripe, create } = makeStripe();
		const first = makeHandleBody();
		await createTenantPrintCheckoutSession(handleOptions(first, stripe, reservationClient));
		const changed = makeHandleBody({
			checkoutSnapshot: snapshot([{ ...SNAPSHOT_ITEM, revisionId: "changed-revision" }], "convex"),
		});
		await expect(
			createTenantPrintCheckoutSession(handleOptions(changed, stripe, reservationClient)),
		).rejects.toThrow("snapshot conflict");
		expect(create).toHaveBeenCalledOnce();
	});

	it("replays one signed attempt with the same expiry and Stripe idempotency", async () => {
		const bodyText = makeHandleBody();
		const reservationClient = makeReservation();
		const { stripe, create } = makeStripe();
		const options = handleOptions(bodyText, stripe, reservationClient);
		await createTenantPrintCheckoutSession(options);
		await createTenantPrintCheckoutSession(options);
		const calls = create.mock.calls as unknown as Array<
			[Stripe.Checkout.SessionCreateParams, Stripe.RequestOptions]
		>;
		expect(calls[0]?.[0].expires_at).toBe(calls[1]?.[0].expires_at);
		expect(calls[0]?.[1].idempotencyKey).toBe(calls[1]?.[1].idempotencyKey);
		expect(reservationClient.reserve.mock.calls[0]).toEqual(
			reservationClient.reserve.mock.calls[1],
		);
	});
});
