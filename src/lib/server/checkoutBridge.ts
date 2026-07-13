import { createHmac, timingSafeEqual } from "node:crypto";
import type Stripe from "stripe";
import {
	buildCheckoutLineItem,
	createPaymentCheckoutSession,
} from "$lib/server/stripeCheckoutSession";
import { buildTenantCheckoutOptions, type StripeTenantAccount } from "$lib/server/stripeConnect";

const SIGNATURE_HEADER = "x-checkout-bridge-signature";
const TIMESTAMP_HEADER = "x-checkout-bridge-timestamp";
const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

export class CheckoutBridgeError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = "CheckoutBridgeError";
		this.status = status;
	}
}

export interface TenantPrintCheckoutRequest {
	siteUrl: string;
	amountCents: number;
	productName: string;
	productDescription?: string;
	imageUrl?: string;
	metadata: Record<string, string>;
	successUrl: string;
	cancelUrl: string;
}

export interface TenantPrintCheckoutOptions {
	bodyText: string;
	headers: Headers;
	stripe: Stripe;
	tenant: StripeTenantAccount;
	secrets: readonly string[];
	allowedRedirectOrigins: readonly string[];
	now?: number;
}

export interface TenantPrintCheckoutResult {
	sessionId: string;
	url: string | null;
	platformFeeAmount: number;
}

export async function createTenantPrintCheckoutSession({
	bodyText,
	headers,
	stripe,
	tenant,
	secrets,
	allowedRedirectOrigins,
	now = Date.now(),
}: TenantPrintCheckoutOptions): Promise<TenantPrintCheckoutResult> {
	verifyCheckoutBridgeSignature({
		bodyText,
		headers,
		secrets,
		now,
	});

	const body = parseTenantPrintCheckoutRequest(bodyText);
	if (body.siteUrl !== tenant.siteUrl) {
		throw new CheckoutBridgeError(400, "Tenant siteUrl mismatch");
	}
	validateRedirectUrl(body.successUrl, "successUrl", allowedRedirectOrigins);
	validateRedirectUrl(body.cancelUrl, "cancelUrl", allowedRedirectOrigins);

	const tenantCheckout = buildTenantCheckoutOptions({
		tenant,
		kind: "print",
		subtotalCents: body.amountCents,
	});

	const session = await createPaymentCheckoutSession({
		stripe,
		shippingAllowedCountries: ["US", "CA"],
		lineItems: [
			buildCheckoutLineItem({
				name: body.productName,
				description: body.productDescription,
				imageUrl: body.imageUrl,
				unitAmountCents: body.amountCents,
			}),
		],
		successUrl: body.successUrl,
		cancelUrl: body.cancelUrl,
		metadata: body.metadata,
		tenantCheckout,
	});

	return {
		sessionId: session.sessionId,
		url: session.url,
		platformFeeAmount: tenantCheckout.platformFeeAmount,
	};
}

export function signCheckoutBridgeBody({
	bodyText,
	secret,
	timestamp,
}: {
	bodyText: string;
	secret: string;
	timestamp: number;
}): string {
	return createHmac("sha256", secret).update(`${timestamp}.${bodyText}`).digest("hex");
}

function verifyCheckoutBridgeSignature({
	bodyText,
	headers,
	secrets,
	now,
}: {
	bodyText: string;
	headers: Headers;
	secrets: readonly string[];
	now: number;
}) {
	const timestampRaw = headers.get(TIMESTAMP_HEADER);
	const signature = headers.get(SIGNATURE_HEADER);

	if (!timestampRaw || !signature) {
		throw new CheckoutBridgeError(401, "Missing checkout bridge signature");
	}

	const timestamp = Number(timestampRaw);
	if (!Number.isFinite(timestamp)) {
		throw new CheckoutBridgeError(401, "Invalid checkout bridge timestamp");
	}

	if (Math.abs(now - timestamp) > SIGNATURE_TOLERANCE_MS) {
		throw new CheckoutBridgeError(401, "Expired checkout bridge signature");
	}

	if (secrets.length === 0) {
		throw new CheckoutBridgeError(500, "Checkout bridge tenant secrets are not configured");
	}
	const expectedSignatures = secrets.map((secret) =>
		signCheckoutBridgeBody({ bodyText, secret, timestamp }),
	);
	const signatureMatches = expectedSignatures.reduce(
		(matched, expected) => safeEqualHex(signature, expected) || matched,
		false,
	);
	if (!signatureMatches) {
		throw new CheckoutBridgeError(401, "Invalid checkout bridge signature");
	}
}

function validateRedirectUrl(
	value: string,
	field: "successUrl" | "cancelUrl",
	allowedOrigins: readonly string[],
) {
	if (allowedOrigins.length === 0) {
		throw new CheckoutBridgeError(500, "Checkout redirect origins are not configured");
	}
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new CheckoutBridgeError(400, `Invalid ${field}`);
	}
	if (url.username || url.password || !allowedOrigins.includes(url.origin)) {
		throw new CheckoutBridgeError(400, `Disallowed ${field} origin`);
	}
}

function parseTenantPrintCheckoutRequest(bodyText: string): TenantPrintCheckoutRequest {
	let body: unknown;
	try {
		body = JSON.parse(bodyText);
	} catch {
		throw new CheckoutBridgeError(400, "Invalid JSON body");
	}

	if (!body || typeof body !== "object" || Array.isArray(body)) {
		throw new CheckoutBridgeError(400, "Invalid checkout request");
	}

	const record = body as Record<string, unknown>;
	const siteUrl = requireString(record.siteUrl, "siteUrl");
	const amountCents = requirePositiveInteger(record.amountCents, "amountCents");

	const productName = requireString(record.productName, "productName");
	const productDescription =
		typeof record.productDescription === "string" ? record.productDescription : undefined;
	const imageUrl = typeof record.imageUrl === "string" ? record.imageUrl : undefined;
	const successUrl = requireString(record.successUrl, "successUrl");
	const cancelUrl = requireString(record.cancelUrl, "cancelUrl");
	const metadata = parseMetadata(record.metadata);

	return {
		siteUrl,
		amountCents,
		productName,
		productDescription,
		imageUrl,
		metadata,
		successUrl,
		cancelUrl,
	};
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new CheckoutBridgeError(400, `Missing ${field}`);
	}
	return value;
}

function requirePositiveInteger(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		throw new CheckoutBridgeError(400, `Invalid ${field}`);
	}
	return value;
}

function parseMetadata(value: unknown): Record<string, string> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new CheckoutBridgeError(400, "Missing metadata");
	}
	const metadata: Record<string, string> = {};
	for (const [key, val] of Object.entries(value)) {
		if (typeof val !== "string") {
			throw new CheckoutBridgeError(400, `Invalid metadata value for ${key}`);
		}
		metadata[key] = val;
	}
	return metadata;
}

function safeEqualHex(actual: string, expected: string): boolean {
	const actualBuffer = Buffer.from(actual, "hex");
	const expectedBuffer = Buffer.from(expected, "hex");
	if (actualBuffer.length !== expectedBuffer.length) return false;
	return timingSafeEqual(actualBuffer, expectedBuffer);
}
