import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Module Mocks ─────────────────────────────────────────────────────────────

const mockConvexMutation = vi.fn();
const mockConvexQuery = vi.fn();

vi.mock("$lib/server/convexClient", () => ({
	getConvex: () => ({
		mutation: mockConvexMutation,
		query: mockConvexQuery,
	}),
}));

vi.mock("$lib/config/site", () => ({
	SITE_DOMAIN: "angelsrest.online",
}));

const mockConstructEvent = vi.fn();
const mockRefundsCreate = vi.fn();
vi.mock("stripe", () => {
	return {
		default: class MockStripe {
			webhooks = { constructEvent: mockConstructEvent };
			refunds = { create: mockRefundsCreate };
		},
	};
});

const mockSendEmail = vi.fn();
vi.mock("resend", () => ({
	Resend: class MockResend {
		emails = { send: mockSendEmail };
	},
}));

// Mock only the network boundary (createOrder). buildLumaPrintsOrder and
// cleanImageUrl are pure functions with no network or env side effects —
// running them for real means this test exercises the same code path as
// production. Divergence risk = 0. Pattern mirrors
// createEmailSendHandler.test.ts in the admin-dashboard package.
const mockCreateLumaOrder = vi.fn();
vi.mock("$lib/server/lumaprints", async () => {
	const actual = await vi.importActual<typeof import("$lib/server/lumaprints")>(
		"$lib/server/lumaprints",
	);
	return {
		...actual,
		createOrder: mockCreateLumaOrder,
	};
});

