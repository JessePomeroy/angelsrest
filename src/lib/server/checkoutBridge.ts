import { createHmac, timingSafeEqual } from "node:crypto";
import type Stripe from "stripe";
import type { CheckoutSnapshotItem } from "$lib/server/checkoutCatalog";
import type { CheckoutSessionAdmissionClient } from "$lib/server/checkoutSessionAdmissionClient";
import type { CheckoutSnapshotReservationClient } from "$lib/server/checkoutSnapshotReservationClient";
import { assertNewOrderCheckoutOpen } from "$lib/server/commercePurposeControls";
import {
	checkoutSnapshotMode,
	createHandleCheckoutSession,
	validateCheckoutAttempt,
} from "$lib/server/handleCheckout";
import { buildCheckoutLineItem } from "$lib/server/stripeCheckoutSession";
import {
	buildTenantCheckoutOptions,
	COMMERCE_TENANT_ID_METADATA_KEY,
	COMMERCE_TENANT_METADATA_KEY,
	type StripeTenantAccount,
} from "$lib/server/stripeConnect";

const SIGNATURE_HEADER = "x-checkout-bridge-signature";
const TIMESTAMP_HEADER = "x-checkout-bridge-timestamp";
const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;
const KIND = /^(?:print|print_set|postcard|tapestry|digital_download|merchandise)$/;
const ITEM_KEYS = [
	"productKey",
	"revisionId",
	"productKind",
	"variantKey",
	"materialOptionKey",
	"sizeOptionKey",
	"borderOptionKey",
	"frameOptionKey",
] as const;
const RESERVED_METADATA_KEYS = new Set([
	"catalogProvider",
	"checkoutFingerprint",
	COMMERCE_TENANT_ID_METADATA_KEY,
	COMMERCE_TENANT_METADATA_KEY,
	"invoiceId",
	"siteUrl",
	"type",
]);
const HANDLE_KEYS = [
	"siteUrl",
	"amountCents",
	"productName",
	"productDescription",
	"imageUrl",
	"metadata",
	"successUrl",
	"cancelUrl",
	"attempt",
	"attemptStartedAt",
	"checkoutSnapshot",
] as const;

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
	attempt?: string;
	attemptStartedAt?: number;
	checkoutSnapshot?: ReturnType<typeof parseSinglePrintSnapshot>;
}

