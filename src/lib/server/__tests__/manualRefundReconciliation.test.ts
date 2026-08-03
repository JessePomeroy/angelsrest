import type { ConvexHttpClient } from "convex/browser";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	ManualRefundReconciliationRetryableError,
	reconcileSucceededManualRefund,
} from "$lib/server/manualRefundReconciliation";

const { mockLogStructured, mockPrivateEnv } = vi.hoisted(() => ({
	mockLogStructured: vi.fn(),
	mockPrivateEnv: { WEBHOOK_SECRET: "test-webhook-secret" },
}));

vi.mock("$convex/api", () => ({
	api: {
		orders: { reconcileSucceededManualRefund: "orders.reconcileSucceededManualRefund" },
		platform: {
			getByStripeConnectedAccountId: "platform.getByStripeConnectedAccountId",
			getCommerceProfileForSite: "platform.getCommerceProfileForSite",
		},
	},
}));
vi.mock("$env/dynamic/private", () => ({ env: mockPrivateEnv }));
vi.mock("$lib/server/logger", () => ({ logStructured: mockLogStructured }));
vi.mock("$lib/config/site", () => ({
	ADMIN_EMAIL: "admin@example.com",
	SITE_DOMAIN: "angelsrest.online",
}));

const IDS = {
	event: "evt_1234567890abcdef",
	refund: "re_1234567890abcdef",
	charge: "ch_1234567890abcdef",
	paymentIntent: "pi_1234567890abcdef",
	session: "cs_test_1234567890abcdef",
	account: "acct_1234567890abcdef",
};

function refund(overrides: Record<string, unknown> = {}) {
	return {
		id: IDS.refund,
		object: "refund",
		amount: 1500,
		charge: IDS.charge,
		currency: "usd",
		metadata: {},
		payment_intent: IDS.paymentIntent,
		status: "succeeded",
		...overrides,
	} as unknown as Stripe.Refund;
}

function event(
	type: "refund.created" | "refund.updated" = "refund.created",
	refundOverrides: Record<string, unknown> = {},
	eventOverrides: Record<string, unknown> = {},
) {
	return {
		id: IDS.event,
		object: "event",
		type,
		livemode: false,
		data: { object: refund(refundOverrides) },
		...eventOverrides,
	} as Stripe.RefundCreatedEvent | Stripe.RefundUpdatedEvent;
}

function session(overrides: Record<string, unknown> = {}) {
	return {
		id: IDS.session,
		object: "checkout.session",
		amount_total: 1500,
		currency: "usd",
		livemode: false,
		metadata: null,
		mode: "payment",
		payment_intent: IDS.paymentIntent,
		payment_status: "paid",
		status: "complete",
		...overrides,
	} as unknown as Stripe.Checkout.Session;
}

function sessionList(data = [session()], hasMore = false) {
	return { object: "list", url: "/v1/checkout/sessions", data, has_more: hasMore };
}

