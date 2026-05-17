import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLogStructured = vi.fn();
const mockCreateOrderInConvex = vi.fn();
const mockSendFailureAlert = vi.fn();
const mockSendPaymentFailedEmail = vi.fn();

vi.mock("$lib/server/logger", () => ({
	logStructured: mockLogStructured,
}));

vi.mock("$lib/server/webhookOrders", () => ({
	createOrderInConvex: mockCreateOrderInConvex,
}));

vi.mock("$lib/server/webhookEmails", () => ({
	sendAdminNotification: vi.fn(),
	sendCustomerConfirmation: vi.fn(),
	sendFailureAlert: mockSendFailureAlert,
	sendPaymentFailedEmail: mockSendPaymentFailedEmail,
}));

vi.mock("$convex/api", () => ({
	api: {
		invoices: { markPaid: "invoices.markPaid" },
	},
}));

vi.mock("$env/dynamic/private", () => ({
	env: {
		WEBHOOK_SECRET: "test-webhook-secret",
	},
}));

vi.mock("$lib/config/site", () => ({
	SITE_DOMAIN: "angelsrest.online",
}));

function makeStripeEvent(type: string, object: unknown): Stripe.Event {
	return {
		id: "evt_test_123",
		type,
		data: { object },
	} as Stripe.Event;
}

function makeCheckoutSession(
	overrides?: Partial<Stripe.Checkout.Session>,
): Stripe.Checkout.Session {
	return {
		id: "cs_test_123",
		customer_email: "jane@example.com",
		customer_details: {
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
		metadata: {},
		...overrides,
	} as unknown as Stripe.Checkout.Session;
}

describe("processStripeWebhookEvent", () => {
	const convex = {
		mutation: vi.fn(),
	} as any;
	const resend = {} as any;
	const stripe = {
		checkout: {
			sessions: {
				retrieve: vi.fn(),
			},
		},
	} as any;

	beforeEach(() => {
		vi.clearAllMocks();
		stripe.checkout.sessions.retrieve.mockReset();
		convex.mutation.mockReset();
		mockCreateOrderInConvex.mockResolvedValue({
			orderNumber: "ORD-001",
			alreadyExisted: false,
		});
	});

	it("routes print checkout sessions through order creation", async () => {
		const session = makeCheckoutSession();
		stripe.checkout.sessions.retrieve.mockResolvedValue({
			...session,
			line_items: { data: [] },
		});

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(makeStripeEvent("checkout.session.completed", session), {
			stripe,
			resend,
			convex,
		});

		expect(mockCreateOrderInConvex).toHaveBeenCalledWith(
			expect.objectContaining({ stripe, resend, convex }),
			expect.objectContaining({
				session: expect.objectContaining({ id: "cs_test_123" }),
				lineItems: [],
			}),
		);
	});

	it("routes invoice payment sessions to invoice settlement only", async () => {
		const session = makeCheckoutSession({
			metadata: {
				type: "invoice_payment",
				invoiceId: "invoice-123",
				siteUrl: "https://client.example",
			},
		});

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(makeStripeEvent("checkout.session.completed", session), {
			stripe,
			resend,
			convex,
		});

		expect(convex.mutation).toHaveBeenCalledWith("invoices.markPaid", {
			webhookSecret: "test-webhook-secret",
			invoiceId: "invoice-123",
			siteUrl: "https://client.example",
		});
		expect(mockCreateOrderInConvex).not.toHaveBeenCalled();
	});

	it("sends payment failure email when Stripe provides a receipt email", async () => {
		const paymentIntent = {
			id: "pi_test_123",
			receipt_email: "jane@example.com",
			last_payment_error: { message: "card declined" },
		} as Stripe.PaymentIntent;

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(
			makeStripeEvent("payment_intent.payment_failed", paymentIntent),
			{
				stripe,
				resend,
				convex,
			},
		);

		expect(mockSendPaymentFailedEmail).toHaveBeenCalledWith(resend, {
			customerEmail: "jane@example.com",
			errorMessage: "card declined",
		});
	});
});
