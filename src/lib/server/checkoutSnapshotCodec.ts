import type Stripe from "stripe";

const providerValues = ["sanity", "convex"] as const;
const productKindValues = [
	"print",
	"print_set",
	"postcard",
	"tapestry",
	"digital_download",
	"merchandise",
] as const;
const providers = new Set<unknown>(providerValues);
const productKinds = new Set<unknown>(productKindValues);
const itemKey = (ordinal: number) => `checkoutSnapshotItem_${ordinal}`;

export type CheckoutSnapshotV1 = {
	schemaVersion: 1;
	catalogProvider: (typeof providerValues)[number];
	items: Array<{
		productKey: string;
		revisionId: string;
		productKind: (typeof productKindValues)[number];
		variantKey: string | null;
		materialOptionKey?: string | null;
		sizeOptionKey?: string | null;
		borderOptionKey?: string | null;
		frameOptionKey?: string | null;
	}>;
};
export class CheckoutSnapshotProtocolError extends Error {}
export function decodeCheckoutSnapshot(
	metadata: Stripe.Metadata | null,
	lineItems: readonly Stripe.LineItem[],
): CheckoutSnapshotV1 | undefined {
	const meta = metadata ?? {};
	if (!Object.hasOwn(meta, "checkoutSnapshotVersion")) return undefined;
	if (meta.checkoutSnapshotVersion !== "1") fail("unsupported version marker");
	if (!providers.has(meta.catalogProvider)) fail("catalogProvider");

	const rawCount = meta.checkoutSnapshotItemCount;
	const count = typeof rawCount === "string" ? Number(rawCount) : Number.NaN;
	if (!Number.isSafeInteger(count) || count < 1 || String(count) !== rawCount) fail("item count");
	if (count !== lineItems.length) fail("Stripe line item count mismatch");

	const allowedKeys = new Set([
		"checkoutSnapshotVersion",
		"checkoutSnapshotItemCount",
		...Array.from({ length: count }, (_, ordinal) => itemKey(ordinal)),
	]);
	if (
		Object.keys(meta).some((key) => key.startsWith("checkoutSnapshot") && !allowedKeys.has(key))
	) {
		fail("unexpected metadata field");
	}

	const items = Array.from({ length: count }, (_, ordinal) => {
		let tuple: unknown;
		try {
			tuple = JSON.parse(meta[itemKey(ordinal)] ?? "");
		} catch {
			fail(`item ${ordinal}`);
		}
		if (!Array.isArray(tuple) || tuple.length !== 9 || tuple[0] !== ordinal) {
			fail(`item ${ordinal} ordinal or field count`);
		}
		const [, productKey, revisionId, productKind, ...selection] = tuple;
		if (!nonempty(productKey) || !nonempty(revisionId) || !productKinds.has(productKind)) {
			fail(`item ${ordinal} identity`);
		}
		if (!selection.every(nullableKey)) fail(`item ${ordinal} selection`);
		const [variantKey, materialOptionKey, sizeOptionKey, borderOptionKey, frameOptionKey] =
			selection as Array<string | null>;
		return {
			productKey,
			revisionId,
			productKind,
			variantKey,
			materialOptionKey,
			sizeOptionKey,
			borderOptionKey,
			frameOptionKey,
		} as CheckoutSnapshotV1["items"][number];
	});

	return { schemaVersion: 1, catalogProvider: meta.catalogProvider, items } as CheckoutSnapshotV1;
}

export function assertCheckoutSnapshotV1(value: unknown): asserts value is CheckoutSnapshotV1 {
	if (value === undefined) return;
	if (
		!plainObject(value) ||
		value.schemaVersion !== 1 ||
		!providers.has(value.catalogProvider) ||
		!Array.isArray(value.items) ||
		!value.items.every(validStoredItem)
	) {
		fail("stored value");
	}
}

const validStoredItem = (value: unknown) =>
	plainObject(value) &&
	[value.productKey, value.revisionId].every(nonempty) &&
	productKinds.has(value.productKind) &&
	nullableKey(value.variantKey);

function nonempty(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}
const nullableKey = (value: unknown) => value === null || nonempty(value);
function plainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function fail(message: string): never {
	throw new CheckoutSnapshotProtocolError(`Invalid checkout snapshot: ${message}`);
}
