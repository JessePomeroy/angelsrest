import { describe, expect, it, vi } from "vitest";
import {
	sendCustomerConfirmation,
	sendCustomerShipmentNotification,
} from "$lib/server/webhookEmails";

function resend() {
	const send = vi.fn(async (_payload: { from: string; text: string }) => ({ id: "email-123" }));
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
	});

	it("surfaces Resend API errors so delivery is checkpointed as failed", async () => {
		const mockResend = {
			emails: {
				send: vi.fn().mockResolvedValue({ error: { message: "Domain is not verified" } }),
			},
		};

		await expect(
			sendCustomerShipmentNotification(mockResend as any, {
				customerEmail: "buyer@example.com",
				orderNumber: "ORD-004",
			}),
		).rejects.toThrow("Domain is not verified");
	});
});