vi.mock("$convex/api", () => ({
	api: {
		orders: { create: "orders.create", updateStatus: "orders.updateStatus" },
		invoices: { markPaid: "invoices.markPaid" },
	},
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCheckoutSession(
	overrides?: Partial<Stripe.Checkout.Session>,
): Stripe.Checkout.Session {
	return {
		id: "cs_test_123",
		amount_total: 3500,
		amount_subtotal: 3500,
		payment_status: "paid",
		payment_intent: "pi_test_123",
		customer_details: {
			name: "Jane Doe",
			email: "jane@example.com",
		},
		collected_information: {
			shipping_details: {
				name: "Jane Doe",
				address: {
					line1: "123 Main St",
					line2: null,
					city: "Portland",
					state: "OR",
					postal_code: "97201",
					country: "US",
				},
			},
		},
		metadata: {
			paperSubcategoryId: "103001",
			paperWidth: "8",
			paperHeight: "10",
			paperName: "Archival Matte",
			imageUrl: "https://cdn.sanity.io/images/photo.jpg?w=1200",
			productId: "test-print",
		},
		...overrides,
	} as unknown as Stripe.Checkout.Session;
}

function makeStripeEvent(type: string, object: unknown): Stripe.Event {
	return {
		id: "evt_test_123",
		type,
		data: { object },
	} as unknown as Stripe.Event;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Stripe webhook POST handler", () => {
	let POST: (event: any) => Promise<Response>;

	beforeEach(async () => {
		vi.clearAllMocks();

		// Default: constructEvent returns a valid checkout event
		const session = makeCheckoutSession();
		const event = makeStripeEvent("checkout.session.completed", session);
		mockConstructEvent.mockReturnValue(event);

		// Default: order creation succeeds
		mockConvexMutation.mockResolvedValue({
			_id: "order-123",
			orderNumber: "ORD-001",
		});

		// Default: email sends succeed
		mockSendEmail.mockResolvedValue({ id: "email-123" });

		// Default: LumaPrints createOrder succeeds
		mockCreateLumaOrder.mockResolvedValue({ orderNumber: "LP-12345" });

		// Default: Stripe refunds succeed
		mockRefundsCreate.mockResolvedValue({
			id: "re_test_refund_123",
			status: "succeeded",
		});

		// Dynamic import to pick up mocks
		vi.resetModules();
		const mod = await import("../+server");
		POST = mod.POST as unknown as typeof POST;
	});

	it("returns 400 when stripe-signature header is missing", async () => {
		const req = {
			request: new Request("http://localhost/api/webhooks/stripe", {
				method: "POST",
				body: "{}",
			}),
		};
		// Override request.headers.get to return null for stripe-signature
		Object.defineProperty(req.request.headers, "get", {
			value: () => null,
		});

		try {
			await POST(req);
			expect.fail("should have thrown");
		} catch (err: any) {
			expect(err.status).toBe(400);
		}
	});

	it("returns 400 when webhook signature is invalid", async () => {
		mockConstructEvent.mockImplementation(() => {
			throw new Error("Signature mismatch");
		});

		const req = {
			request: new Request("http://localhost/api/webhooks/stripe", {
				method: "POST",
				headers: { "stripe-signature": "bad-sig" },
				body: "{}",
			}),
		};

		try {
			await POST(req);
			expect.fail("should have thrown");
		} catch (err: any) {
			expect(err.status).toBe(400);
		}
	});

	it("creates order in Convex on valid checkout.session.completed", async () => {
		const req = {
			request: new Request("http://localhost/api/webhooks/stripe", {
				method: "POST",
				headers: { "stripe-signature": "valid-sig" },
				body: "{}",
			}),
		};

		const response = await POST(req);
		expect(response.status).toBe(200);

		// Should have called orders.create mutation
		expect(mockConvexMutation).toHaveBeenCalledWith(
			"orders.create",
			expect.objectContaining({
				siteUrl: "angelsrest.online",
				stripeSessionId: "cs_test_123",
				customerEmail: "jane@example.com",
			}),
		);
	});

	it("returns 500 and sends alert when order creation fails", async () => {
		mockConvexMutation.mockRejectedValue(new Error("Convex mutation failed"));

		const req = {
			request: new Request("http://localhost/api/webhooks/stripe", {
				method: "POST",
				headers: { "stripe-signature": "valid-sig" },
				body: "{}",
			}),
		};

		try {
			await POST(req);
			expect.fail("should have thrown 500");
		} catch (err: any) {
			expect(err.status).toBe(500);
		}

		// Should have sent alert email
		expect(mockSendEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				subject: expect.stringContaining("Webhook failure"),
			}),
		);
	});

	it("returns 200 for non-checkout events", async () => {
		const event = makeStripeEvent("payment_intent.succeeded", {});
		mockConstructEvent.mockReturnValue(event);

		const req = {
			request: new Request("http://localhost/api/webhooks/stripe", {
				method: "POST",
				headers: { "stripe-signature": "valid-sig" },
				body: "{}",
			}),
		};

		const response = await POST(req);
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.received).toBe(true);
	});

	// ─── audit #23 PR #3: permanent-failure fallback ─────────────────────────

	it("refunds + marks fulfillment_error + emails admin on permanent LumaPrints failure", async () => {
		// LumaPrints rejects the order with a 4xx-style validation error.
		// classifyLumaPrintsFailure should categorize this as permanent.
		const { LumaPrintsError } = await import("$lib/server/lumaprints");
		mockCreateLumaOrder.mockRejectedValue(
			new LumaPrintsError("Order submission failed", {
				statusCode: 400,
				message: "Invalid subcategoryId for orderItems[0]",
			}),
		);

		const req = {
			request: new Request("http://localhost/api/webhooks/stripe", {
				method: "POST",
				headers: { "stripe-signature": "valid-sig" },
				body: "{}",
			}),
		};

		const response = await POST(req);
		// Returns 200 — we don't want Stripe to retry a permanent failure
		expect(response.status).toBe(200);

		// Stripe refund was created against the session's payment_intent
		expect(mockRefundsCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				payment_intent: "pi_test_123",
				reason: "requested_by_customer",
			}),
		);

		// Convex order was marked fulfillment_error with the refund ID
		expect(mockConvexMutation).toHaveBeenCalledWith(
			"orders.updateStatus",
			expect.objectContaining({
				status: "fulfillment_error",
				stripeRefundId: "re_test_refund_123",
				fulfillmentError: expect.stringContaining("Invalid subcategoryId"),
			}),
		);

		// Admin alert email was sent
		expect(mockSendEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				subject: expect.stringContaining("Fulfillment error"),
				text: expect.stringContaining("Invalid subcategoryId"),
			}),
		);
	});

	it("re-throws transient LumaPrints failures so Stripe retries", async () => {
		// A LumaPrints 5xx error is transient — classifier returns "transient".
		const { LumaPrintsError } = await import("$lib/server/lumaprints");
		mockCreateLumaOrder.mockRejectedValue(
			new LumaPrintsError("Order submission failed", {
				statusCode: 503,
				message: "Service temporarily unavailable",
			}),
		);

		const req = {
			request: new Request("http://localhost/api/webhooks/stripe", {
				method: "POST",
				headers: { "stripe-signature": "valid-sig" },
				body: "{}",
			}),
		};

		try {
			await POST(req);
			expect.fail("should have thrown 500 so Stripe retries");
		} catch (err: any) {
			expect(err.status).toBe(500);
		}

		// Did NOT refund — transient errors should let Stripe retry
		expect(mockRefundsCreate).not.toHaveBeenCalled();

		// Did NOT mark fulfillment_error — status stays in its previous state
		expect(mockConvexMutation).not.toHaveBeenCalledWith(
			"orders.updateStatus",
			expect.objectContaining({ status: "fulfillment_error" }),
		);
	});

	it("still returns 200 when Stripe refund call itself fails during permanent-failure path", async () => {
		// Permanent LumaPrints error...
		const { LumaPrintsError } = await import("$lib/server/lumaprints");
		mockCreateLumaOrder.mockRejectedValue(
			new LumaPrintsError("Order submission failed", {
				statusCode: 422,
				message: "Unprocessable payload",
			}),
		);
		// ...and the Stripe refund API is ALSO down.
		mockRefundsCreate.mockRejectedValue(new Error("Stripe API timeout"));

		const req = {
			request: new Request("http://localhost/api/webhooks/stripe", {
				method: "POST",
				headers: { "stripe-signature": "valid-sig" },
				body: "{}",
			}),
		};

		const response = await POST(req);
		// Still 200 — the underlying LumaPrints issue is permanent, and the
		// admin email will notify us that the refund also failed so we can
		// refund manually.
		expect(response.status).toBe(200);

		// Convex still updated (with stripeRefundId undefined)
		expect(mockConvexMutation).toHaveBeenCalledWith(
			"orders.updateStatus",
			expect.objectContaining({ status: "fulfillment_error" }),
		);

		// Admin still emailed — with an explicit "refund FAILED" indicator
		expect(mockSendEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				text: expect.stringContaining("Refund FAILED"),
			}),
		);
	});

	it("marks invoice as paid for invoice_payment metadata", async () => {
		const session = makeCheckoutSession({
			metadata: {
				type: "invoice_payment",
				invoiceId: "inv-123",
				siteUrl: "angelsrest.online",
			},
		});
		const event = makeStripeEvent("checkout.session.completed", session);
		mockConstructEvent.mockReturnValue(event);

		const req = {
			request: new Request("http://localhost/api/webhooks/stripe", {
				method: "POST",
				headers: { "stripe-signature": "valid-sig" },
				body: "{}",
			}),
		};

		const response = await POST(req);
		expect(response.status).toBe(200);

		expect(mockConvexMutation).toHaveBeenCalledWith(
			"invoices.markPaid",
			expect.objectContaining({
				invoiceId: "inv-123",
				siteUrl: "angelsrest.online",
			}),
		);
	});
});
