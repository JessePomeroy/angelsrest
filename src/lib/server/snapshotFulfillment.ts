import type Stripe from "stripe";
import { client } from "$lib/sanity/client";
import {
	isPrintSourceDescriptor,
	issuePrintSource,
	type PaidFulfillmentResolution,
	type PrintSourceDescriptor,
	resolvePaidFulfillment,
} from "$lib/server/catalogCommerceClients";
import { type CheckoutSnapshotItem, resolveCheckoutItem } from "$lib/server/checkoutCatalog";
import type { CheckoutSnapshotV1 } from "$lib/server/checkoutSnapshotConsumer";
import { FulfillmentValidationError } from "$lib/server/fulfillmentValidationError";
import type { OrderItem } from "$lib/shop/types";

const exactSanity = client.withConfig({ useCdn: false, perspective: "published" });
const EXACT_PRODUCT_QUERY = `*[_id == $id && _rev == $rev][0]{
  _id, _rev, _type, "slug": slug.current, title, category, price, inStock,
  image{..., "sourceDimensions": asset->metadata.dimensions{width,height}},
  images[]{..., "sourceDimensions": asset->metadata.dimensions{width,height}},
  previewImage{..., "sourceDimensions": asset->metadata.dimensions{width,height}},
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
type SourceDimensions = PrintSourceDescriptor["dimensions"];
function object(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function sourceDimensions(value: unknown): SourceDimensions {
	if (!object(value))
		throw new FulfillmentValidationError("Print source dimensions are unavailable");
	const dimensions = value.sourceDimensions;
	if (
		!object(dimensions) ||
		Object.keys(dimensions).length !== 2 ||
		!("width" in dimensions) ||
		!("height" in dimensions) ||
		![dimensions.width, dimensions.height].every(
			(value) => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 100_000,
		)
	)
		throw new FulfillmentValidationError("Print source dimensions are invalid");
	return { width: Number(dimensions.width), height: Number(dimensions.height) };
}
function orientSize(
	size: { width: number; height: number },
	source: SourceDimensions,
): { width: number; height: number } {
	// Paper output uses no-bleed option 39, which owns aspect fitting, and the
	// current canvas contract defines no cutoff here. This boundary only aligns axes.
	if (size.width === size.height || source.width === source.height) return size;
	const sourceIsLandscape = source.width > source.height;
	const sizeIsLandscape = size.width > size.height;
	return sourceIsLandscape === sizeIsLandscape ? size : { width: size.height, height: size.width };
}
function exactSourceImages(product: ExactProduct) {
	if (product._type === "lumaPrintSetV2")
		return Array.isArray(product.images) ? product.images : [];
	if (product._type === "product")
		return [Array.isArray(product.images) ? product.images[0] : undefined];
	return [product.image];
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
	const sourceImages = exactSourceImages(product);
	if (sourceImages.length !== sourceUrls.length) {
		throw new FulfillmentValidationError("Exact product source dimensions are unavailable");
	}
	return sourceUrls.map((imageUrl, index) => {
		const size = orientSize(paper, sourceDimensions(sourceImages[index]));
		return {
			imageUrl,
			sourcePolicy: "sanity_cdn" as const,
			quantity: paidQuantity,
			paperSubcategoryId: paper.subcategoryId,
			width: size.width,
			height: size.height,
			borderWidth: paper.borderWidth,
			frameSubcategoryId: paper.frameSubcategoryId,
			canvasSubcategoryId: paper.canvasSubcategoryId,
			canvasWrapHex: paper.canvasWrapHex,
		};
	});
}

function validResolution(resolution: PaidFulfillmentResolution, item: CheckoutSnapshotItem) {
	const finish = resolution.commerce.finish;
	return (
		sameItem(resolution.item, item) &&
		resolution.identity.productKind === item.productKind &&
		finish !== null &&
		resolution.descriptor.kind === "print_sources" &&
		resolution.descriptor.sources.length >= 1 &&
		resolution.descriptor.sources.length <= 20 &&
		resolution.descriptor.sources.every(isPrintSourceDescriptor) &&
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
	const planned: Array<{
		source: PrintSourceDescriptor;
		item: Omit<OrderItem, "imageUrl" | "sourcePolicy">;
	}> = [];
	for (const { value, paidQuantity } of resolved) {
		if (value.descriptor.kind !== "print_sources" || !value.commerce.finish)
			throw new FulfillmentValidationError("Paid fulfillment descriptor is invalid");
		const finish = value.commerce.finish;
		for (const source of value.descriptor.sources) {
			if (!isPrintSourceDescriptor(source))
				throw new FulfillmentValidationError("Paid fulfillment print source is invalid");
			const size = orientSize(finish.size, source.dimensions);
			planned.push({
				source,
				item: {
					quantity: paidQuantity,
					paperSubcategoryId: finish.canvas?.subcategoryId ?? finish.paper.subcategoryId,
					width: size.width,
					height: size.height,
					borderWidth: finish.border.inches || undefined,
					frameSubcategoryId: finish.frame.subcategoryId || undefined,
					canvasSubcategoryId: finish.canvas?.subcategoryId,
					canvasWrapHex: finish.canvas?.wrapHex,
				},
			});
		}
	}
	for (const { source, item } of planned) {
		items.push({
			...item,
			imageUrl: await issuePrintSource(source),
			sourcePolicy: "opaque_capability",
		});
	}
	return items;
}
