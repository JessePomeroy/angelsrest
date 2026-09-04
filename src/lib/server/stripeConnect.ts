import type Stripe from "stripe";

export const PLATFORM_PRINT_FEE_RATE = 0.05;
export const COMMERCE_TENANT_METADATA_KEY = "commerceTenantSiteUrl";
export const COMMERCE_TENANT_ID_METADATA_KEY = "commerceTenantId";
export const COMMERCE_TENANT_ID_PATTERN =
	/^tenant_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface StripeTenantAccount {
	tenantId?: string | null;
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
	metadata: Stripe.MetadataParam;
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
	const tenantSiteUrl = normalizeCommerceTenantSiteUrl(tenant.siteUrl);
	if (!tenantSiteUrl) throw new Error("Invalid commerce tenant siteUrl");
	const tenantId = tenant.tenantId?.trim();
	if (tenantId && !COMMERCE_TENANT_ID_PATTERN.test(tenantId)) {
		throw new Error("Invalid commerce tenantId");
	}
	const metadata = {
		[COMMERCE_TENANT_METADATA_KEY]: tenantSiteUrl,
		...(tenantId ? { [COMMERCE_TENANT_ID_METADATA_KEY]: tenantId } : {}),
	};
	const platformFeeAmount = connectedAccountId
		? calculatePlatformFeeAmount({ kind, subtotalCents })
		: 0;

	return {
		session: {
			payment_intent_data: {
				...(platformFeeAmount ? { application_fee_amount: platformFeeAmount } : {}),
				metadata,
			},
		},
		metadata,
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

export function normalizeCommerceTenantSiteUrl(value: string) {
	const trimmed = value.trim();
	if (!trimmed) return "";
	try {
		const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
		return url.hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		return trimmed
			.toLowerCase()
			.replace(/^www\./, "")
			.replace(/\/+$/, "");
	}
}