describe("manual refund reconciliation", () => {
	const list = vi.fn();
	const mutation = vi.fn();
	const query = vi.fn();
	const stripe = { checkout: { sessions: { list } } } as unknown as Stripe;
	const convex = { mutation, query } as unknown as ConvexHttpClient;

	beforeEach(() => {
		vi.clearAllMocks();
		list.mockResolvedValue(sessionList());
		mutation.mockResolvedValue({ kind: "reconciled" });
		query.mockResolvedValue(null);
	});

	it("reconciles a full succeeded platform refund from its only paid Session", async () => {
		await expect(reconcileSucceededManualRefund(event(), { stripe, convex })).resolves.toEqual({
			kind: "reconciled",
		});
		expect(list).toHaveBeenCalledWith({ payment_intent: IDS.paymentIntent, limit: 2 });
		expect(mutation).toHaveBeenCalledWith(
			"orders.reconcileSucceededManualRefund",
			expect.objectContaining({
				webhookSecret: "test-webhook-secret",
				stripeEventId: IDS.event,
				stripeRefundId: IDS.refund,
				stripeChargeId: IDS.charge,
				stripeSessionId: IDS.session,
				stripePaymentIntentId: IDS.paymentIntent,
				siteUrl: "angelsrest.online",
				refundAmount: 1500,
				sessionAmountTotal: 1500,
				refundCurrency: "usd",
				sessionCurrency: "usd",
				eventLivemode: false,
				sessionLivemode: false,
			}),
		);
	});

	it("advances pending creation through succeeded update, resend, and concurrent delivery", async () => {
		const pending = event(
			"refund.created",
			{ status: "pending" },
			{ id: "evt_pending1234567890", context: IDS.account },
		);
		await expect(
			reconcileSucceededManualRefund(pending, { stripe, convex }, "your-account"),
		).resolves.toEqual({
			kind: "ignored",
			reason: "not_succeeded",
		});
		expect(list).not.toHaveBeenCalled();
		expect(mutation).not.toHaveBeenCalled();

		mutation.mockReset().mockResolvedValueOnce({ kind: "reconciled" }).mockResolvedValue({
			kind: "replayed",
		});
		const succeeded = event(
			"refund.updated",
			{},
			{ id: "evt_succeeded12345678", context: IDS.account },
		);
		await expect(
			reconcileSucceededManualRefund(succeeded, { stripe, convex }, "your-account"),
		).resolves.toEqual({
			kind: "reconciled",
		});
		await expect(
			Promise.all([
				reconcileSucceededManualRefund(succeeded, { stripe, convex }, "your-account"),
				reconcileSucceededManualRefund(succeeded, { stripe, convex }, "your-account"),
			]),
		).resolves.toEqual([{ kind: "replayed" }, { kind: "replayed" }]);

		expect(list).toHaveBeenCalledTimes(3);
		expect(mutation).toHaveBeenCalledTimes(3);
		for (const [, args] of mutation.mock.calls) {
			expect(args).toEqual(
				expect.objectContaining({
					stripeEventId: "evt_succeeded12345678",
					stripeRefundId: IDS.refund,
				}),
			);
		}
	});

	it("uses a verified Your-account context only for the related platform Stripe read", async () => {
		await reconcileSucceededManualRefund(
			event("refund.updated", {}, { context: IDS.account }),
			{ stripe, convex },
			"your-account",
		);

		expect(list).toHaveBeenCalledWith(
			{ payment_intent: IDS.paymentIntent, limit: 2 },
			{ stripeContext: IDS.account },
		);
		const mutationArgs = mutation.mock.calls[0]?.[1];
		expect(mutationArgs).toEqual(
			expect.objectContaining({
				stripeEventId: IDS.event,
				stripeRefundId: IDS.refund,
				siteUrl: "angelsrest.online",
			}),
		);
		expect(mutationArgs).not.toHaveProperty("stripeConnectedAccountId");
		expect(mutationArgs).not.toHaveProperty("stripeTenantMetadataSiteUrl");
	});

	it.each([
		["missing verified role", undefined, { context: IDS.account }],
		["connected role without event.account", "connected-accounts", { context: IDS.account }],
		["Your-account role with event.account", "your-account", { account: IDS.account }],
		["malformed Your-account context", "your-account", { context: "ctx_invalid" }],
		[
			"non-string connected context",
			"connected-accounts",
			{ account: IDS.account, context: [IDS.account] },
		],
	] as const)("rejects %s before Stripe or Convex effects", async (_label, role, eventPatch) => {
		await expect(
			reconcileSucceededManualRefund(
				event("refund.updated", {}, eventPatch),
				{ stripe, convex },
				role,
			),
		).resolves.toEqual({ kind: "ignored", reason: "unsupported_scope" });
		expect(list).not.toHaveBeenCalled();
		expect(query).not.toHaveBeenCalled();
		expect(mutation).not.toHaveBeenCalled();
	});

	it("uses connected-account scope and makes the Session tenant marker an extra fence", async () => {
		list.mockResolvedValue(
			sessionList([session({ metadata: { commerceTenantSiteUrl: "tenant.example" } })]),
		);
		query.mockResolvedValue({
			siteUrl: "tenant.example",
			name: "Tenant",
			adminEmails: ["admin@tenant.example"],
		});
		await reconcileSucceededManualRefund(
			event("refund.updated", {}, { account: IDS.account }),
			{ stripe, convex },
			"connected-accounts",
		);
		expect(list).toHaveBeenCalledWith(
			{ payment_intent: IDS.paymentIntent, limit: 2 },
			{ stripeAccount: IDS.account },
		);
		expect(query).toHaveBeenCalledWith("platform.getByStripeConnectedAccountId", {
			stripeConnectedAccountId: IDS.account,
			webhookSecret: "test-webhook-secret",
		});
		expect(mutation).toHaveBeenCalledWith(
			"orders.reconcileSucceededManualRefund",
			expect.objectContaining({
				stripeConnectedAccountId: IDS.account,
				stripeTenantMetadataSiteUrl: "tenant.example",
				siteUrl: "tenant.example",
			}),
		);
	});

	it("accepts expanded Charge and PaymentIntent IDs", async () => {
		await reconcileSucceededManualRefund(
			event("refund.created", {
				charge: { id: IDS.charge },
				payment_intent: { id: IDS.paymentIntent },
			}),
			{ stripe, convex },
		);
		expect(mutation).toHaveBeenCalledOnce();
	});

	it.each([
		["platform", {}],
		["connected account", { account: IDS.account }],
	] as const)("preserves %s invoice refund handling as a no-write path", async (_label, scope) => {
		list.mockResolvedValue(
			sessionList([session({ metadata: { type: "invoice_payment", invoiceId: "invoice" } })]),
		);
		await expect(
			reconcileSucceededManualRefund(event("refund.created", {}, scope), { stripe, convex }),
		).resolves.toEqual({ kind: "ignored", reason: "invoice_payment" });
		expect(query).not.toHaveBeenCalled();
		expect(mutation).not.toHaveBeenCalled();
	});

	it("acknowledges permanent connected-account tenant conflicts", async () => {
		list.mockResolvedValue(
			sessionList([session({ metadata: { commerceTenantSiteUrl: "other.example" } })]),
		);
		query.mockResolvedValueOnce(null);
		await expect(
			reconcileSucceededManualRefund(event("refund.created", {}, { account: IDS.account }), {
				stripe,
				convex,
			}),
		).resolves.toEqual({ kind: "ignored", reason: "tenant_identity_conflict" });
		expect(mutation).not.toHaveBeenCalled();

		query.mockResolvedValueOnce({
			siteUrl: "tenant.example",
			name: "Tenant",
			adminEmails: ["admin@tenant.example"],
		});
		await expect(
			reconcileSucceededManualRefund(event("refund.created", {}, { account: IDS.account }), {
				stripe,
				convex,
			}),
		).resolves.toEqual({ kind: "ignored", reason: "tenant_identity_conflict" });
		expect(mutation).not.toHaveBeenCalled();
	});

	it.each([
		["bad event ID", {}, { id: "bad" }, "invalid_event_id"],
		["pending refund", { status: "pending" }, {}, "not_succeeded"],
		[
			"known automated refund",
			{ metadata: { automated: "fulfillment_recovery_v1" } },
			{},
			"automated",
		],
		["unknown automated refund", { metadata: { automated: "other" } }, {}, "automated"],
		["bad refund ID", { id: "bad" }, {}, "invalid_refund_id"],
		["zero amount", { amount: 0 }, {}, "invalid_amount"],
		["non-USD refund", { currency: "eur" }, {}, "unsupported_currency"],
		["missing charge", { charge: null }, {}, "invalid_charge_id"],
		["missing payment intent", { payment_intent: null }, {}, "invalid_payment_intent_id"],
		["bad account", {}, { account: "acct_bad" }, "invalid_connected_account"],
	] as const)("ignores %s before any Stripe read", async (_label, refundPatch, eventPatch, reason) => {
		await expect(
			reconcileSucceededManualRefund(event("refund.created", refundPatch, eventPatch), {
				stripe,
				convex,
			}),
		).resolves.toEqual({ kind: "ignored", reason });
		expect(list).not.toHaveBeenCalled();
		expect(mutation).not.toHaveBeenCalled();
	});

	it.each([
		["no Session", sessionList([]), "ambiguous_session"],
		["multiple Sessions", sessionList([session(), session()]), "ambiguous_session"],
		["paginated Sessions", sessionList([session()], true), "ambiguous_session"],
		["bad Session ID", sessionList([session({ id: "bad" })]), "invalid_session"],
		["incomplete Session", sessionList([session({ status: "open" })]), "session_mode_mismatch"],
		[
			"unpaid Session",
			sessionList([session({ payment_status: "unpaid" })]),
			"session_mode_mismatch",
		],
		[
			"wrong PaymentIntent",
			sessionList([session({ payment_intent: "pi_aaaaaaaaaaaaaaaa" })]),
			"session_payment_mismatch",
		],
		["partial refund", sessionList([session({ amount_total: 3000 })]), "session_amount_mismatch"],
		["wrong currency", sessionList([session({ currency: "eur" })]), "session_currency_mismatch"],
		["wrong mode", sessionList([session({ livemode: true })]), "session_mode_mismatch"],
		[
			"malformed tenant marker",
			sessionList([session({ metadata: { commerceTenantSiteUrl: "" } })]),
			"invalid_tenant_marker",
		],
	] as const)("does not project %s", async (_label, stripeResult, reason) => {
		list.mockResolvedValue(stripeResult);
		await expect(reconcileSucceededManualRefund(event(), { stripe, convex })).resolves.toEqual({
			kind: "ignored",
			reason,
		});
		expect(mutation).not.toHaveBeenCalled();
	});

	it("makes Stripe and Convex availability failures retryable", async () => {
		list.mockRejectedValueOnce(new Error("Stripe unavailable"));
		await expect(
			reconcileSucceededManualRefund(event(), { stripe, convex }),
		).rejects.toBeInstanceOf(ManualRefundReconciliationRetryableError);
		list.mockResolvedValueOnce(sessionList());
		mutation.mockRejectedValueOnce(new Error("Convex unavailable"));
		await expect(
			reconcileSucceededManualRefund(event(), { stripe, convex }),
		).rejects.toBeInstanceOf(ManualRefundReconciliationRetryableError);

		query.mockRejectedValueOnce(new Error("Convex query unavailable"));
		await expect(
			reconcileSucceededManualRefund(event("refund.created", {}, { account: IDS.account }), {
				stripe,
				convex,
			}),
		).rejects.toBeInstanceOf(ManualRefundReconciliationRetryableError);
	});

	it("acknowledges Convex identity and state conflicts without another effect", async () => {
		for (const reason of ["identity_conflict", "state_conflict"] as const) {
			mutation.mockResolvedValueOnce({ kind: "rejected", reason });
			await expect(reconcileSucceededManualRefund(event(), { stripe, convex })).resolves.toEqual({
				kind: "rejected",
				reason,
			});
		}
	});
});
