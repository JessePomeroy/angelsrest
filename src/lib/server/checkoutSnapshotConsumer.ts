import type Stripe from "stripe";
import { COMMERCE_TENANT_METADATA_KEY } from "$lib/server/stripeConnect";

const kindValues = [
	"print",
	"print_set",
	"postcard",
	"tapestry",
	"digital_download",
	"merchandise",
] as const;
const productKinds = new Set<unknown>(kindValues);
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const encoder = new TextEncoder();

type SnapshotItem = {
	productKey: string;
	revisionId: string;
	productKind: (typeof kindValues)[number];
	variantKey: string | null;
	materialOptionKey: string | null;
	sizeOptionKey: string | null;
	borderOptionKey: string | null;
	frameOptionKey: string | null;
};
export type CheckoutSnapshotV1 = {
	schemaVersion: 1;
	catalogProvider: "sanity" | "convex";
	items: SnapshotItem[];
};
export class CheckoutSnapshotProtocolError extends Error {}

function checkoutSnapshotMarkerKeys(metadata: Stripe.Metadata | null) {
	return Object.keys((metadata ?? {}) as Record<string, unknown>).filter((key) =>
		key.startsWith("checkoutSnapshot"),
	);
}

export function hasCheckoutSnapshotMarker(metadata: Stripe.Metadata | null) {
	return checkoutSnapshotMarkerKeys(metadata).length > 0;
}

export function readCheckoutTenantMarker(metadata: Stripe.Metadata | null) {
	const value = (metadata as Record<string, unknown> | null)?.[COMMERCE_TENANT_METADATA_KEY];
	return exactString(value, 253) ? value : undefined;
}

export function inspectCheckoutSnapshotMetadata(
	metadata: Stripe.Metadata | null,
	lineItemCount: number,
) {
	const meta = (metadata ?? {}) as Record<string, unknown>;
	const marked = checkoutSnapshotMarkerKeys(metadata);
	if (marked.length === 0) return { kind: "unmarked" } as const;

	if (meta.checkoutSnapshotVersion === "2") {
		const tenantSiteUrl = meta[COMMERCE_TENANT_METADATA_KEY];
		return marked.length === 2 &&
			marked.includes("checkoutSnapshotVersion") &&
			marked.includes("checkoutSnapshotHandle") &&
			uuidV4.test(String(meta.checkoutSnapshotHandle)) &&
			!Object.hasOwn(meta, "catalogProvider") &&
			exactString(tenantSiteUrl, 253)
			? ({ kind: "handle-v2", handle: String(meta.checkoutSnapshotHandle) } as const)
			: invalid();
	}
	if (
		meta.checkoutSnapshotVersion !== "1" ||
		!["sanity", "convex"].includes(meta.catalogProvider as string)
	) {
		return invalid();
	}
	const rawCount = meta.checkoutSnapshotItemCount;
	const count = typeof rawCount === "string" ? Number(rawCount) : Number.NaN;
	if (
		!Number.isSafeInteger(count) ||
		count < 1 ||
		count > 40 ||
		String(count) !== rawCount ||
		count !== lineItemCount
	)
		return invalid();
	const expected = new Set([
		"checkoutSnapshotVersion",
		"checkoutSnapshotItemCount",
		...Array.from({ length: count }, (_, ordinal) => `checkoutSnapshotItem_${ordinal}`),
	]);
	if (marked.length !== expected.size || marked.some((key) => !expected.has(key))) {
		return invalid();
	}

	const items: SnapshotItem[] = [];
	for (let ordinal = 0; ordinal < count; ordinal++) {
		let tuple: unknown;
		try {
			tuple = JSON.parse(String(meta[`checkoutSnapshotItem_${ordinal}`] ?? ""));
		} catch {
			return invalid();
		}
		if (!Array.isArray(tuple) || tuple.length !== 9 || tuple[0] !== ordinal) {
			return invalid();
		}
		const [, productKey, revisionId, productKind, ...selection] = tuple;
		if (
			!exactString(productKey) ||
			!exactString(revisionId) ||
			!productKinds.has(productKind) ||
			!selection.every(nullableKey)
		) {
			return invalid();
		}
		const [variantKey, materialOptionKey, sizeOptionKey, borderOptionKey, frameOptionKey] =
			selection as Array<string | null>;
		items.push({
			productKey,
			revisionId,
			productKind: productKind as SnapshotItem["productKind"],
			variantKey,
			materialOptionKey,
			sizeOptionKey,
			borderOptionKey,
			frameOptionKey,
		});
	}
	return {
		kind: "inline-v1" as const,
		snapshot: {
			schemaVersion: 1 as const,
			catalogProvider: meta.catalogProvider as CheckoutSnapshotV1["catalogProvider"],
			items,
		},
	};
}

export function selectCheckoutSnapshotInput(
	routingSource: "order" | "reservation" | null,
	protocol?: ReturnType<typeof inspectCheckoutSnapshotMetadata>,
) {
	if (routingSource === "order") return { protocol: "existing-order" } as const;
	if (!protocol || protocol.kind === "invalid-marked") {
		throw new CheckoutSnapshotProtocolError("Invalid checkout snapshot protocol");
	}
	if (routingSource === "reservation") {
		if (protocol.kind !== "handle-v2") {
			throw new CheckoutSnapshotProtocolError(
				"Bound checkout snapshot requires handle-v2 metadata",
			);
		}
		return { protocol: "handle-v2", reservation: { version: 2, handle: protocol.handle } } as const;
	}
	if (protocol.kind === "handle-v2") {
		throw new CheckoutSnapshotProtocolError("Checkout snapshot handle is unknown or expired");
	}
	return protocol.kind === "inline-v1"
		? { protocol: "inline-v1" as const, snapshot: protocol.snapshot }
		: { protocol: "legacy" as const };
}
export type CheckoutSnapshotInput = ReturnType<typeof selectCheckoutSnapshotInput>;

function exactString(value: unknown, maxBytes = 128): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value === value.trim() &&
		encoder.encode(value).byteLength <= maxBytes
	);
}
const nullableKey = (value: unknown) => value === null || exactString(value);
const invalid = () => ({ kind: "invalid-marked" as const });
