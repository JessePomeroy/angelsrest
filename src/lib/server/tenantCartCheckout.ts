import {
	CheckoutBridgeError,
	type TenantPrintCheckoutOptions,
	validateRedirectUrl,
	verifyCheckoutBridgeSignature,
} from "./checkoutBridge";
import type { CheckoutSnapshotItem } from "./checkoutCatalog";
import { assertNewOrderCheckoutOpen, NewOrderCheckoutClosedError } from "./commercePurposeControls";
import { createHandleCheckoutSession, validateCheckoutAttempt } from "./handleCheckout";
import { buildCheckoutLineItem } from "./stripeCheckoutSession";
import { buildTenantProductCheckoutOptions } from "./stripeConnect";

const KINDS = [
	"print",
	"print_set",
	"postcard",
	"tapestry",
	"digital_download",
	"merchandise",
] as const;
const SELECTION = [
	"productKey",
	"revisionId",
	"productKind",
	"variantKey",
	"materialOptionKey",
	"sizeOptionKey",
	"borderOptionKey",
	"frameOptionKey",
];
const invalid = (): never => {
	throw new CheckoutBridgeError(400, "Invalid basket checkout request");
};
function record(value: unknown, keys: string[]): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
	if (Object.keys(value).length !== keys.length || !keys.every((key) => Object.hasOwn(value, key)))
		return invalid();
	return value as Record<string, unknown>;
}
function text(value: unknown, max = 128) {
	if (typeof value !== "string" || !value || value !== value.trim() || value.length > max)
		return invalid();
	return value;
}
function integer(value: unknown, max: number) {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > max)
		return invalid();
	return value;
}
function selection(value: unknown): CheckoutSnapshotItem {
	const item = record(value, SELECTION);
	const kind = KINDS.find((kind) => kind === item.productKind);
	if (!kind) return invalid();
	const key = (value: unknown) => (value === null ? null : text(value));
	return {
		productKey: text(item.productKey),
		revisionId: text(item.revisionId),
		productKind: kind,
		variantKey: key(item.variantKey),
		materialOptionKey: key(item.materialOptionKey),
		sizeOptionKey: key(item.sizeOptionKey),
		borderOptionKey: key(item.borderOptionKey),
		frameOptionKey: key(item.frameOptionKey),
	};
}
export function parseTenantCart(bodyText: string, now = Date.now()) {
	if (Buffer.byteLength(bodyText) > 64 * 1024) return invalid();
	let value: unknown;
	try {
		value = JSON.parse(bodyText);
	} catch {
		return invalid();
	}
	const body = record(value, [
		"siteUrl",
		"attempt",
		"attemptStartedAt",
		"successUrl",
		"cancelUrl",
		"items",
	]);
	try {
		validateCheckoutAttempt(body.attempt, body.attemptStartedAt, now);
	} catch {
		throw new CheckoutBridgeError(409, "Checkout attempt rejected");
	}
	if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 40)
		return invalid();
	const items = body.items.map((raw) => {
		const line = record(raw, ["selection", "quantity", "unitAmountCents", "name", "imageUrl"]);
		const imageUrl = line.imageUrl === null ? undefined : text(line.imageUrl, 2048);
		if (imageUrl) {
			let url: URL;
			try {
				url = new URL(imageUrl);
			} catch {
				return invalid();
			}
			if (url.protocol !== "https:" || url.username || url.password) return invalid();
		}
		return {
			selection: selection(line.selection),
			quantity: integer(line.quantity, 20),
			unitAmountCents: integer(line.unitAmountCents, 99_999_999),
			name: text(line.name, 500),
			imageUrl,
		};
	});
	if (new Set(items.map((item) => JSON.stringify(item.selection))).size !== items.length)
		return invalid();
	const amount = items.reduce((sum, item) => sum + item.unitAmountCents * item.quantity, 0);
	if (!Number.isSafeInteger(amount) || amount > 99_999_999) return invalid();
	return {
		siteUrl: text(body.siteUrl, 253),
		attempt: body.attempt,
		attemptStartedAt: body.attemptStartedAt,
		successUrl: text(body.successUrl, 2048),
		cancelUrl: text(body.cancelUrl, 2048),
		items,
	};
}

export async function createTenantCartCheckoutSession(options: TenantPrintCheckoutOptions) {
	const { bodyText, headers, secrets, tenant, now = Date.now(), allowedRedirectOrigins } = options;
	verifyCheckoutBridgeSignature({ bodyText, headers, secrets, now });
	const control = assertNewOrderCheckoutOpen(tenant.siteUrl);
	if (control.tenantId !== undefined && control.tenantId !== tenant.tenantId)
		throw new NewOrderCheckoutClosedError();
	if (options.snapshotMode !== "handle-v2" || options.globalSnapshotMode !== "handle-v2")
		throw new CheckoutBridgeError(503, "Checkout protocol is unavailable");
	const body = parseTenantCart(bodyText, now);
	if (body.siteUrl !== tenant.siteUrl)
		throw new CheckoutBridgeError(400, "Tenant siteUrl mismatch");
	validateRedirectUrl(body.successUrl, "successUrl", allowedRedirectOrigins);
	validateRedirectUrl(body.cancelUrl, "cancelUrl", allowedRedirectOrigins);
	const account = tenant.stripeConnectedAccountId?.trim() || null;
	if (account && !/^acct_[A-Za-z0-9]{16,64}$/.test(account))
		throw new CheckoutBridgeError(503, "Checkout account is unavailable");
	const tenantCheckout = buildTenantProductCheckoutOptions({
		tenant,
		items: body.items.map((item) => ({
			productKind: item.selection.productKind,
			unitPriceCents: item.unitAmountCents,
			quantity: item.quantity,
		})),
	});
	const session = await createHandleCheckoutSession({
		attempt: body.attempt,
		attemptStartedAt: body.attemptStartedAt,
		attemptProofClass: "signed_bridge_body",
		site: tenant.siteUrl,
		account,
		catalogProvider: "convex",
		snapshotItems: body.items.map((item) => item.selection),
		stripe: options.stripe,
		lineItems: body.items.map((item) => buildCheckoutLineItem(item)),
		successUrl: body.successUrl,
		cancelUrl: body.cancelUrl,
		allowedRedirectOrigins,
		shippingAllowedCountries: ["US"],
		tenantCheckout,
		bindSession: () => {},
		hostGeneration: control.generation,
		reservationClient: options.reservationClient,
		admissionClient: options.admissionClient,
		verifyReadiness: options.verifyReadiness,
		abuseGate: options.abuseGate,
		now,
	});
	return {
		sessionId: session.sessionId,
		url: session.url,
		platformFeeAmount: tenantCheckout.platformFeeAmount,
	};
}
