import { describe, expect, it, vi } from "vitest";
import {
	formatLineItems,
	sendAdminNotification,
	sendAutomatedRefundAttentionAlert,
	sendAutomatedRefundFailureAlert,
	sendCustomerConfirmation,
	sendCustomerFulfillmentFailure,
	sendCustomerShipmentNotification,
	sendFailureAlert,
	sendFulfillmentFailureAlert,
	sendPaymentFailedEmail,
	sendPrintReconciliationBlockedAlert,
} from "$lib/server/webhookEmails";

function resend() {
	const send = vi.fn(
		async (
			_payload: {
				attachments?: Array<{
					content: string;
					contentId: string;
					contentType: string;
					filename: string;
				}>;
				from: string;
				html?: string;
				text: string;
				subject?: string;
				to?: string[];
			},
			_options?: { idempotencyKey: string },
		) => ({
			data: { id: "email-123" },
			error: null,
		}),
	);
	return {
		emails: {
			send,
		},
	};
}

function resendWithoutDeliveryId() {
	return {
		emails: {
			send: vi.fn().mockResolvedValue({ data: null, error: null }),
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

const lineItems = [
	{
		description: "Archival print",
		quantity: 2,
		amount_subtotal: 2500,
		amount_total: 2500,
		price: { unit_amount: 1250 },
	},
] as any;

describe("webhook customer emails", () => {
	it("shows unit price and extended line total, with a subtotal fallback", () => {
		expect(
			formatLineItems([
				{
					description: "Archival print",
					quantity: 2,
					amount_subtotal: 2400,
					amount_total: 2000,
					price: null,
				} as any,
			]),
		).toBe("• Archival print (2 × $12.00) — $20.00");
	});

	it("sends an immediate paid receipt with the order number and an idempotency key", async () => {
		const mockResend = resend();

		await sendCustomerConfirmation(
			mockResend as any,
			{
				session: baseSession,
				customerEmail: "buyer@example.com",
				shippingDetails,
				lineItems,
				orderNumber: "ORD-001",
			},
			"order-receipt:customer:order-001",
		);

		const payload = mockResend.emails.send.mock.calls[0]?.[0];
		if (!payload) throw new Error("expected confirmation email payload");
		expect(mockResend.emails.send).toHaveBeenCalledOnce();
		expect(payload.from).toBe("Angel's Rest <orders@angelsrest.online>");
		expect(payload.to).toEqual(["buyer@example.com"]);
		expect(payload.subject).toBe("Order received — ORD-001");
		expect(mockResend.emails.send.mock.calls[0]?.[1]).toEqual({
			idempotencyKey: "order-receipt:customer:order-001",
		});
		expect(payload.text).toBe(`Hi Buyer,

Thank you! We have received your order and payment.

ORDER DETAILS
Order ID: ORD-001
Total: $25.00

ITEMS ORDERED
• Archival print (2 × $12.50) — $25.00

SHIPPING ADDRESS
Buyer
123 Main St
Detroit, MI 48201
US

TRACK YOUR ORDER
View your order status anytime: https://angelsrest.online/orders?order=ORD-001

WHAT'S NEXT?
• We are arranging fulfillment for your order
• You can check progress on your order status page
• You'll receive tracking information once your order ships

If you have any questions, just reply to this email.

Thank you for supporting Angel's Rest!

Best regards,
Angel's Rest
https://angelsrest.online`);
		expect(payload.html).toContain("<!doctype html>");
		expect(payload.html).toContain("<h1");
		expect(payload.html).toContain("ORD-001");
		expect(payload.html).not.toContain("cs_test_123");
		expect(payload.html).toContain("2 × $12.50");
		expect(payload.html).toContain(
			'background="https://media.angelsrest.online/sites/angelsrest.online/email/receipt-paper-warning-lines-60eaecf2f022.jpg"',
		);
		expect(payload.html).toContain(
			"background-image: url('https://media.angelsrest.online/sites/angelsrest.online/email/receipt-paper-warning-lines-60eaecf2f022.jpg')",
		);
		expect(payload.html).not.toContain('<img src="cid:');
		expect(payload.attachments).toBeUndefined();
		expect(payload.html).toContain(">View order status</a>");
		expect(
			payload.html?.match(/https:\/\/angelsrest\.online\/orders\?order=ORD-001/g),
		).toHaveLength(3);
		expect(payload.text).not.toContain("orders?email=");
		expect(payload.text).not.toContain("buyer@example.com");
		expect(payload.text).not.toContain("buyer%40example.com");
		expect(payload.html).not.toContain("buyer@example.com");
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
			| { attachments?: unknown; from: string; html?: string; text: string }
			| undefined;
		if (!payload) throw new Error("expected tenant confirmation email payload");
		expect(payload.from).toBe("Reflecting Pool via Angel's Rest <orders@angelsrest.online>");
		expect(payload.text).toContain(
			"View your order status anytime: https://zippymiggy.com/orders?order=ORD-002",
		);
		expect(payload.text).toContain("Thank you for supporting Reflecting Pool!");
		expect(payload.html).toContain(">Reflecting Pool</a>");
		expect(payload.html?.match(/https:\/\/zippymiggy\.com\/orders\?order=ORD-002/g)).toHaveLength(
			3,
		);
		expect(payload.html).not.toContain("https://angelsrest.online/orders");
		expect(payload.attachments).toBeUndefined();
	});

	it("keeps the tenant digital download path and falls back to the session reference", async () => {
		const mockResend = resend();

		await sendCustomerConfirmation(mockResend as any, {
			session: { ...baseSession, metadata: { isDigital: "true" } },
			customerEmail: "buyer@example.com",
			shippingDetails: null,
			lineItems,
			notificationProfile: {
				siteName: "Reflecting Pool",
				siteUrl: "zippymiggy.com",
				adminEmail: "maggie@example.com",
			},
		});

		const payload = mockResend.emails.send.mock.calls[0]?.[0];
		if (!payload) throw new Error("expected digital confirmation email payload");
		expect(mockResend.emails.send).toHaveBeenCalledOnce();
		expect(payload.from).toBe("Reflecting Pool via Angel's Rest <orders@angelsrest.online>");
		expect(payload.to).toEqual(["buyer@example.com"]);
		expect(payload.subject).toBe("Order received — cs_test_123");
		expect(payload.text).toBe(`Hi Buyer,

Thank you! We have received your order and payment.

ORDER DETAILS
Order ID: cs_test_123
Total: $25.00

ITEMS ORDERED
• Archival print (2 × $12.50) — $25.00

DOWNLOAD YOUR PURCHASE
https://zippymiggy.com/checkout/success?session_id=cs_test_123

Your download link will remain active. If you open it from a new browser, enter the email address used at checkout to verify the order.

If you have any questions, just reply to this email.

Thank you for supporting Reflecting Pool!

Best regards,
Reflecting Pool
https://zippymiggy.com`);
		expect(payload.html).toContain(">Download purchase</a>");
		expect(
			payload.html?.match(/https:\/\/zippymiggy\.com\/checkout\/success\?session_id=cs_test_123/g),
		).toHaveLength(3);
		expect(payload.html).not.toContain("Shipping address");
		expect(payload.html).not.toContain("View order status");
	});

	it("still propagates a thrown confirmation delivery failure after one send attempt", async () => {
		const deliveryFailure = new Error("Resend transport unavailable");
		const mockResend = {
			emails: { send: vi.fn().mockRejectedValue(deliveryFailure) },
		};

		await expect(
			sendCustomerConfirmation(mockResend as any, {
				session: baseSession,
				customerEmail: "buyer@example.com",
				shippingDetails,
				lineItems,
				orderNumber: "ORD-003",
			}),
		).rejects.toBe(deliveryFailure);
		expect(mockResend.emails.send).toHaveBeenCalledOnce();
	});

	it("surfaces a resolved confirmation rejection after one send attempt", async () => {
		const mockResend = {
			emails: {
				send: vi.fn().mockResolvedValue({ error: { message: "Resend rejected confirmation" } }),
			},
		};

		await expect(
			sendCustomerConfirmation(mockResend as any, {
				session: baseSession,
				customerEmail: "buyer@example.com",
				shippingDetails,
				lineItems,
				orderNumber: "ORD-003",
			}),
		).rejects.toThrow("Resend rejected confirmation");
		expect(mockResend.emails.send).toHaveBeenCalledOnce();
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
		expect(payload.html).toContain("Your order is on its way.");
		expect(payload.html).toContain("TRACK-123");
		expect(payload.html).not.toContain("buyer@example.com");
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
		expect(payload.html).toContain("Print reconciliation is blocked.");
		expect(payload.html).not.toContain("private-token");
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

	it("surfaces a resolved owner-notification rejection after one send attempt", async () => {
		const mockResend = {
			emails: {
				send: vi.fn().mockResolvedValue({ error: { message: "Resend rejected owner copy" } }),
			},
		};

		await expect(
			sendAdminNotification(mockResend as any, {
				session: {
					...baseSession,
					payment_status: "paid",
					payment_intent: "pi_test_123",
				},
				customerEmail: "buyer@example.com",
				shippingDetails,
				lineItems,
				orderNumber: "ORD-010",
			}),
		).rejects.toThrow("Resend rejected owner copy");
		expect(mockResend.emails.send).toHaveBeenCalledOnce();
	});

	it("inspects and contains a resolved failure-alert rejection", async () => {
		const readMessage = vi.fn(() => "Resend rejected failure alert");
		const error = Object.defineProperty({}, "message", { get: readMessage });
		const mockResend = {
			emails: { send: vi.fn().mockResolvedValue({ error }) },
		};

		await expect(
			sendFailureAlert(
				mockResend as unknown as Parameters<typeof sendFailureAlert>[0],
				"checkout.session.completed",
				"cs_test_failure_alert",
				"Convex unavailable",
			),
		).resolves.toBeUndefined();
		expect(mockResend.emails.send).toHaveBeenCalledOnce();
		expect(readMessage).toHaveBeenCalledOnce();
	});

	it("rejects a missing provider delivery id at every commerce send boundary", async () => {
		const rejectingCases: Array<
			[
				failureMessage: string,
				invoke: (mockResend: ReturnType<typeof resendWithoutDeliveryId>) => Promise<unknown>,
			]
		> = [
			[
				"Shipment email delivery failed",
				(mockResend) =>
					sendCustomerShipmentNotification(mockResend as any, {
						customerEmail: "buyer@example.com",
						orderNumber: "ORD-011",
						lumaprintsOrderNumber: "100000011",
					}),
			],
			[
				"Reconciliation-blocked alert delivery failed",
				(mockResend) =>
					sendPrintReconciliationBlockedAlert(mockResend as any, {
						orderNumber: "ORD-011",
						externalId: "cs_test_missing_delivery_id",
						reconciliationClass: "response_contract",
					}),
			],
			[
				"Customer confirmation delivery failed",
				(mockResend) =>
					sendCustomerConfirmation(mockResend as any, {
						session: baseSession,
						customerEmail: "buyer@example.com",
						shippingDetails,
						lineItems,
						orderNumber: "ORD-011",
					}),
			],
			[
				"Customer refund email delivery failed",
				(mockResend) =>
					sendCustomerFulfillmentFailure(mockResend as any, {
						customerEmail: "buyer@example.com",
						orderNumber: "ORD-011",
						stripeRefundId: "re_missing_delivery_id",
						total: 2500,
					}),
			],
			[
				"Admin order notification delivery failed",
				(mockResend) =>
					sendAdminNotification(mockResend as any, {
						session: {
							...baseSession,
							payment_status: "paid",
							payment_intent: "pi_test_missing_delivery_id",
						},
						customerEmail: "buyer@example.com",
						shippingDetails,
						lineItems,
						orderNumber: "ORD-011",
					}),
			],
			[
				"Payment-failure email delivery failed",
				(mockResend) =>
					sendPaymentFailedEmail(mockResend as any, {
						customerEmail: "buyer@example.com",
						errorMessage: "card declined",
					}),
			],
			[
				"Admin refund email delivery failed",
				(mockResend) =>
					sendFulfillmentFailureAlert(mockResend as any, {
						orderNumber: "ORD-011",
						customerEmail: "buyer@example.com",
						errorSummary: "Provider rejected fulfillment",
						stripeRefundId: "re_missing_delivery_id",
						total: 2500,
					}),
			],
			[
				"Refund-failure alert delivery failed",
				(mockResend) =>
					sendAutomatedRefundFailureAlert(mockResend as any, {
						orderNumber: "ORD-011",
						customerEmail: "buyer@example.com",
						errorSummary: "Provider rejected fulfillment",
						stripeRefundId: "re_missing_delivery_id",
						refundStatus: "failed",
						total: 2500,
					}),
			],
			[
				"Refund-attention alert delivery failed",
				(mockResend) =>
					sendAutomatedRefundAttentionAlert(mockResend as any, {
						orderNumber: "ORD-011",
						customerEmail: "buyer@example.com",
						errorSummary: "Provider rejected fulfillment",
						attentionReason: "request_outcome_unknown",
						notificationIdentity: "missingdeliveryid0123456789abcdef",
						total: 2500,
					}),
			],
		];

		for (const [failureMessage, invoke] of rejectingCases) {
			const mockResend = resendWithoutDeliveryId();
			await expect(invoke(mockResend)).rejects.toThrow(
				`${failureMessage}: provider returned no delivery id`,
			);
			expect(mockResend.emails.send).toHaveBeenCalledOnce();
		}

		const containedAlert = resendWithoutDeliveryId();
		await expect(
			sendFailureAlert(
				containedAlert as unknown as Parameters<typeof sendFailureAlert>[0],
				"checkout.session.completed",
				"cs_test_missing_delivery_id",
				"Convex unavailable",
			),
		).resolves.toBeUndefined();
		expect(containedAlert.emails.send).toHaveBeenCalledOnce();
	});

	it("adds HTML to every remaining customer and owner commerce envelope without adding sends", async () => {
		const mockResend = resend();
		const notificationProfile = {
			siteName: "Reflecting Pool",
			siteUrl: "zippymiggy.com",
			adminEmail: "owner@example.com",
		};

		await sendAdminNotification(
			mockResend as any,
			{
				session: {
					...baseSession,
					payment_status: "paid",
					payment_intent: "pi_test_123",
				},
				customerEmail: "buyer@example.com",
				shippingDetails,
				lineItems,
				orderNumber: "ORD-010",
				notificationProfile,
			},
			"order-receipt:admin:order-010",
		);
		await sendPaymentFailedEmail(mockResend as any, {
			customerEmail: "buyer@example.com",
			errorMessage: "card declined",
			notificationProfile,
		});
		await sendCustomerFulfillmentFailure(mockResend as any, {
			customerEmail: "buyer@example.com",
			orderNumber: "ORD-010",
			stripeRefundId: "re_success123",
			total: 2500,
			notificationProfile,
		});
		await sendFulfillmentFailureAlert(mockResend as any, {
			orderNumber: "ORD-010",
			customerEmail: "buyer@example.com",
			errorSummary: "Provider rejected fulfillment",
			stripeRefundId: "re_success123",
			total: 2500,
			notificationProfile,
		});
		await sendAutomatedRefundFailureAlert(mockResend as any, {
			orderNumber: "ORD-010",
			customerEmail: "buyer@example.com",
			errorSummary: "Provider rejected fulfillment",
			stripeRefundId: "re_failed123",
			refundStatus: "canceled",
			total: 2500,
			notificationProfile,
		});
		await sendAutomatedRefundAttentionAlert(mockResend as any, {
			orderNumber: "ORD-010",
			customerEmail: "buyer@example.com",
			errorSummary: "Provider rejected fulfillment",
			attentionReason: "request_outcome_unknown",
			notificationIdentity: "0123456789abcdef0123456789abcdef",
			total: 2500,
			notificationProfile,
		});
		await sendFailureAlert(
			mockResend as unknown as Parameters<typeof sendFailureAlert>[0],
			"checkout.session.completed",
			"cs_test_123",
			"Convex unavailable",
		);

		expect(mockResend.emails.send).toHaveBeenCalledTimes(7);
		const payloads = mockResend.emails.send.mock.calls.map(([payload]) => payload);
		for (const payload of payloads) {
			expect(payload.html).toMatch(/^<!doctype html>/);
			expect(payload.html?.match(/<h1\b/g)).toHaveLength(1);
		}
		expect(payloads[0]).toMatchObject({
			from: "Reflecting Pool Orders via Angel's Rest <orders@angelsrest.online>",
			to: ["owner@example.com"],
			subject: "New Order ORD-010: $25.00 from Buyer",
		});
		expect(payloads[0]?.html).toContain("A new order is ready.");
		expect(payloads[0]?.html).toContain("This order was received through Reflecting Pool.");
		expect(payloads[0]?.text).not.toContain("automatically processed");
		expect(payloads[1]).toMatchObject({
			to: ["buyer@example.com"],
			subject: "Payment could not be processed - Reflecting Pool",
		});
		expect(payloads[1]?.html).not.toContain("buyer@example.com");
		expect(payloads[2]?.html).toContain("Your refund has been issued.");
		expect(payloads[3]?.html).toContain("Fulfillment failed; refund issued.");
		expect(payloads[4]?.html).toContain("The automated refund was canceled.");
		expect(payloads[5]?.html).toContain("A refund needs attention.");
		expect(payloads[6]?.html).toContain("A webhook needs attention.");
		expect(mockResend.emails.send.mock.calls[0]?.[1]).toEqual({
			idempotencyKey: "order-receipt:admin:order-010",
		});
		expect(mockResend.emails.send.mock.calls[1]?.[1]).toBeUndefined();
		expect(mockResend.emails.send.mock.calls[2]?.[1]).toEqual({
			idempotencyKey: "fulfillment-refund-customer:re_success123",
		});
		expect(mockResend.emails.send.mock.calls[3]?.[1]).toEqual({
			idempotencyKey: "fulfillment-refund-admin:re_success123",
		});
		expect(mockResend.emails.send.mock.calls[4]?.[1]).toEqual({
			idempotencyKey: "fulfillment-refund-failed:re_failed123",
		});
		expect(mockResend.emails.send.mock.calls[5]?.[1]).toEqual({
			idempotencyKey: "fulfillment-refund-attention:order:0123456789abcdef0123456789abcdef",
		});
		expect(mockResend.emails.send.mock.calls[6]?.[1]).toBeUndefined();
	});
});
