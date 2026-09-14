import type Stripe from "stripe";
import {
	isPrintSourceDescriptor,
	issueTenantPrintSource,
	type PaidFulfillmentResolution,
	type PrintSourceDescriptor,
	resolvePaidFulfillment,
} from "$lib/server/catalogCommerceClients";
import type { CheckoutSnapshotItem } from "$lib/server/checkoutCatalog";
import type { CheckoutSnapshotV1 } from "$lib/server/checkoutSnapshotConsumer";
import { FulfillmentValidationError } from "$lib/server/fulfillmentValidationError";
import type { OrderItem } from "$lib/shop/types";

function quantity(lineItems: Stripe.LineItem[], ordinal: number) {
	const value = lineItems[ordinal]?.quantity;
	if (!Number.isSafeInteger(value) || Number(value) <= 0)
		throw new FulfillmentValidationError("Paid line-item quantity is invalid");
	return Number(value);
}

function sameItem(left: CheckoutSnapshotItem, right: CheckoutSnapshotItem) {
	return (
		left.productKey === right.productKey &&
		left.revisionId === right.revisionId &&
		left.productKind === right.productKind &&
		left.variantKey === right.variantKey &&
		left.materialOptionKey === right.materialOptionKey &&
		left.sizeOptionKey === right.sizeOptionKey &&
		left.borderOptionKey === right.borderOptionKey &&
		left.frameOptionKey === right.frameOptionKey
	);
}

function orientSize(
	size: { width: number; height: number },
	source: PrintSourceDescriptor["dimensions"],
) {
	if (size.width === size.height || source.width === source.height) return size;
	return source.width > source.height === size.width > size.height
		? size
		: { width: size.height, height: size.width };
}

function validResolution(resolution: PaidFulfillmentResolution, item: CheckoutSnapshotItem) {
	const finish = resolution.commerce.finish;
	return (
		sameItem(resolution.item, item) &&
		resolution.identity.productKind === item.productKind &&
		finish !== null &&
		finish.materialKey === item.materialOptionKey &&
		finish.sizeKey === item.sizeOptionKey &&
		finish.borderKey === item.borderOptionKey &&
		finish.frameKey === item.frameOptionKey &&
		(resolution.descriptor.kind === "merchant" ||
			(resolution.descriptor.kind === "print_sources" &&
				resolution.descriptor.sources.length >= 1 &&
				resolution.descriptor.sources.length <= 20 &&
				resolution.descriptor.sources.every(isPrintSourceDescriptor)))
	);
}

/** Resolve one paid line without minting URLs or downloading its images. */
export async function resolveSnapshotPrintSources(
	snapshot: CheckoutSnapshotV1,
	stripeSessionId: string,
	ordinal: number,
	paidQuantity: number,
) {
	if (snapshot.catalogProvider !== "convex") {
		throw new FulfillmentValidationError("Checkout snapshot provider is unsupported");
	}
	const item = snapshot.items[ordinal];
	if (!item) throw new FulfillmentValidationError("Paid line-item ordinal is invalid");
	if (item.productKind !== "print" && item.productKind !== "print_set") return [];
	if (!Number.isSafeInteger(paidQuantity) || paidQuantity <= 0)
		throw new FulfillmentValidationError("Paid line-item quantity is invalid");
	const value = await resolvePaidFulfillment(stripeSessionId, ordinal);
	if (!validResolution(value, item))
		throw new FulfillmentValidationError("Paid fulfillment resolution does not match");
	if (value.descriptor.kind === "merchant") return [];
	if (value.descriptor.kind !== "print_sources" || !value.commerce.finish)
		throw new FulfillmentValidationError("Paid fulfillment descriptor is invalid");
	const finish = value.commerce.finish;
	return value.descriptor.sources.map((source) => {
		const size = orientSize(finish.size, source.dimensions);
		return {
			descriptor: {
				key: source.key,
				hash: source.hash,
				bytes: source.bytes,
				mime: source.mime,
				dimensions: source.dimensions,
			},
			item: {
				quantity: paidQuantity,
				paperSubcategoryId: finish.canvas?.subcategoryId ?? finish.paper.subcategoryId,
				width: size.width,
				height: size.height,
				borderWidth: finish.border.inches || undefined,
				frameSubcategoryId: finish.frame.subcategoryId || undefined,
				canvasSubcategoryId: finish.canvas?.subcategoryId,
				canvasWrapHex: finish.canvas?.wrapHex,
			} satisfies Omit<OrderItem, "imageUrl" | "sourcePolicy">,
		};
	});
}

export async function buildOrderItemsFromSnapshot(
	snapshot: CheckoutSnapshotV1,
	stripeSessionId: string,
	lineItems: Stripe.LineItem[],
	siteUrl?: string,
): Promise<OrderItem[]> {
	if (snapshot.catalogProvider !== "convex")
		throw new FulfillmentValidationError("Checkout snapshot provider is unsupported");
	const resolved: Awaited<ReturnType<typeof resolveSnapshotPrintSources>> = [];
	for (const [ordinal, item] of snapshot.items.entries()) {
		if (item.productKind !== "print" && item.productKind !== "print_set") continue;
		resolved.push(
			...(await resolveSnapshotPrintSources(
				snapshot,
				stripeSessionId,
				ordinal,
				quantity(lineItems, ordinal),
			)),
		);
	}
	const items: OrderItem[] = [];
	for (const { descriptor, item } of resolved)
		items.push({
			...item,
			imageUrl: await issueTenantPrintSource(descriptor, siteUrl),
			sourcePolicy: "opaque_capability",
		});
	return items;
}
