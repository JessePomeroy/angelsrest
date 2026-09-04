import type Stripe from "stripe";
import {
	isPrintSourceDescriptor,
	issuePrintSource,
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

export async function buildOrderItemsFromSnapshot(
	snapshot: CheckoutSnapshotV1,
	stripeSessionId: string,
	lineItems: Stripe.LineItem[],
): Promise<OrderItem[]> {
	if (snapshot.catalogProvider !== "convex") {
		throw new FulfillmentValidationError("Checkout snapshot provider is unsupported");
	}
	const printable = snapshot.items
		.map((item, ordinal) => ({ item, ordinal }))
		.filter(({ item }) => item.productKind === "print" || item.productKind === "print_set")
		.map(({ item, ordinal }) => ({ item, ordinal, paidQuantity: quantity(lineItems, ordinal) }));
	const resolved: Array<{ value: PaidFulfillmentResolution; paidQuantity: number }> = [];
	for (const { item, ordinal, paidQuantity } of printable) {
		const value = await resolvePaidFulfillment(stripeSessionId, ordinal);
		if (!validResolution(value, item))
			throw new FulfillmentValidationError("Paid fulfillment resolution does not match");
		resolved.push({ value, paidQuantity });
	}
	const items: OrderItem[] = [];
	for (const { value, paidQuantity } of resolved) {
		if (value.descriptor.kind === "merchant") continue;
		if (value.descriptor.kind !== "print_sources" || !value.commerce.finish)
			throw new FulfillmentValidationError("Paid fulfillment descriptor is invalid");
		const finish = value.commerce.finish;
		for (const source of value.descriptor.sources) {
			if (!isPrintSourceDescriptor(source))
				throw new FulfillmentValidationError("Paid fulfillment print source is invalid");
			const size = orientSize(finish.size, source.dimensions);
			items.push({
				imageUrl: await issuePrintSource(source),
				sourcePolicy: "opaque_capability",
				quantity: paidQuantity,
				paperSubcategoryId: finish.canvas?.subcategoryId ?? finish.paper.subcategoryId,
				width: size.width,
				height: size.height,
				borderWidth: finish.border.inches || undefined,
				frameSubcategoryId: finish.frame.subcategoryId || undefined,
				canvasSubcategoryId: finish.canvas?.subcategoryId,
				canvasWrapHex: finish.canvas?.wrapHex,
			});
		}
	}
	return items;
}
