import type Stripe from "stripe";
import { client } from "$lib/sanity/client";
import {
	issuePrintSource,
	type PaidFulfillmentResolution,
	resolvePaidFulfillment,
} from "$lib/server/catalogCommerceClients";
import { type CheckoutSnapshotItem, resolveCheckoutItem } from "$lib/server/checkoutCatalog";
import type { CheckoutSnapshotV1 } from "$lib/server/checkoutSnapshotConsumer";
import { FulfillmentValidationError } from "$lib/server/fulfillmentValidationError";
import type { OrderItem } from "$lib/shop/types";

const exactSanity = client.withConfig({ useCdn: false, perspective: "published" });
const EXACT_PRODUCT_QUERY = `*[_id == $id && _rev == $rev][0]{
  _id, _rev, _type, "slug": slug.current, title, category, price, inStock,
  image, images, previewImage,
  variants[]{_key, enabled, paper, size, retailPrice},
  availablePapers[]{_key, name, price, subcategoryId, width, height},
  bordersEnabled, framedEnabled, frameMarkupMultiplier
}`;
type ExactProduct = Record<string, unknown> & {
	_id: string;
	_rev: string;
	_type: string;
	slug: string;
};

function quantity(lineItems: Stripe.LineItem[], ordinal: number) {
	const value = lineItems[ordinal]?.quantity;
	if (!Number.isSafeInteger(value) || Number(value) <= 0)
		throw new FulfillmentValidationError("Paid line-item quantity is invalid");
	return Number(value);
}
function sameItem(left: unknown, right: CheckoutSnapshotItem) {
	return JSON.stringify(left) === JSON.stringify(right);
}

async function sanityItems(item: CheckoutSnapshotItem, paidQuantity: number) {
	const product = await exactSanity.fetch<ExactProduct | null>(EXACT_PRODUCT_QUERY, {
		id: item.productKey,
		rev: item.revisionId,
	});
	if (!product || product._id !== item.productKey || product._rev !== item.revisionId) {
		throw new FulfillmentValidationError("Exact product revision is unavailable");
	}
	const expectedType =
		item.productKind === "print_set"
			? "lumaPrintSetV2"
			: item.productKind === "print"
				? ["lumaProductV2", "product"]
				: [];
	if (
		!(Array.isArray(expectedType)
			? expectedType.includes(product._type)
			: expectedType === product._type)
	) {
		throw new FulfillmentValidationError("Exact product kind does not match");
	}
	const fetcher = async <T>(query: string) => {
		const matches = query.includes("lumaPrintSetV2")
			? product._type === "lumaPrintSetV2"
			: query.includes("lumaProductV2")
				? product._type === "lumaProductV2"
				: product._type === "product";
		return (matches ? product : null) as T;
	};
	const resolved = await resolveCheckoutItem(
		fetcher,
		{
			productId: product.slug,
			isPrintSet: item.productKind === "print_set",
			paperSlug: item.materialOptionKey,
			sizeSlug: item.sizeOptionKey,
			borderWidth: item.borderOptionKey,
			frame: item.frameOptionKey,
		},
		true,
	).catch(() => {
		throw new FulfillmentValidationError("Exact product selection is invalid");
	});
	const paper = resolved.legacyFulfillment.paper;
	if (!resolved.snapshot || !sameItem(resolved.snapshot, item) || !paper) {
		throw new FulfillmentValidationError("Exact product selection does not match");
	}
	const candidates = resolved.legacyFulfillment.isPrintSet
		? resolved.legacyFulfillment.imageUrls
		: [resolved.legacyFulfillment.imageUrl];
	const sourceUrls = candidates.filter((url): url is string => Boolean(url));
	if (sourceUrls.length < 1 || sourceUrls.length !== candidates.length) {
		throw new FulfillmentValidationError("Exact product sources are unavailable");
	}
	return sourceUrls.map((imageUrl) => ({
		imageUrl,
		sourcePolicy: "sanity_cdn" as const,
		quantity: paidQuantity,
		paperSubcategoryId: paper.subcategoryId,
		width: paper.width,
		height: paper.height,
		borderWidth: paper.borderWidth,
		frameSubcategoryId: paper.frameSubcategoryId,
		canvasSubcategoryId: paper.canvasSubcategoryId,
		canvasWrapHex: paper.canvasWrapHex,
	}));
}

function validResolution(resolution: PaidFulfillmentResolution, item: CheckoutSnapshotItem) {
	const finish = resolution.commerce.finish;
	return (
		sameItem(resolution.item, item) &&
		resolution.identity.productKind === item.productKind &&
		finish !== null &&
		resolution.descriptor.kind === "print_sources" &&
		[finish.paper.subcategoryId, finish.size.width, finish.size.height].every(
			(value) => Number.isFinite(value) && value > 0,
		) &&
		Number.isFinite(finish.border.inches) &&
		finish.border.inches >= 0 &&
		Number.isFinite(finish.frame.subcategoryId) &&
		finish.frame.subcategoryId >= 0 &&
		(finish.canvas === null ||
			(Number.isFinite(finish.canvas.subcategoryId) && typeof finish.canvas.wrapHex === "string"))
	);
}

export async function buildOrderItemsFromSnapshot(
	snapshot: CheckoutSnapshotV1,
	stripeSessionId: string,
	lineItems: Stripe.LineItem[],
): Promise<OrderItem[]> {
	const printable = snapshot.items
		.map((item, ordinal) => ({ item, ordinal }))
		.filter(({ item }) => item.productKind === "print" || item.productKind === "print_set")
		.map(({ item, ordinal }) => ({ item, ordinal, paidQuantity: quantity(lineItems, ordinal) }));
	if (snapshot.catalogProvider === "sanity") {
		const items: OrderItem[] = [];
		for (const { item, paidQuantity } of printable)
			items.push(...(await sanityItems(item, paidQuantity)));
		return items;
	}
	const resolved: Array<{ value: PaidFulfillmentResolution; paidQuantity: number }> = [];
	for (const { item, ordinal, paidQuantity } of printable) {
		const value = await resolvePaidFulfillment(stripeSessionId, ordinal);
		if (!validResolution(value, item))
			throw new FulfillmentValidationError("Paid fulfillment resolution does not match");
		resolved.push({ value, paidQuantity });
	}
	const items: OrderItem[] = [];
	for (const { value, paidQuantity } of resolved) {
		if (value.descriptor.kind !== "print_sources" || !value.commerce.finish)
			throw new FulfillmentValidationError("Paid fulfillment descriptor is invalid");
		const finish = value.commerce.finish;
		for (const source of value.descriptor.sources) {
			items.push({
				imageUrl: await issuePrintSource(source),
				sourcePolicy: "opaque_capability",
				quantity: paidQuantity,
				paperSubcategoryId: finish.canvas?.subcategoryId ?? finish.paper.subcategoryId,
				width: finish.size.width,
				height: finish.size.height,
				borderWidth: finish.border.inches || undefined,
				frameSubcategoryId: finish.frame.subcategoryId || undefined,
				canvasSubcategoryId: finish.canvas?.subcategoryId,
				canvasWrapHex: finish.canvas?.wrapHex,
			});
		}
	}
	return items;
}
