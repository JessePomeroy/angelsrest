import type Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "$env/dynamic/private";
import type { CheckoutSnapshotItem } from "$lib/server/checkoutCatalog";
import type { CheckoutSessionStageError } from "$lib/server/checkoutFailures";
import type { CheckoutSnapshotReservationClient } from "$lib/server/checkoutSnapshotReservationClient";
import {
	type CreateHandleCheckoutOptions,
	createHandleCheckoutSession,
	issueSameOriginCheckoutAttempt,
	validateCheckoutAttempt,
	validateCheckoutAttemptRequest,
	validateSameOriginCheckoutAttemptRequest,
} from "$lib/server/handleCheckout";
import type { LumaPrintsConnection } from "$lib/server/lumaprintsConnections";
import { buildCheckoutLineItem } from "$lib/server/stripeCheckoutSession";
import { buildTenantCheckoutOptions } from "$lib/server/stripeConnect";

const NOW = Date.parse("2026-01-01T00:00:00Z");
const ATTEMPT = "123e4567-e89b-42d3-a456-426614174000";
const HANDLE = "223e4567-e89b-42d3-a456-426614174000";
const TENANT_ID = "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b";
const runtimeEnv = env as Record<string, string | undefined>;
const ITEM: CheckoutSnapshotItem = {
	productKey: "published-product",
	revisionId: "published-revision",
	productKind: "print",
	variantKey: "variant-key",
	materialOptionKey: "archival-matte",
	sizeOptionKey: "8x10",
	borderOptionKey: "none",
	frameOptionKey: "none",
};

afterEach(() => {
	runtimeEnv.ORDER_PRODUCERS_STATE = "open";
	delete runtimeEnv.PRINT_INPUT_PROTOCOL;
	delete runtimeEnv.LUMAPRINTS_CHECKOUT_CAPTURE_TENANTS;
	delete runtimeEnv.LUMAPRINTS_CONNECTIONS;
	for (const key of ["API_KEY", "API_SECRET", "WEBHOOK_USERNAME", "WEBHOOK_PASSWORD"])
		delete runtimeEnv[`LUMAPRINTS_CONNECTION_CAPTURE_${key}`];
});

function harness(overrides: Record<string, unknown> = {}) {
	const events: string[] = [];
	const create = vi.fn(
		async (_params: Stripe.Checkout.SessionCreateParams, _options?: Stripe.RequestOptions) => {
			events.push("stripe");
			return { id: "cs_test_1234567890abcdefghijklmnop", url: "https://stripe.test/pay" };
		},
	);
	const reserve = vi.fn(
		async (): Promise<Awaited<ReturnType<CheckoutSnapshotReservationClient["reserve"]>>> => {
			events.push("reserve");
			return { handle: HANDLE };
		},
	);
	const bind = vi.fn(async () => {
		events.push("bind");
	});
	const admissionClient = {
		begin: vi.fn(async ({ identity }: { identity: { attempt: string } }) => {
			events.push("admission-begin");
			const changed = identity.attempt === ATTEMPT ? "a" : "b";
			return {
				site: "angelsrest.online",
				account: null,
				admissionId: "admission_123",
				handleHash: changed.repeat(64),
				requestFingerprint: "c".repeat(64),
				activeLeaseTokenHash: "d".repeat(64),
				stripeIdempotencyDigest: changed.repeat(64),
				stripeIdempotencyKey: `checkout-admission-v1:${changed.repeat(64)}`,
				hostGeneration: 1,
				admissionGeneration: 1,
				state: "active_prestripe",
			};
		}),
		markCreating: vi.fn(async () => {
			events.push("admission-creating");
			return Math.floor(NOW / 1000) + 86_100;
		}),
		markUncertain: vi.fn().mockResolvedValue(undefined),
		bind: vi.fn(async () => {
			events.push("bind");
		}),
		release: vi.fn().mockResolvedValue(true),
	};
	const bindSession = vi.fn(() => events.push("cookie"));
	const options = {
		attempt: ATTEMPT,
		attemptStartedAt: NOW,
		attemptProofClass: "same_origin_host_proof",
		site: "angelsrest.online",
		account: null,
		catalogProvider: "convex",
		snapshotItems: [ITEM],
		stripe: { checkout: { sessions: { create } } } as unknown as Stripe,
		lineItems: [
			buildCheckoutLineItem({
				name: "Trusted title",
				imageUrl: "https://cdn.example/trusted.jpg",
				unitAmountCents: 4200,
			}),
		],
		successUrl: "https://angelsrest.online/checkout/success?session_id={CHECKOUT_SESSION_ID}",
		cancelUrl: "https://angelsrest.online/checkout/cancel",
		shippingAllowedCountries: ["US"],
		tenantCheckout: buildTenantCheckoutOptions({
			tenant: { siteUrl: "angelsrest.online" },
			kind: "print",
			subtotalCents: 4200,
		}),
		bindSession,
		abuseGate: () => {
			events.push("gate");
		},
		reservationClient: { reserve, bind },
		admissionClient,
		hostGeneration: 1,
		now: NOW,
		...overrides,
	} as CreateHandleCheckoutOptions;
	return { options, create, reserve, bind, admissionClient, bindSession, events };
}

