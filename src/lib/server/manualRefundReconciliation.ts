import type { ConvexHttpClient } from "convex/browser";
import type Stripe from "stripe";
import { api } from "$convex/api";
import { readCheckoutTenantMarker } from "$lib/server/checkoutSnapshotConsumer";
import { CommerceTenantIdentityError, resolveCommerceTenant } from "$lib/server/commerceTenant";
import { logStructured } from "$lib/server/logger";
import { COMMERCE_TENANT_METADATA_KEY } from "$lib/server/stripeConnect";
import type { CommerceWebhookRole } from "$lib/server/stripeWebhook";
import { getWebhookSecret } from "$lib/server/webhookSecret";

type ManualRefundEvent = Stripe.RefundCreatedEvent | Stripe.RefundUpdatedEvent;

type IgnoredReason =
	| "unsupported_scope"
	| "invalid_event_id"
	| "not_succeeded"
	| "automated"
	| "invalid_refund_id"
	| "invalid_amount"
	| "unsupported_currency"
	| "invalid_charge_id"
	| "invalid_payment_intent_id"
	| "invalid_connected_account"
	| "ambiguous_session"
	| "invalid_session"
	| "session_payment_mismatch"
	| "session_amount_mismatch"
	| "session_currency_mismatch"
	| "session_mode_mismatch"
	| "invoice_payment"
	| "invalid_tenant_marker"
	| "tenant_identity_conflict";

export class ManualRefundReconciliationRetryableError extends Error {}

export type ManualRefundReconciliationResult =
	| { kind: "ignored"; reason: IgnoredReason }
	| { kind: "pending_order" | "reconciled" | "replayed" }
	| { kind: "rejected"; reason: "identity_conflict" | "state_conflict" };

const ID_PATTERNS = {
	event: /^evt_[A-Za-z0-9]{8,120}$/,
	refund: /^re_[A-Za-z0-9]{8,120}$/,
	charge: /^ch_[A-Za-z0-9]{8,120}$/,
	paymentIntent: /^pi_[A-Za-z0-9]{8,120}$/,
	account: /^acct_[A-Za-z0-9]{16,64}$/,
	session: /^cs_(?:test|live)_[A-Za-z0-9]{16,120}$/,
} as const;

function ignore(reason: IgnoredReason): ManualRefundReconciliationResult {
	logStructured({
		event: "manual_refund.ignored",
		level: "warn",
		stage: "stripe_refund",
		meta: { reason },
	});
	return { kind: "ignored", reason };
}

function objectId(value: unknown) {
	if (typeof value === "string") return value;
	if (value && typeof value === "object" && "id" in value) {
		const id = value.id;
		return typeof id === "string" ? id : undefined;
	}
	return undefined;
}

function hasMetadataKey(metadata: Stripe.Metadata | null, key: string) {
	return metadata != null && Object.hasOwn(metadata, key);
}

