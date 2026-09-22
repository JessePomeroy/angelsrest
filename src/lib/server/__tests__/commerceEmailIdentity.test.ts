import { ConvexHttpClient } from "convex/browser";
import { Resend } from "resend";
import type Stripe from "stripe";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { resolveCommerceEmailIdentity } from "../commerceEmailIdentity.server";
import type { CommerceNotificationProfile } from "../commerceTenant";
import { resolveCommerceTenant } from "../commerceTenant";
import {
	sendAdminNotification,
	sendAutomatedRefundAttentionAlert,
	sendAutomatedRefundFailureAlert,
	sendCustomerConfirmation,
	sendCustomerFulfillmentFailure,
	sendCustomerShipmentNotification,
	sendFulfillmentFailureAlert,
	sendPaymentFailedEmail,
	sendPrintReconciliationBlockedAlert,
} from "../webhookEmails";

const env = vi.hoisted(() => ({
	CLIENT_COMMERCE_EMAIL_ENABLED: "true",
	CLIENT_COMMERCE_EMAIL_IDENTITIES: "",
	WEBHOOK_SECRET: "fixture-secret",
}));
vi.mock("$env/dynamic/private", () => ({ env }));
const first = {
	tenantId: "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b",
	siteUrl: "first.example",
	verifiedDomain: "mail.first.example",
	fromName: "First Studio",
	fromEmail: "orders@mail.first.example",
	replyTo: "help@first.example",
	notificationEmail: "owner@first.example",
};
const second = {
	tenantId: "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07c",
	siteUrl: "second.example",
	verifiedDomain: "mail.second.example",
	fromName: "Second Studio",
	fromEmail: "orders@mail.second.example",
	replyTo: "help@second.example",
	notificationEmail: "owner@second.example",
};
const profile = (entry = first): CommerceNotificationProfile => ({
	tenantId: entry.tenantId,
	siteUrl: entry.siteUrl,
	siteName: entry.fromName,
	adminEmail: "old-recipient@example.invalid",
});
const setRegistry = (clients: unknown[] = [first, second]) => {
	env.CLIENT_COMMERCE_EMAIL_IDENTITIES = JSON.stringify({ version: 1, clients });
};
beforeEach(() => {
	env.CLIENT_COMMERCE_EMAIL_ENABLED = "true";
	setRegistry();
	vi.stubGlobal(
		"fetch",
		vi.fn(() => {
			throw new Error("Unexpected network access");
		}),
	);
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
test("selects only the matching trusted tenant/site identity", () => {
	for (const entry of [first, second])
		expect(resolveCommerceEmailIdentity(profile(entry), " Orders")).toEqual({
			headers: { from: `"${entry.fromName} Orders" <${entry.fromEmail}>`, replyTo: entry.replyTo },
			notificationEmail: entry.notificationEmail,
		});
});
test.each([
	{ ...profile(), tenantId: second.tenantId },
	{ ...profile(), siteUrl: second.siteUrl },
	{ ...profile(), tenantId: undefined },
	{ ...profile(), tenantId: "tenant_unknown" },
])("rejects missing or crossed tenant identity %j", (value) => {
	expect(() => resolveCommerceEmailIdentity(value)).toThrow("identity is unavailable");
});
test.each([
	{ ...first, fromEmail: "orders@mail.second.example" },
	{ ...first, verifiedDomain: "mail.second.example" },
	{ ...first, fromName: "First\r\nBcc: thief@example.invalid" },
	{ ...first, replyTo: "hello@example.invalid\nCc: thief@example.invalid" },
	{ ...first, notificationEmail: "Display <owner@first.example>" },
	{ ...first, verifiedDomain: "" },
	{ ...first, extra: true },
	{ ...first, siteUrl: "https://first.example/path" },
])("rejects malformed or unsafe configured headers %j", (entry) => {
	setRegistry([entry]);
	expect(() => resolveCommerceEmailIdentity(profile())).toThrow("identity is unavailable");
});
test.each([
	{ clients: [first, first] },
	{
		clients: [
			first,
			{
				...second,
				siteUrl: first.siteUrl,
				verifiedDomain: first.verifiedDomain,
				fromEmail: first.fromEmail,
			},
		],
	},
])("rejects ambiguous registry entries", ({ clients }) => {
	setRegistry(clients);
	expect(() => resolveCommerceEmailIdentity(profile())).toThrow();
});
test.each([
	"not json",
	"x".repeat(65537),
	JSON.stringify({ version: 2, clients: [first] }),
	JSON.stringify({ version: 1, clients: Array.from({ length: 101 }, () => first) }),
])("bounds and validates the registry", (raw) => {
	env.CLIENT_COMMERCE_EMAIL_IDENTITIES = raw;
	expect(() => resolveCommerceEmailIdentity(profile())).toThrow();
});
test("quotes display punctuation and permits an explicitly approved external reply mailbox", () => {
	setRegistry([{ ...first, fromName: "First, Inc.", replyTo: "owner@example.invalid" }]);
	expect(resolveCommerceEmailIdentity(profile()).headers).toEqual({
		from: '"First, Inc." <orders@mail.first.example>',
		replyTo: "owner@example.invalid",
	});
});
test("hub and flag-off identities keep the existing transport behavior", () => {
	env.CLIENT_COMMERCE_EMAIL_IDENTITIES = "malformed";
	expect(
		resolveCommerceEmailIdentity({
			siteName: "Hub",
			siteUrl: "angelsrest.online",
			adminEmail: "operator@example.invalid",
		}).headers.from,
	).toBe("Angel's Rest <orders@angelsrest.online>");
	env.CLIENT_COMMERCE_EMAIL_ENABLED = "false";
	expect(resolveCommerceEmailIdentity(profile())).toEqual({
		headers: { from: "First Studio via Angel's Rest <orders@angelsrest.online>" },
		notificationEmail: "old-recipient@example.invalid",
	});
});
const session: Parameters<typeof sendCustomerConfirmation>[1]["session"] = {
	id: "cs_test_fixture",
	metadata: {},
	payment_intent: "pi_fixture",
	amount_total: 2500,
	payment_status: "paid",
	customer_details: { name: "Buyer", email: "buyer@example.invalid" },
};
const sends: Array<{
	name: string;
	owner: boolean;
	invoke: (resend: Resend, notificationProfile: CommerceNotificationProfile) => Promise<unknown>;
}> = [
	{
		name: "receipt",
		owner: false,
		invoke: (resend, notificationProfile) =>
			sendCustomerConfirmation(
				resend,
				{
					session,
					customerEmail: "buyer@example.invalid",
					shippingDetails: null,
					lineItems: [],
					orderNumber: "ORD-001",
					notificationProfile,
				},
				"receipt:fixture",
			),
	},
	{
		name: "shipment",
		owner: false,
		invoke: (resend, notificationProfile) =>
			sendCustomerShipmentNotification(resend, {
				customerEmail: "buyer@example.invalid",
				orderNumber: "ORD-001",
				lumaprintsOrderNumber: "10000001",
				notificationProfile,
			}),
	},
	{
		name: "refund",
		owner: false,
		invoke: (resend, notificationProfile) =>
			sendCustomerFulfillmentFailure(resend, {
				customerEmail: "buyer@example.invalid",
				orderNumber: "ORD-001",
				stripeRefundId: "re_fixture",
				total: 2500,
				notificationProfile,
			}),
	},
	{
		name: "payment failure",
		owner: false,
		invoke: (resend, notificationProfile) =>
			sendPaymentFailedEmail(resend, {
				customerEmail: "buyer@example.invalid",
				errorMessage: "declined",
				notificationProfile,
			}),
	},
	{
		name: "new order",
		owner: true,
		invoke: (resend, notificationProfile) =>
			sendAdminNotification(
				resend,
				{
					session,
					customerEmail: "buyer@example.invalid",
					shippingDetails: null,
					lineItems: [],
					orderNumber: "ORD-001",
					notificationProfile,
				},
				"owner:fixture",
			),
	},
	{
		name: "supplier refund",
		owner: true,
		invoke: (resend, notificationProfile) =>
			sendFulfillmentFailureAlert(resend, {
				customerEmail: "buyer@example.invalid",
				orderNumber: "ORD-001",
				stripeRefundId: "re_fixture",
				total: 2500,
				errorSummary: "Supplier rejected",
				notificationProfile,
			}),
	},
	{
		name: "reconciliation",
		owner: true,
		invoke: (resend, notificationProfile) =>
			sendPrintReconciliationBlockedAlert(resend, {
				orderNumber: "ORD-001",
				externalId: "cs_test_fixture",
				reconciliationClass: "response_contract",
				notificationProfile,
			}),
	},
	{
		name: "failed refund",
		owner: true,
		invoke: (resend, notificationProfile) =>
			sendAutomatedRefundFailureAlert(resend, {
				customerEmail: "buyer@example.invalid",
				orderNumber: "ORD-001",
				stripeRefundId: "re_fixture",
				refundStatus: "failed",
				total: 2500,
				errorSummary: "Supplier rejected",
				notificationProfile,
			}),
	},
	{
		name: "uncertain refund",
		owner: true,
		invoke: (resend, notificationProfile) =>
			sendAutomatedRefundAttentionAlert(resend, {
				customerEmail: "buyer@example.invalid",
				orderNumber: "ORD-001",
				total: 2500,
				errorSummary: "Supplier rejected",
				attentionReason: "request_outcome_unknown",
				notificationIdentity: "0123456789abcdef0123456789abcdef",
				notificationProfile,
			}),
	},
];
test.each(
	sends,
)("routes $name through the same Resend client with client headers and recipient", async ({
	owner,
	invoke,
}) => {
	const resend = new Resend("re_offline_fixture");
	const send = vi
		.spyOn(resend.emails, "send")
		.mockResolvedValue({ data: { id: "email-fixture" }, error: null, headers: null });
	for (const entry of [first, second]) {
		await invoke(resend, profile(entry));
		const payload = send.mock.calls.at(-1)?.[0];
		expect(payload).toMatchObject({
			from: expect.stringContaining(`<${entry.fromEmail}>`),
			replyTo: entry.replyTo,
			to: [owner ? entry.notificationEmail : "buyer@example.invalid"],
		});
		expect(payload?.html).toContain(entry.fromName);
	}
	expect(send).toHaveBeenCalledTimes(2);
	expect(fetch).not.toHaveBeenCalled();
});
test("missing client configuration stops before a provider send", async () => {
	setRegistry([second]);
	const resend = new Resend("re_offline_fixture");
	const send = vi.spyOn(resend.emails, "send");
	for (const item of sends)
		await expect(item.invoke(resend, profile())).rejects.toThrow("identity is unavailable");
	expect(send).not.toHaveBeenCalled();
});
test("provider rejection or no delivery ID never claims acceptance", async () => {
	const resend = new Resend("re_offline_fixture");
	const send = vi.spyOn(resend.emails, "send").mockResolvedValue({
		data: null,
		error: { name: "validation_error", message: "Domain is not verified", statusCode: 403 },
		headers: null,
	});
	await expect(sends[0].invoke(resend, profile())).rejects.toThrow("Domain is not verified");
	send.mockResolvedValue({ data: { id: "" }, error: null, headers: null });
	await expect(sends[0].invoke(resend, profile())).rejects.toThrow("no delivery id");
});
test("server tenant resolution carries identity while event-supplied sender fields cannot override it", async () => {
	const convex = new ConvexHttpClient("https://example.invalid");
	vi.spyOn(convex, "query").mockResolvedValue({
		tenantId: first.tenantId,
		siteUrl: first.siteUrl,
		name: first.fromName,
		email: "database@example.invalid",
		adminEmails: ["database@example.invalid"],
	});
	const event = {
		id: "evt_fixture",
		type: "checkout.session.completed",
		account: "acct_fixture",
		data: {
			object: {
				metadata: {
					commerceTenantSiteUrl: first.siteUrl,
					fromEmail: second.fromEmail,
					replyTo: second.replyTo,
					notificationEmail: second.notificationEmail,
				},
			},
		},
	} as unknown as Stripe.Event;
	const resolved = await resolveCommerceTenant(event, convex);
	expect(resolved.notificationProfile.tenantId).toBe(first.tenantId);
	expect(resolveCommerceEmailIdentity(resolved.notificationProfile)).toMatchObject({
		headers: { replyTo: first.replyTo },
		notificationEmail: first.notificationEmail,
	});
});