describe("handle checkout orchestration", () => {
	function captureHarness() {
		const site = "client.example";
		const account = "acct_1234567890TenantA";
		const connection: LumaPrintsConnection = {
			version: 1,
			connectionRef: "lp_client_capture",
			tenantId: TENANT_ID,
			storeId: 101,
			environment: "sandbox",
		};
		Object.assign(runtimeEnv, {
			ORDER_PRODUCERS_STATE: "open",
			LUMAPRINTS_CHECKOUT_CAPTURE_TENANTS: JSON.stringify({ version: 1, tenantIds: [TENANT_ID] }),
			LUMAPRINTS_CONNECTIONS: JSON.stringify({
				version: 1,
				connections: [{ ...connection, credentialRef: "CAPTURE" }],
			}),
			LUMAPRINTS_CONNECTION_CAPTURE_API_KEY: "synthetic-api-key",
			LUMAPRINTS_CONNECTION_CAPTURE_API_SECRET: "synthetic-api-secret",
			LUMAPRINTS_CONNECTION_CAPTURE_WEBHOOK_USERNAME: "synthetic-username",
			LUMAPRINTS_CONNECTION_CAPTURE_WEBHOOK_PASSWORD: "synthetic-password",
		});
		const test = harness({
			verifyReadiness: vi.fn().mockResolvedValue(undefined),
			site,
			account,
			successUrl: `https://${site}/checkout/success`,
			cancelUrl: `https://${site}/checkout/cancel`,
			tenantCheckout: buildTenantCheckoutOptions({
				tenant: { siteUrl: site, tenantId: TENANT_ID, stripeConnectedAccountId: account },
				kind: "print",
				subtotalCents: 4200,
			}),
		});
		test.reserve.mockResolvedValue({ handle: HANDLE, lumaprintsConnection: connection });
		return { ...test, connection };
	}

	it.each([
		true,
		false,
		"unknown",
	] as const)("resets a rejected attempt only after confirmed release (%s)", async (released) => {
		const test = captureHarness();
		test.options.verifyReadiness = vi.fn().mockRejectedValue(new Error("provider unavailable"));
		if (released === "unknown")
			test.admissionClient.release.mockRejectedValue(new Error("timeout"));
		else test.admissionClient.release.mockResolvedValue(released);
		const result = createHandleCheckoutSession(test.options);
		if (released === true) await expect(result).rejects.toMatchObject({ status: 409 });
		else await expect(result).rejects.toThrow("Payments are temporarily unavailable.");
		expect(test.create).not.toHaveBeenCalled();
		expect(test.admissionClient.markCreating).not.toHaveBeenCalled();
	});

	it("resets after a lost release response is confirmed by the next admission read", async () => {
		const test = captureHarness();
		const begin = test.admissionClient.begin.getMockImplementation();
		if (!begin) throw new Error("Missing admission fixture");
		test.admissionClient.begin.mockImplementation(async (input) => ({
			...(await begin(input)),
			state: "released_definite_no_session",
		}));
		await expect(createHandleCheckoutSession(test.options)).rejects.toMatchObject({ status: 409 });
		expect(test.options.verifyReadiness).not.toHaveBeenCalled();
		expect(test.admissionClient.markCreating).not.toHaveBeenCalled();
		expect(test.create).not.toHaveBeenCalled();
	});

	it.each([
		"creating",
		"creation_uncertain",
		"bound",
	])("preserves %s replay without checking current providers", async (state) => {
		const test = captureHarness();
		const begin = test.admissionClient.begin.getMockImplementation();
		if (!begin) throw new Error("Missing admission fixture");
		test.admissionClient.begin.mockImplementation(async (input) => ({
			...(await begin(input)),
			state,
		}));
		delete runtimeEnv.LUMAPRINTS_CONNECTION_CAPTURE_API_SECRET;
		test.options.verifyReadiness = vi.fn().mockRejectedValue(new Error("must not refresh"));
		await createHandleCheckoutSession(test.options);
		expect(test.options.verifyReadiness).not.toHaveBeenCalled();
		expect(test.admissionClient.release).not.toHaveBeenCalled();
		expect(test.admissionClient.markCreating).toHaveBeenCalledWith(expect.anything(), HANDLE);
		expect(test.create.mock.calls[0]?.[1]?.idempotencyKey).toBe(
			`checkout-admission-v1:${"a".repeat(64)}`,
		);
	});

	it("requires supplier-capture enrollment for all new client order checkouts", async () => {
		const test = captureHarness();
		delete runtimeEnv.LUMAPRINTS_CHECKOUT_CAPTURE_TENANTS;
		await expect(createHandleCheckoutSession(test.options)).rejects.toThrow(
			"Payments are temporarily unavailable.",
		);
		expect(test.reserve).not.toHaveBeenCalled();
		expect(test.create).not.toHaveBeenCalled();
	});

	it("checks the exact captured supplier configuration before creating a client payment", async () => {
		const test = captureHarness();
		await createHandleCheckoutSession(test.options);
		expect(test.reserve).toHaveBeenCalledWith(
			expect.objectContaining({
				tenantId: TENANT_ID,
				printInputVersion: 1,
				lumaprintsConnectionVersion: 1,
			}),
		);
		expect(test.create).toHaveBeenCalledTimes(1);
		expect(test.create.mock.calls[0]?.[0].metadata?.printInputVersion).toBe("1");
		expect(JSON.stringify(test.create.mock.calls)).not.toContain("synthetic-api");
	});

	it.each([
		"missing-context",
		"foreign-tenant",
		"wrong-store",
		"missing-api",
		"missing-webhook",
	])("%s stops before Stripe without falling back to central configuration", async (failure) => {
		const test = captureHarness();
		if (failure === "missing-context") test.reserve.mockResolvedValue({ handle: HANDLE });
		if (failure === "foreign-tenant")
			test.reserve.mockResolvedValue({
				handle: HANDLE,
				lumaprintsConnection: {
					...test.connection,
					tenantId: "tenant_22222222-2222-4222-8222-222222222222",
				},
			});
		if (failure === "wrong-store")
			test.reserve.mockResolvedValue({
				handle: HANDLE,
				lumaprintsConnection: { ...test.connection, storeId: 202 },
			});
		if (failure === "missing-api") delete runtimeEnv.LUMAPRINTS_CONNECTION_CAPTURE_API_SECRET;
		if (failure === "missing-webhook")
			delete runtimeEnv.LUMAPRINTS_CONNECTION_CAPTURE_WEBHOOK_PASSWORD;
		await expect(createHandleCheckoutSession(test.options)).rejects.toMatchObject(
			failure === "missing-context" ? { stage: "checkout_snapshot" } : { status: 409 },
		);
		expect(test.create).not.toHaveBeenCalled();
		if (failure === "missing-context") expect(test.admissionClient.begin).not.toHaveBeenCalled();
		else expect(test.admissionClient.release).toHaveBeenCalledOnce();
	});

	it("an explicit non-supplier reservation needs no supplier credentials", async () => {
		const test = captureHarness();
		test.reserve.mockResolvedValue({ handle: HANDLE, lumaprintsConnection: null });
		delete runtimeEnv.LUMAPRINTS_CONNECTIONS;
		await createHandleCheckoutSession(test.options);
		expect(test.create).toHaveBeenCalledTimes(1);
	});

	it.each([
		undefined,
		"frozen-v1",
	])("opts in only with the explicit Angels Rest gate: %s", async (mode) => {
		runtimeEnv.ORDER_PRODUCERS_STATE = "open";
		runtimeEnv.PRINT_INPUT_PROTOCOL = mode;
		const site = "angelsrest.online";
		const test = harness({
			site,
			successUrl: `https://${site}/checkout/success`,
			cancelUrl: `https://${site}/checkout/cancel`,
			tenantCheckout: buildTenantCheckoutOptions({
				tenant: { siteUrl: site },
				kind: "print",
				subtotalCents: 4200,
			}),
		});
		await createHandleCheckoutSession(test.options);
		expect(test.reserve).toHaveBeenCalledWith(
			expect.objectContaining(mode ? { printInputVersion: 1 } : { site }),
		);
		expect(test.create.mock.calls[0]?.[0].metadata?.printInputVersion).toBe(mode ? "1" : undefined);
		if (!mode)
			expect(test.reserve).not.toHaveBeenCalledWith(
				expect.objectContaining({ printInputVersion: 1 }),
			);
	});
	it.each([
		["missing", undefined],
		["explicit closed", "closed"],
		["invalid", "true"],
		["malformed", " open "],
		["unknown", "paused"],
	] as const)("rejects %s state before reservation or payment effects", async (_label, state) => {
		runtimeEnv.ORDER_PRODUCERS_STATE = state;
		const test = harness();

		await expect(createHandleCheckoutSession(test.options)).rejects.toThrow(
			"Order producers are closed",
		);
		expect(test.events).toEqual([]);
		expect(test.reserve).not.toHaveBeenCalled();
		expect(test.create).not.toHaveBeenCalled();
		expect(test.bind).not.toHaveBeenCalled();
		expect(test.bindSession).not.toHaveBeenCalled();
	});

	it("reserves, creates trusted Stripe state, binds, then exposes cookie and URL when open", async () => {
		runtimeEnv.ORDER_PRODUCERS_STATE = "open";
		const first = harness();
		const result = await createHandleCheckoutSession(first.options);
		expect(first.events).toEqual([
			"gate",
			"reserve",
			"admission-begin",
			"admission-creating",
			"stripe",
			"bind",
			"cookie",
		]);
		expect(result).toEqual({
			sessionId: "cs_test_1234567890abcdefghijklmnop",
			url: "https://stripe.test/pay",
			expiresAt: Math.floor(NOW / 1000) + 86_100,
		});
		const params = first.create.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
		expect(params.metadata).toEqual({
			checkoutSnapshotVersion: "2",
			checkoutSnapshotHandle: HANDLE,
			checkoutAdmissionVersion: "1",
			checkoutAdmissionHandleHash: "a".repeat(64),
			commerceTenantSiteUrl: "angelsrest.online",
		});
		expect(params.expires_at).toBe(result.expiresAt);
		expect(params.line_items?.[0]?.price_data).toMatchObject({
			unit_amount: 4200,
			product_data: { name: "Trusted title", images: ["https://cdn.example/trusted.jpg"] },
		});
	});

	it("carries a server-resolved tenant ID into both durable checkout records", async () => {
		const test = harness({
			tenantCheckout: buildTenantCheckoutOptions({
				tenant: { tenantId: TENANT_ID, siteUrl: "angelsrest.online" },
				kind: "print",
				subtotalCents: 4200,
			}),
		});
		await createHandleCheckoutSession(test.options);
		expect(test.reserve).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT_ID }));
		expect(test.admissionClient.begin).toHaveBeenCalledWith(
			expect.objectContaining({ tenantId: TENANT_ID }),
		);
		const params = test.create.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
		expect(params.metadata).toMatchObject({ commerceTenantId: TENANT_ID });
	});

	it("does not call Stripe after reserve failure", async () => {
		const test = harness({
			reservationClient: {
				reserve: vi.fn().mockRejectedValue(new Error("unavailable")),
				bind: vi.fn(),
			},
		});
		await expect(createHandleCheckoutSession(test.options)).rejects.toEqual(
			expect.objectContaining<Partial<CheckoutSessionStageError>>({ stage: "checkout_snapshot" }),
		);
		expect(test.create).not.toHaveBeenCalled();
		expect(test.bindSession).not.toHaveBeenCalled();
	});

	it("reuses exact expiry and Stripe idempotency for one attempt", async () => {
		const test = harness();
		await createHandleCheckoutSession(test.options);
		await createHandleCheckoutSession(test.options);
		const calls = test.create.mock.calls as unknown as Array<[unknown, Stripe.RequestOptions]>;
		expect(calls[0]?.[1].idempotencyKey).toBe(calls[1]?.[1].idempotencyKey);
		expect(calls[0]?.[0]).toEqual(calls[1]?.[0]);
	});

	it("uses independent idempotency for a changed attempt handle", async () => {
		const test = harness();
		test.reserve
			.mockResolvedValueOnce({ handle: HANDLE })
			.mockResolvedValueOnce({ handle: "323e4567-e89b-42d3-a456-426614174000" });
		await createHandleCheckoutSession(test.options);
		await createHandleCheckoutSession({
			...test.options,
			attempt: "423e4567-e89b-42d3-a456-426614174000",
		});
		const calls = test.create.mock.calls as unknown as Array<[unknown, Stripe.RequestOptions]>;
		expect(calls[0]?.[1].idempotencyKey).not.toBe(calls[1]?.[1].idempotencyKey);
	});

	it("withholds browser binding and success when reservation binding fails", async () => {
		const test = harness({
			admissionClient: {
				...harness().admissionClient,
				bind: vi.fn().mockRejectedValue(new Error("unavailable")),
			},
		});
		await expect(createHandleCheckoutSession(test.options)).rejects.toEqual(
			expect.objectContaining<Partial<CheckoutSessionStageError>>({ stage: "checkout_admission" }),
		);
		expect(test.bindSession).not.toHaveBeenCalled();
	});

	it("tags admission and Stripe failures at their exact effect seams", async () => {
		const admission = harness({
			admissionClient: {
				...harness().admissionClient,
				begin: vi.fn().mockRejectedValue(new Error("private admission failure")),
			},
		});
		await expect(createHandleCheckoutSession(admission.options)).rejects.toMatchObject({
			stage: "checkout_admission",
			message: "private admission failure",
		});
		expect(admission.create).not.toHaveBeenCalled();

		const stripeFailure = new Error("private Stripe failure");
		const stripe = harness({
			stripe: {
				checkout: { sessions: { create: vi.fn().mockRejectedValue(stripeFailure) } },
			} as unknown as Stripe,
		});
		await expect(createHandleCheckoutSession(stripe.options)).rejects.toMatchObject({
			stage: "checkout_stripe",
			message: stripeFailure.message,
		});
		expect(stripe.admissionClient.markUncertain).toHaveBeenCalledOnce();
		expect(stripe.bindSession).not.toHaveBeenCalled();
	});

	it("returns a fresh bounded pre-effect challenge and rejects stale attempts", () => {
		expect(() =>
			validateCheckoutAttemptRequest(undefined, undefined, NOW, () => ATTEMPT),
		).toThrowError(
			expect.objectContaining({
				status: 428,
				body: {
					code: "CHECKOUT_ATTEMPT_REQUIRED",
					message: "Checkout attempt required",
					details: { attempt: ATTEMPT, attemptStartedAt: NOW },
				},
			}),
		);
		expect(() => validateCheckoutAttemptRequest(ATTEMPT, NOW - 86_100_000, NOW)).toThrowError(
			expect.objectContaining({
				status: 409,
				body: expect.objectContaining({ code: "CHECKOUT_ATTEMPT_REJECTED" }),
			}),
		);
	});

	it("binds the same-origin challenge to the tenant, purpose, attempt, and start time", () => {
		const credential = () => "tenant-purpose-proof-secret-0123456789";
		const challenge = issueSameOriginCheckoutAttempt(
			"angelsrest.online",
			NOW,
			() => ATTEMPT,
			credential,
		);
		expect(
			validateSameOriginCheckoutAttemptRequest(
				"angelsrest.online",
				challenge.attempt,
				challenge.attemptStartedAt,
				challenge.attemptProof,
				NOW,
				() => ATTEMPT,
				credential,
			),
		).toEqual({
			attempt: ATTEMPT,
			attemptStartedAt: NOW,
			proofClass: "same_origin_host_proof",
		});
		expect(() =>
			validateSameOriginCheckoutAttemptRequest(
				"zippymiggy.com",
				challenge.attempt,
				challenge.attemptStartedAt,
				challenge.attemptProof,
				NOW,
				() => ATTEMPT,
				credential,
			),
		).toThrowError(expect.objectContaining({ status: 409 }));
	});

	it("fails malformed attempts and redirects before reservation", async () => {
		const test = harness({ attempt: "not-an-attempt" });
		await expect(createHandleCheckoutSession(test.options)).rejects.toThrow("Invalid checkout");
		expect(test.reserve).not.toHaveBeenCalled();
		expect(() => validateCheckoutAttempt(ATTEMPT, NOW + 301_000, NOW)).toThrow();
		const redirected = harness({ cancelUrl: "https://attacker.test/cancel" });
		await expect(createHandleCheckoutSession(redirected.options)).rejects.toThrow();
		expect(redirected.reserve).not.toHaveBeenCalled();
	});

	it("keeps 40-line and near-limit set snapshots out of Stripe metadata", async () => {
		const items = Array.from({ length: 40 }, (_, index) => ({
			...ITEM,
			productKey: `published-product-${index}`,
		}));
		const lines = items.map((_, index) =>
			buildCheckoutLineItem({ name: `Trusted ${index}`, unitAmountCents: 100 + index }),
		);
		const test = harness({ snapshotItems: items, lineItems: lines });
		await createHandleCheckoutSession(test.options);
		const params = test.create.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
		expect(params.line_items).toHaveLength(40);
		expect(Object.keys(params.metadata ?? {})).toHaveLength(5);
		expect(JSON.stringify(params.metadata)).not.toContain("published-product");
	});
});
