import type Stripe from "stripe";

export const PLATFORM_PRINT_FEE_RATE = 0.05;

export interface StripeTenantAccount {
	siteUrl: string;
	name?: string;
	stripeConnectedAccountId?: string | null;
}

export type CheckoutKind = "print" | "service";

export interface TenantCheckoutOptions {
	tenant: StripeTenantAccount;
	kind: CheckoutKind;
	subtotalCents: number;
}

export interface TenantStripeCheckoutOptions {
	session: Pick<Stripe.Checkout.SessionCreateParams, "payment_intent_data">;
	requestOptions?: Stripe.RequestOptions;
	platformFeeAmount: number;
}

export interface TenantRefundOptions {
	params: Pick<Stripe.RefundCreateParams, "refund_application_fee">;
	requestOptions?: Stripe.RequestOptions;
}

export function calculatePlatformFeeAmount({
	kind,
	subtotalCents,
}: {
	kind: CheckoutKind;
	subtotalCents: number;
}): number {
	if (kind !== "print" || subtotalCents <= 0) return 0;
	return Math.floor(subtotalCents * PLATFORM_PRINT_FEE_RATE);
}

export function buildTenantCheckoutOptions({
	tenant,
	kind,
	subtotalCents,
}: TenantCheckoutOptions): TenantStripeCheckoutOptions {
	const connectedAccountId = normalizeConnectedAccountId(tenant.stripeConnectedAccountId);
	const platformFeeAmount = connectedAccountId
		? calculatePlatformFeeAmount({ kind, subtotalCents })
		: 0;

	return {
		session: platformFeeAmount
			? { payment_intent_data: { application_fee_amount: platformFeeAmount } }
			: {},
		requestOptions: connectedAccountId ? { stripeAccount: connectedAccountId } : undefined,
		platformFeeAmount,
	};
}

export function buildTenantRefundOptions(tenant: StripeTenantAccount): TenantRefundOptions {
	const connectedAccountId = normalizeConnectedAccountId(tenant.stripeConnectedAccountId);
	return {
		params: connectedAccountId ? { refund_application_fee: true } : {},
		requestOptions: connectedAccountId ? { stripeAccount: connectedAccountId } : undefined,
	};
}

function normalizeConnectedAccountId(value: string | null | undefined) {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}
