import { createHash, randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { ApiErrorCode, apiError } from "$lib/server/apiError";
import type { CheckoutSnapshotItem } from "$lib/server/checkoutCatalog";
import type { CheckoutSnapshotReservationClient } from "$lib/server/checkoutSnapshotReservationClient";
import { createCheckoutSnapshotReservationClient } from "$lib/server/checkoutSnapshotReservationClient";
import { assertOrderProducersOpen } from "$lib/server/orderProducerGate";
import {
	createPaymentCheckoutSession,
	type PaymentCheckoutSessionResult,
} from "$lib/server/stripeCheckoutSession";
import {
	COMMERCE_TENANT_METADATA_KEY,
	type TenantStripeCheckoutOptions,
} from "$lib/server/stripeConnect";

export const HANDLE_CHECKOUT_MODE = "handle-v2";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ACCOUNT_ID = /^acct_[A-Za-z0-9]{16,64}$/;
const SESSION_LIFETIME_SECONDS = 23 * 60 * 60 + 55 * 60;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface CreateHandleCheckoutOptions {
	attempt: unknown;
	attemptStartedAt: unknown;
	site: string;
	account: string | null;
	catalogProvider: "sanity" | "convex";
	snapshotItems: readonly CheckoutSnapshotItem[];
	stripe: Stripe;
	lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];
	successUrl: string;
	cancelUrl: string;
	allowedRedirectOrigins?: readonly string[];
	shippingAllowedCountries?: NonNullable<
		Stripe.Checkout.SessionCreateParams["shipping_address_collection"]
	>["allowed_countries"];
	tenantCheckout: TenantStripeCheckoutOptions;
	bindSession: (sessionId: string) => void;
	reservationClient?: CheckoutSnapshotReservationClient;
	abuseGate?: () => void | Promise<void>;
	now?: number;
}

export function checkoutSnapshotMode(value: string | undefined) {
	return value === HANDLE_CHECKOUT_MODE ? HANDLE_CHECKOUT_MODE : "legacy";
}

export function validateCheckoutAttemptRequest(
	attempt: unknown,
	attemptStartedAt: unknown,
	now = Date.now(),
	createAttempt = randomUUID,
) {
	if (attempt === undefined && attemptStartedAt === undefined) {
		throw apiError(428, ApiErrorCode.CHECKOUT_ATTEMPT_REQUIRED, "Checkout attempt required", {
			attempt: createAttempt(),
			attemptStartedAt: now,
		});
	}
	try {
		return validateCheckoutAttempt(attempt, attemptStartedAt, now);
	} catch {
		throw apiError(409, ApiErrorCode.CHECKOUT_ATTEMPT_REJECTED, "Checkout attempt rejected");
	}
}

export function validateCheckoutAttempt(
	attempt: unknown,
	attemptStartedAt: unknown,
	now = Date.now(),
) {
	if (typeof attempt !== "string" || !UUID_V4.test(attempt)) throw invalid();
	const startedAt = typeof attemptStartedAt === "number" ? attemptStartedAt : Number.NaN;
	if (!Number.isSafeInteger(startedAt) || startedAt > now + CLOCK_SKEW_MS) throw invalid();
	const expiresAt = Math.floor(startedAt / 1000) + SESSION_LIFETIME_SECONDS;
	const nowSeconds = Math.floor(now / 1000);
	if (expiresAt < nowSeconds + 30 * 60 - 5 * 60 || expiresAt > nowSeconds + 24 * 60 * 60 + 5 * 60) {
		throw invalid();
	}
	return { attempt, expiresAt };
}

export async function createHandleCheckoutSession({
	attempt,
	attemptStartedAt,
	site,
	account,
	catalogProvider,
	snapshotItems,
	stripe,
	lineItems,
	successUrl,
	cancelUrl,
	allowedRedirectOrigins,
	shippingAllowedCountries,
	tenantCheckout,
	bindSession,
	reservationClient = createCheckoutSnapshotReservationClient(),
	abuseGate = () => {},
	now = Date.now(),
}: CreateHandleCheckoutOptions): Promise<PaymentCheckoutSessionResult & { expiresAt: number }> {
	assertOrderProducersOpen();
	const validatedAttempt = validateCheckoutAttempt(attempt, attemptStartedAt, now);
	if (!site || site !== site.trim() || site.length > 253 || site.includes("/")) throw invalid();
	if (account !== null && !ACCOUNT_ID.test(account)) throw invalid();
	if (
		(catalogProvider !== "sanity" && catalogProvider !== "convex") ||
		snapshotItems.length < 1 ||
		snapshotItems.length > 40 ||
		lineItems.length !== snapshotItems.length
	)
		throw invalid();
	const { expiresAt } = validatedAttempt;
	validateRedirect(successUrl, site, allowedRedirectOrigins);
	validateRedirect(cancelUrl, site, allowedRedirectOrigins);
	if (
		Object.keys(tenantCheckout.metadata).length !== 1 ||
		tenantCheckout.metadata[COMMERCE_TENANT_METADATA_KEY] !== site
	)
		throw invalid();
	await abuseGate();

	const { handle } = await reservationClient.reserve({
		site,
		attempt: validatedAttempt.attempt,
		account,
		catalogProvider,
		items: snapshotItems,
	});
	const session = await createPaymentCheckoutSession({
		purpose: "order",
		stripe,
		lineItems,
		successUrl,
		cancelUrl,
		metadata: {
			checkoutSnapshotVersion: "2",
			checkoutSnapshotHandle: handle,
		},
		shippingAllowedCountries,
		tenantCheckout,
		idempotencyKey: idempotencyKey(site, account, handle),
		expiresAt,
	});
	await reservationClient.bind({
		site,
		handle,
		account,
		session: session.sessionId,
		stripeExpiresAt: expiresAt,
	});
	bindSession(session.sessionId);
	return { ...session, expiresAt };
}

function validateRedirect(
	value: string,
	site: string,
	allowedOrigins: readonly string[] | undefined,
) {
	try {
		const url = new URL(value);
		if (url.username || url.password) throw invalid();
		if (allowedOrigins) {
			if (allowedOrigins.length === 0 || !allowedOrigins.includes(url.origin)) throw invalid();
		} else if (
			url.protocol !== "https:" ||
			url.hostname.toLowerCase().replace(/^www\./, "") !== site
		) {
			throw invalid();
		}
	} catch {
		throw invalid();
	}
}

function idempotencyKey(site: string, account: string | null, handle: string) {
	const digest = createHash("sha256")
		.update(`checkout-handle-v2\0${site}\0${account ?? "platform"}\0${handle}`)
		.digest("hex");
	return `checkout-handle-v2:${digest}`;
}

function invalid() {
	return new Error("Invalid checkout attempt");
}