export async function reconcileSucceededManualRefund(
	event: ManualRefundEvent,
	adapters: { stripe: Stripe; convex: ConvexHttpClient },
	verifiedDestinationRole?: CommerceWebhookRole,
): Promise<ManualRefundReconciliationResult> {
	const accountId = event.account;
	const stripeContext = event.context;
	if (stripeContext !== undefined && typeof stripeContext !== "string") {
		return ignore("unsupported_scope");
	}
	const roleScopeMismatch =
		(verifiedDestinationRole === "your-account" && accountId !== undefined) ||
		(verifiedDestinationRole === "connected-accounts" && accountId === undefined);
	const unsupportedContext =
		accountId === undefined &&
		stripeContext !== undefined &&
		(verifiedDestinationRole !== "your-account" || !ID_PATTERNS.account.test(stripeContext));
	if (roleScopeMismatch || unsupportedContext) return ignore("unsupported_scope");
	if (!ID_PATTERNS.event.test(event.id)) return ignore("invalid_event_id");

	const refund = event.data.object;
	if (refund.status !== "succeeded") return ignore("not_succeeded");
	if (hasMetadataKey(refund.metadata, "automated")) return ignore("automated");
	if (!ID_PATTERNS.refund.test(refund.id)) return ignore("invalid_refund_id");
	if (!Number.isSafeInteger(refund.amount) || refund.amount <= 0) {
		return ignore("invalid_amount");
	}
	if (refund.currency !== "usd") return ignore("unsupported_currency");

	const chargeId = objectId(refund.charge);
	if (!chargeId || !ID_PATTERNS.charge.test(chargeId)) return ignore("invalid_charge_id");
	const paymentIntentId = objectId(refund.payment_intent);
	if (!paymentIntentId || !ID_PATTERNS.paymentIntent.test(paymentIntentId)) {
		return ignore("invalid_payment_intent_id");
	}

	if (accountId !== undefined && !ID_PATTERNS.account.test(accountId)) {
		return ignore("invalid_connected_account");
	}

	let sessions: Stripe.ApiList<Stripe.Checkout.Session>;
	try {
		const params = { payment_intent: paymentIntentId, limit: 2 } as const;
		if (accountId) {
			sessions = await adapters.stripe.checkout.sessions.list(params, {
				stripeAccount: accountId,
			});
		} else if (stripeContext) {
			sessions = await adapters.stripe.checkout.sessions.list(params, { stripeContext });
		} else {
			sessions = await adapters.stripe.checkout.sessions.list(params);
		}
	} catch (cause) {
		throw new ManualRefundReconciliationRetryableError("Stripe Checkout Session lookup failed", {
			cause,
		});
	}
	if (sessions.has_more || sessions.data.length !== 1) return ignore("ambiguous_session");

	const session = sessions.data[0];
	if (!ID_PATTERNS.session.test(session.id)) return ignore("invalid_session");
	if (
		session.mode !== "payment" ||
		session.status !== "complete" ||
		session.payment_status !== "paid"
	) {
		return ignore("session_mode_mismatch");
	}
	if (objectId(session.payment_intent) !== paymentIntentId) {
		return ignore("session_payment_mismatch");
	}
	if (session.amount_total !== refund.amount) return ignore("session_amount_mismatch");
	if (session.currency !== refund.currency) return ignore("session_currency_mismatch");
	if (session.livemode !== event.livemode) return ignore("session_mode_mismatch");
	if (session.metadata?.type === "invoice_payment") return ignore("invoice_payment");

	const metadataValue = session.metadata?.[COMMERCE_TENANT_METADATA_KEY];
	const metadataSiteUrl = readCheckoutTenantMarker(session.metadata);
	if (metadataValue !== undefined && metadataSiteUrl === undefined) {
		return ignore("invalid_tenant_marker");
	}

	let tenant;
	try {
		tenant = await resolveCommerceTenant(event, adapters.convex, metadataSiteUrl);
	} catch (cause) {
		if (cause instanceof CommerceTenantIdentityError) {
			return ignore("tenant_identity_conflict");
		}
		throw new ManualRefundReconciliationRetryableError("Manual refund tenant resolution failed", {
			cause,
		});
	}

	let result;
	try {
		result = await adapters.convex.mutation(api.orders.reconcileSucceededManualRefund, {
			webhookSecret: getWebhookSecret(),
			stripeEventId: event.id,
			stripeRefundId: refund.id,
			stripeChargeId: chargeId,
			stripeSessionId: session.id,
			stripePaymentIntentId: paymentIntentId,
			...(accountId ? { stripeConnectedAccountId: accountId } : {}),
			...(metadataSiteUrl ? { stripeTenantMetadataSiteUrl: metadataSiteUrl } : {}),
			siteUrl: tenant.siteUrl,
			refundAmount: refund.amount,
			sessionAmountTotal: session.amount_total,
			refundCurrency: "usd",
			sessionCurrency: "usd",
			eventLivemode: event.livemode,
			sessionLivemode: session.livemode,
		});
	} catch (cause) {
		throw new ManualRefundReconciliationRetryableError("Manual refund projection failed", {
			cause,
		});
	}

	logStructured({
		event: `manual_refund.${result.kind}`,
		level: result.kind === "rejected" ? "warn" : "info",
		stage: "stripe_refund",
		meta: result.kind === "rejected" ? { reason: result.reason } : undefined,
	});
	return result;
}