export interface TenantPrintCheckoutOptions {
	bodyText: string;
	headers: Headers;
	stripe: Stripe;
	tenant: StripeTenantAccount;
	secrets: readonly string[];
	allowedRedirectOrigins: readonly string[];
	snapshotMode?: "handle-v2";
	globalSnapshotMode?: string;
	reservationClient?: CheckoutSnapshotReservationClient;
	admissionClient?: CheckoutSessionAdmissionClient;
	abuseGate?: () => void | Promise<void>;
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
	snapshotMode,
	globalSnapshotMode,
	reservationClient,
	admissionClient,
	abuseGate,
	now = Date.now(),
}: TenantPrintCheckoutOptions): Promise<TenantPrintCheckoutResult> {
	verifyCheckoutBridgeSignature({
		bodyText,
		headers,
		secrets,
		now,
	});
	const control = assertNewOrderCheckoutOpen(tenant.siteUrl);

	const mode =
		snapshotMode === "handle-v2" && checkoutSnapshotMode(globalSnapshotMode) === "handle-v2"
			? "handle-v2"
			: "legacy";
	const body =
		mode === "handle-v2"
			? parseHandleTenantPrintCheckoutRequest(bodyText, now)
			: parseTenantPrintCheckoutRequest(bodyText);
	if (body.siteUrl !== tenant.siteUrl) {
		throw new CheckoutBridgeError(400, "Tenant siteUrl mismatch");
	}
	const account = tenant.stripeConnectedAccountId?.trim() || null;
	if (mode === "handle-v2" && account && !/^acct_[A-Za-z0-9]{16,64}$/.test(account))
		throw new CheckoutBridgeError(500, "Invalid checkout tenant account");
	validateRedirectUrl(body.successUrl, "successUrl", allowedRedirectOrigins);
	validateRedirectUrl(body.cancelUrl, "cancelUrl", allowedRedirectOrigins);

	const tenantCheckout = buildTenantCheckoutOptions({
		tenant,
		kind: "print",
		subtotalCents: body.amountCents,
	});
	const lineItems = [
		buildCheckoutLineItem({
			name: body.productName,
			description: body.productDescription,
			imageUrl: body.imageUrl,
			unitAmountCents: body.amountCents,
		}),
	];
	if (mode !== "handle-v2" || !body.checkoutSnapshot) {
		throw new CheckoutBridgeError(503, "Checkout protocol is unavailable");
	}
	const session = await createHandleCheckoutSession({
		attempt: body.attempt,
		attemptStartedAt: body.attemptStartedAt,
		attemptProofClass: "signed_bridge_body",
		site: body.siteUrl,
		account,
		catalogProvider: body.checkoutSnapshot.catalogProvider,
		snapshotItems: body.checkoutSnapshot.items,
		stripe,
		lineItems,
		successUrl: body.successUrl,
		cancelUrl: body.cancelUrl,
		allowedRedirectOrigins,
		shippingAllowedCountries: ["US", "CA"],
		tenantCheckout,
		bindSession: () => {},
		reservationClient,
		admissionClient,
		hostGeneration: control.generation,
		abuseGate,
		now,
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

export function verifyCheckoutBridgeSignature({
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

function parseHandleTenantPrintCheckoutRequest(
	bodyText: string,
	now: number,
): TenantPrintCheckoutRequest {
	if (Buffer.byteLength(bodyText, "utf8") > 64 * 1024) {
		throw new CheckoutBridgeError(400, "Checkout request is too large");
	}
	let value: unknown;
	try {
		value = JSON.parse(bodyText);
	} catch {
		throw new CheckoutBridgeError(400, "Invalid JSON body");
	}
	if (!exactRecord(value, HANDLE_KEYS))
		throw new CheckoutBridgeError(400, "Invalid checkout request");
	try {
		validateCheckoutAttempt(value.attempt, value.attemptStartedAt, now);
	} catch {
		throw new CheckoutBridgeError(409, "Checkout attempt rejected");
	}
	const checkoutSnapshot = parseSinglePrintSnapshot(value.checkoutSnapshot);
	const body = parseTenantPrintCheckoutRequest(bodyText);
	if (
		body.amountCents > 99_999_999 ||
		!boundedString(body.productName, 500) ||
		!boundedString(body.productDescription, 500) ||
		!boundedString(body.imageUrl, 2_048)
	) {
		throw new CheckoutBridgeError(400, "Invalid checkout request");
	}
	return {
		...body,
		attempt: value.attempt as string,
		attemptStartedAt: value.attemptStartedAt as number,
		checkoutSnapshot,
	};
}

function parseSinglePrintSnapshot(value: unknown) {
	if (!exactRecord(value, ["schemaVersion", "catalogProvider", "items"])) invalidSnapshot();
	if (
		value.schemaVersion !== 1 ||
		value.catalogProvider !== "convex" ||
		!Array.isArray(value.items) ||
		value.items.length !== 1
	)
		invalidSnapshot();
	const item = value.items[0];
	if (!exactRecord(item, ITEM_KEYS) || !KIND.test(String(item.productKind))) invalidSnapshot();
	for (const key of ITEM_KEYS) {
		if (key === "productKind") continue;
		const field = item[key];
		const required = key === "productKey" || key === "revisionId";
		if (
			(required && !boundedString(field, 128)) ||
			(!required && field !== null && !boundedString(field, 128))
		)
			invalidSnapshot();
	}
	return {
		schemaVersion: 1 as const,
		catalogProvider: "convex" as const,
		items: [item as unknown as CheckoutSnapshotItem] as [CheckoutSnapshotItem],
	};
}

function invalidSnapshot(): never {
	throw new CheckoutBridgeError(400, "Invalid checkout snapshot");
}

function boundedString(value: unknown, max: number): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value === value.trim() &&
		Buffer.byteLength(value, "utf8") <= max
	);
}

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
	return (
		!!value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.keys(value).length === keys.length &&
		keys.every((key) => Object.hasOwn(value, key))
	);
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
		if (RESERVED_METADATA_KEYS.has(key) || key.startsWith("checkoutSnapshot")) {
			throw new CheckoutBridgeError(400, "Reserved checkout metadata is not allowed");
		}
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
