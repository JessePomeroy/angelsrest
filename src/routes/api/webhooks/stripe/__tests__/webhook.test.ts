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
vi.mock("stripe", () => {
	return {
		default: class MockStripe {
			webhooks = { constructEvent: mockConstructEvent };
		},
	};
});

const mockSendEmail = vi.fn();
vi.mock("resend", () => ({
	Resend: class MockResend {
		emails = { send: mockSendEmail };
	},
}));

vi.mock("$lib/server/lumaprints", () => ({
	createOrder: vi.fn().mockResolvedValue({ orderNumber: "LP-12345" }),
	// buildLumaPrintsOrder runs for real — it's a pure function with no
	// network, and the webhook test already covers the end-to-end flow.
	buildLumaPrintsOrder: vi.fn((externalId, recipient, items) => ({
		externalId,
		storeId: 83765,
		shippingMethod: "default",
		recipient: {
			firstName: recipient.firstName,
			lastName: recipient.lastName,
			addressLine1: recipient.address1,
			addressLine2: recipient.address2 || "",
			city: recipient.city,
			state: recipient.state,
			zipCode: recipient.zip,
			country: recipient.country,
			phone: recipient.phone || "",
		},
		orderItems: items.map((item: unknown, i: number) => {
			const it = item as {
				imageUrl: string;
				paperSubcategoryId: number;
				width: number;
				height: number;
				quantity: number;
			};
			return {
				externalItemId: `${externalId}-item-${i + 1}`,
				subcategoryId: it.paperSubcategoryId,
				quantity: it.quantity,
				width: it.width,
				height: it.height,
				file: { imageUrl: it.imageUrl.split("?")[0] },
				orderItemOptions: [39],
			};
		}),
	})),
}));

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
