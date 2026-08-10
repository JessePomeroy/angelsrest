import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type Stripe from "stripe";
import { ApiErrorCode, apiError } from "$lib/server/apiError";
import { getCheckoutSnapshotReservationCredential } from "$lib/server/checkoutBridgeConfig";
import type { CheckoutSnapshotItem } from "$lib/server/checkoutCatalog";
import {
	type CheckoutAdmissionIdentity,
	type CheckoutSessionAdmissionClient,
	checkoutRequestFingerprint,
	createCheckoutSessionAdmissionClient,
} from "$lib/server/checkoutSessionAdmissionClient";
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
	attemptProofClass: CheckoutAdmissionIdentity["proofClass"];
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
	admissionClient?: CheckoutSessionAdmissionClient;
	hostGeneration: number;
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

export function issueSameOriginCheckoutAttempt(
	site: string,
	now = Date.now(),
	createAttempt = randomUUID,
	credential = getCheckoutSnapshotReservationCredential,
) {
	const attempt = createAttempt();
	return {
		attempt,
		attemptStartedAt: now,
		attemptProof: sameOriginAttemptProof(site, attempt, now, credential(site)),
	};
}

export function validateSameOriginCheckoutAttemptRequest(
	site: string,
	attempt: unknown,
	attemptStartedAt: unknown,
	attemptProof: unknown,
	now = Date.now(),
	createAttempt = randomUUID,
	credential = getCheckoutSnapshotReservationCredential,
) {
	if (attempt === undefined && attemptStartedAt === undefined && attemptProof === undefined) {
		throw apiError(
			428,
			ApiErrorCode.CHECKOUT_ATTEMPT_REQUIRED,
			"Checkout attempt required",
			issueSameOriginCheckoutAttempt(site, now, createAttempt, credential),
		);
	}
	try {
		const validated = validateCheckoutAttempt(attempt, attemptStartedAt, now);
		if (typeof attemptProof !== "string" || !/^[0-9a-f]{64}$/.test(attemptProof)) throw invalid();
		const expected = sameOriginAttemptProof(
			site,
			validated.attempt,
			Number(attemptStartedAt),
			credential(site),
		);
		if (!timingSafeEqual(Buffer.from(attemptProof, "hex"), Buffer.from(expected, "hex"))) {
			throw invalid();
		}
		return {
			attempt: validated.attempt,
			attemptStartedAt: Number(attemptStartedAt),
			proofClass: "same_origin_host_proof" as const,
		};
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
	attemptProofClass,
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
	admissionClient = createCheckoutSessionAdmissionClient(),
	hostGeneration,
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
	const identity = {
		attempt: validatedAttempt.attempt,
		attemptStartedAt: Number(attemptStartedAt),
		proofClass: attemptProofClass,
	};
	return await createAdmittedOrderCheckoutSession({
		identity,
		site,
		account,
		hostGeneration,
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
		checkoutSnapshotHandle: handle,
		admissionClient,
		bindSession,
	});
}

export async function createAdmittedOrderCheckoutSession({
	identity,
	site,
	account,
	hostGeneration,
	stripe,
	lineItems,
	successUrl,
	cancelUrl,
	metadata,
	shippingAllowedCountries,
	tenantCheckout,
	checkoutSnapshotHandle,
	admissionClient = createCheckoutSessionAdmissionClient(),
	bindSession,
}: {
	identity: CheckoutAdmissionIdentity;
	site: string;
	account: string | null;
	hostGeneration: number;
	stripe: Stripe;
	lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];
	successUrl: string;
	cancelUrl: string;
	metadata: Stripe.MetadataParam;
	shippingAllowedCountries?: NonNullable<
		Stripe.Checkout.SessionCreateParams["shipping_address_collection"]
	>["allowed_countries"];
	tenantCheckout: TenantStripeCheckoutOptions;
	checkoutSnapshotHandle?: string;
	admissionClient?: CheckoutSessionAdmissionClient;
	bindSession: (sessionId: string) => void;
}): Promise<PaymentCheckoutSessionResult & { expiresAt: number }> {
	const requestFingerprint = checkoutRequestFingerprint({
		version: 1,
		site,
		account,
		lineItems,
		successUrl,
		cancelUrl,
		shippingAllowedCountries: shippingAllowedCountries ?? null,
		tenantSession: tenantCheckout.session ?? null,
		tenantMetadata: tenantCheckout.metadata,
		metadata,
		checkoutSnapshotHandle: checkoutSnapshotHandle ?? null,
	});
	const permit = await admissionClient.begin({
		site,
		account,
		identity,
		hostGeneration,
		requestFingerprint,
	});
	let requestedStripeExpiresAt: number;
	try {
		requestedStripeExpiresAt = await admissionClient.markCreating(permit);
	} catch (cause) {
		await admissionClient.release(permit).catch(() => {});
		throw cause;
	}
	let session: PaymentCheckoutSessionResult;
	try {
		session = await createPaymentCheckoutSession({
			purpose: "order",
			stripe,
			lineItems,
			successUrl,
			cancelUrl,
			metadata: {
				...metadata,
				checkoutAdmissionVersion: "1",
				checkoutAdmissionHandleHash: permit.handleHash,
			},
			shippingAllowedCountries,
			tenantCheckout,
			idempotencyKey: permit.stripeIdempotencyKey,
			expiresAt: requestedStripeExpiresAt,
		});
	} catch (cause) {
		await admissionClient.markUncertain(permit).catch(() => {});
		throw cause;
	}
	await admissionClient.bind({
		permit,
		session: session.sessionId,
		stripeExpiresAt: requestedStripeExpiresAt,
		checkoutSnapshotHandle,
	});
	bindSession(session.sessionId);
	return { ...session, expiresAt: requestedStripeExpiresAt };
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

function sameOriginAttemptProof(site: string, attempt: string, startedAt: number, key: string) {
	return createHmac("sha256", key)
		.update(`checkout-order-attempt-v1\0${site}\0${attempt}\0${startedAt}`)
		.digest("hex");
}

function invalid() {
	return new Error("Invalid checkout attempt");
}
