import { describe, expect, it, vi } from "vitest";
import {
	sendAutomatedRefundAttentionAlert,
	sendAutomatedRefundFailureAlert,
	sendCustomerConfirmation,
	sendCustomerFulfillmentFailure,
	sendCustomerShipmentNotification,
	sendFulfillmentFailureAlert,
	sendPaymentFailedEmail,
	sendPrintReconciliationBlockedAlert,
} from "$lib/server/webhookEmails";

function resend() {
	const send = vi.fn(
		async (_payload: { from: string; text: string; subject?: string; to?: string[] }) => ({
			id: "email-123",
		}),
	);
	return {
		emails: {
			send,
		},
	};
}

const baseSession = {
	id: "cs_test_123",
	amount_total: 2500,
	customer_details: { name: "Buyer" },
	metadata: {},
} as any;

const shippingDetails = {
	name: "Buyer",
	address: {
		line1: "123 Main St",
		line2: null,
		city: "Detroit",
		state: "MI",
		postal_code: "48201",
		country: "US",
	},
} as any;

describe("webhook customer emails", () => {
	it("omits buyer email from physical order status links", async () => {
		const mockResend = resend();

		await sendCustomerConfirmation(mockResend as any, {
			session: baseSession,
			customerEmail: "buyer@example.com",
			shippingDetails,
			lineItems: [],
			orderNumber: "ORD-001",
		});

		const payload = mockResend.emails.send.mock.calls[0]?.[0];
		if (!payload) throw new Error("expected confirmation email payload");
		expect(payload.text).toContain(
			"View your order status anytime: https://angelsrest.online/orders?order=ORD-001",
		);
		expect(payload.text).not.toContain("orders?email=");
		expect(payload.text).not.toContain("buyer@example.com");
		expect(payload.text).not.toContain("buyer%40example.com");
	});

	it("uses the resolved tenant identity for connected-account customer copy", async () => {
		const mockResend = resend();

		await sendCustomerConfirmation(mockResend as any, {
			session: baseSession,
			customerEmail: "buyer@example.com",
			shippingDetails,
			lineItems: [],
			orderNumber: "ORD-002",
			notificationProfile: {
				siteName: "Reflecting Pool",
				siteUrl: "zippymiggy.com",
				adminEmail: "maggie@example.com",
			},
		});

		const payload = mockResend.emails.send.mock.calls[0]?.[0] as
			| { from: string; text: string }
			| undefined;
		if (!payload) throw new Error("expected tenant confirmation email payload");
		expect(payload.from).toBe("Reflecting Pool via Angel's Rest <orders@angelsrest.online>");
		expect(payload.text).toContain(
			"View your order status anytime: https://zippymiggy.com/orders?order=ORD-002",
		);
		expect(payload.text).toContain("Thank you for supporting Reflecting Pool!");
	});

	it("uses the resolved tenant identity for shipment copy", async () => {
		const mockResend = resend();

		await sendCustomerShipmentNotification(mockResend as any, {
			customerEmail: "buyer@example.com",
			orderNumber: "ORD-003",
			lumaprintsOrderNumber: "100000003",
			trackingNumber: "TRACK-123",
			carrier: "FedEx",
			notificationProfile: {
				siteName: "Reflecting Pool",
				siteUrl: "zippymiggy.com",
				adminEmail: "maggie@example.com",
			},
		});

		const payload = mockResend.emails.send.mock.calls[0]?.[0];
		if (!payload) throw new Error("expected tenant shipment email payload");
		expect(payload.from).toBe("Reflecting Pool via Angel's Rest <orders@angelsrest.online>");
		expect(payload.text).toContain("Tracking (FedEx): TRACK-123");
		expect(payload.text).toContain("https://zippymiggy.com/orders");
		expect(mockResend.emails.send).toHaveBeenCalledWith(expect.anything(), {
			idempotencyKey: "shipment-email:100000003",
		});
	});

	it("bounds the one-time reconciliation-blocked operator alert to fixed safe copy", async () => {
		const mockResend = resend();
		const unsafeOrderNumber = `ORD-001\nprivate-token-${"x".repeat(2000)}`;

		await sendPrintReconciliationBlockedAlert(
			mockResend as unknown as Parameters<typeof sendPrintReconciliationBlockedAlert>[0],
			{
				orderNumber: unsafeOrderNumber,
				externalId: "cs_test_alertemail12345678",
				reconciliationClass: "response_contract",
				notificationProfile: {
					siteName: "Reflecting Pool",
					siteUrl: "zippymiggy.com",
					adminEmail: "operator@example.com",
				},
			},
		);

		const payload = mockResend.emails.send.mock.calls[0]?.[0];
		if (!payload) throw new Error("expected reconciliation-blocked alert payload");
		expect(payload.to).toEqual(["operator@example.com"]);
		expect(payload.subject).toBe("Print reconciliation blocked for order unknown");
		expect(payload.text).toContain(
			"Classification: Provider response did not match the expected contract",
		);
		expect(payload.text).toContain("No customer failure email or automatic refund was sent.");
		expect(payload.text).not.toContain("private-token");
		expect(payload.text.length).toBeLessThan(1000);
		expect(mockResend.emails.send).toHaveBeenCalledWith(expect.anything(), {
			idempotencyKey: "print-reconciliation-blocked:cs_test_alertemail12345678",
		});
	});

	it("replaces a short malformed reconciliation order reference", async () => {
		const mockResend = resend();
		await sendPrintReconciliationBlockedAlert(
			mockResend as unknown as Parameters<typeof sendPrintReconciliationBlockedAlert>[0],
			{
				orderNumber: "ORD-NaN",
				externalId: "cs_test_malformedreference1234",
				reconciliationClass: "client_error",
			},
		);
		const payload = mockResend.emails.send.mock.calls[0]?.[0];
		expect(payload?.subject).toBe("Print reconciliation blocked for order unknown");
		expect(payload?.text).toContain("stopped for order unknown");
		expect(payload?.text).not.toContain("ORD-NaN");
	});

	it("preserves a canonical order reference in prolonged GET escalation", async () => {
		const mockResend = resend();
		await sendPrintReconciliationBlockedAlert(
			mockResend as unknown as Parameters<typeof sendPrintReconciliationBlockedAlert>[0],
			{
				orderNumber: "ORD-005",
				externalId: "cs_test_prolongedlookup1234",
				reconciliationClass: "client_error",
				escalationReason: "result_not_observed",
			},
		);
		const payload = mockResend.emails.send.mock.calls[0]?.[0];
		expect(payload?.subject).toBe("Print reconciliation blocked for order ORD-005");
		expect(payload?.text).toContain("stopped for order ORD-005");
		expect(payload?.text).toContain("Repeated provider lookups remained inconclusive");
		expect(payload?.text).toContain("does not assert that the provider order is absent");
	});

	it("uses stable refund keys and surfaces Resend API failures", async () => {
		const failingResend = {
			emails: {
				send: vi.fn().mockResolvedValue({ error: { message: "Resend rejected refund copy" } }),
			},
		};
		await expect(
			sendCustomerFulfillmentFailure(failingResend as any, {
				customerEmail: "buyer@example.com",
				orderNumber: "ORD-006",
				stripeRefundId: "re_emailfailure123456",
				total: 1500,
			}),
		).rejects.toThrow("Resend rejected refund copy");
		expect(failingResend.emails.send).toHaveBeenCalledWith(expect.anything(), {
			idempotencyKey: "fulfillment-refund-customer:re_emailfailure123456",
		});

		await expect(
			sendFulfillmentFailureAlert(failingResend as any, {
				orderNumber: "ORD-006",
				customerEmail: "buyer@example.com",
				errorSummary: "Provider rejected fulfillment",
				stripeRefundId: "re_emailfailure123456",
				total: 1500,
			}),
		).rejects.toThrow("Resend rejected refund copy");
		expect(failingResend.emails.send).toHaveBeenLastCalledWith(expect.anything(), {
			idempotencyKey: "fulfillment-refund-admin:re_emailfailure123456",
		});
	});

	it("uses a stable operator-only key for a failed automated refund", async () => {
		const mockResend = resend();
		await sendAutomatedRefundFailureAlert(mockResend as any, {
			orderNumber: "ORD-007",
			customerEmail: "buyer@example.com",
			errorSummary: "Provider rejected fulfillment",
			stripeRefundId: "re_failed1234567890",
			refundStatus: "failed",
			total: 1500,
		});
		const payload = mockResend.emails.send.mock.calls[0]?.[0];
		expect(payload?.text).toContain("No customer refund-success email was sent");
		expect(mockResend.emails.send).toHaveBeenCalledWith(expect.anything(), {
			idempotencyKey: "fulfillment-refund-failed:re_failed1234567890",
		});
	});

	it("uses a stable operator-only key without inferring success for refund attention", async () => {
		const mockResend = resend();
		await sendAutomatedRefundAttentionAlert(mockResend as any, {
			orderNumber: "ORD-008",
			customerEmail: "buyer@example.com",
			errorSummary: "Provider rejected fulfillment",
			stripeRefundId: "re_attention1234567890",
			refundStatus: "requires_action",
			attentionReason: "age_exceeded",
			notificationIdentity: "0123456789abcdef0123456789abcdef",
			total: 1500,
			notificationProfile: {
				siteName: "Test tenant",
				siteUrl: "tenant.example",
				adminEmail: "admin@example.com",
			},
		});
		const payload = mockResend.emails.send.mock.calls[0]?.[0];
		expect(payload?.to).toEqual(["admin@example.com"]);
		expect(payload?.text).toContain("No refund success was inferred");
		expect(payload?.text).toContain("Signed Stripe refund updates may still resolve");
		expect(mockResend.emails.send).toHaveBeenCalledWith(expect.anything(), {
			idempotencyKey: "fulfillment-refund-attention:order:0123456789abcdef0123456789abcdef",
		});
	});

	it("alerts without inventing a refund ID when request outcome is unknown", async () => {
		const mockResend = resend();
		await sendAutomatedRefundAttentionAlert(mockResend as any, {
			orderNumber: "ORD-009",
			customerEmail: "buyer@example.com",
			errorSummary: "Provider rejected fulfillment",
			attentionReason: "request_outcome_unknown",
			notificationIdentity: "0123456789abcdef0123456789abcdef",
			total: 1500,
			notificationProfile: {
				siteName: "Test tenant",
				siteUrl: "tenant.example",
				adminEmail: "admin@example.com",
			},
		});

		const payload = mockResend.emails.send.mock.calls[0]?.[0];
		expect(payload?.text).toContain("Stripe refund ID: not observed");
		expect(payload?.text).toContain("Do not submit another refund automatically");
		expect(mockResend.emails.send).toHaveBeenCalledWith(expect.anything(), {
			idempotencyKey: "fulfillment-refund-attention:order:0123456789abcdef0123456789abcdef",
		});
	});

	it("surfaces payment-failure Resend API errors after a durable claim", async () => {
		const mockResend = {
			emails: {
				send: vi.fn().mockResolvedValue({ error: { message: "Resend unavailable" } }),
			},
		};

		await expect(
			sendPaymentFailedEmail(
				mockResend as unknown as Parameters<typeof sendPaymentFailedEmail>[0],
				{
					customerEmail: "buyer@example.com",
					errorMessage: "card declined",
				},
			),
		).rejects.toThrow("Resend unavailable");
	});

	it("surfaces shipment Resend API errors so delivery is checkpointed as failed", async () => {
		const mockResend = {
			emails: {
				send: vi.fn().mockResolvedValue({ error: { message: "Domain is not verified" } }),
			},
		};

		await expect(
			sendCustomerShipmentNotification(mockResend as any, {
				customerEmail: "buyer@example.com",
				orderNumber: "ORD-004",
				lumaprintsOrderNumber: "100000004",
			}),
		).rejects.toThrow("Domain is not verified");
	});
});
