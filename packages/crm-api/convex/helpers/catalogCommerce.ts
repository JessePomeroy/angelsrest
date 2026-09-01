import {
	FRAMED_BORDER_INCHES,
	getBorder,
	getFrame,
	getFrameWholesaleCost,
	getPaper,
	getSize,
	getWholesaleCost,
	isCanvasPaper,
	parseCanvasSlug,
} from "@jessepomeroy/print-catalog";
import { type Infer, v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import {
	loadCatalogProductGraphV2Revision,
	loadPaidHistoricalCatalogProductGraphV2Revision,
	projectCatalogProductGraphV2Public,
	requireCatalogProductGraphV2Product,
} from "./catalogProductGraphData";
import { loadCatalogProductKinds } from "./catalogProductPolicy";
import {
	isStripeCheckoutSessionId,
	parseReservedCheckoutSnapshot,
} from "./checkoutSnapshot";

const itemValidator = v.object({
	productKey: v.string(),
	revisionId: v.string(),
	productKind: v.union(
		v.literal("print"), v.literal("print_set"), v.literal("postcard"),
		v.literal("tapestry"), v.literal("digital_download"), v.literal("merchandise"),
	),
	variantKey: v.union(v.string(), v.null()),
	materialOptionKey: v.union(v.string(), v.null()),
	sizeOptionKey: v.union(v.string(), v.null()),
	borderOptionKey: v.union(v.string(), v.null()),
	frameOptionKey: v.union(v.string(), v.null()),
});

export const catalogCommerceRequestValidator = v.union(
	v.object({ version: v.literal(1), purpose: v.literal("checkout"), item: itemValidator }),
	v.object({
		version: v.literal(1), purpose: v.literal("paid_fulfillment"),
		stripeSessionId: v.string(), itemIndex: v.number(),
	}),
	v.object({
		version: v.literal(1), purpose: v.literal("paid_download"),
		stripeSessionId: v.string(), itemIndex: v.number(),
	}),
);
export type CatalogCommerceRequest = Infer<typeof catalogCommerceRequestValidator>;
export type CatalogCommercePurpose = CatalogCommerceRequest["purpose"];

const resolutionError = (kind: "rejected" | "refunded") =>
	new Error(`Catalog commerce resolution ${kind}`);
const rejected = () => resolutionError("rejected");
export function catalogCommerceResolutionErrorKind(error: unknown) {
	const message = String(error);
	return message.includes("Catalog commerce resolution refunded")
		? ("refunded" as const)
		: message.includes("Catalog commerce resolution rejected")
			? ("rejected" as const)
			: null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
	const actual = Object.keys(value);
	return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

/** Parse an exact HTTP body and add the purpose selected by its authenticated route. */
export function parseCatalogCommerceRequest(
	value: unknown,
	purpose: CatalogCommercePurpose,
): CatalogCommerceRequest | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const body = value as Record<string, unknown>;
	if (body.version !== 1) return null;
	if (purpose === "checkout" && exactKeys(body, ["version", "item"])) {
		const snapshot = parseReservedCheckoutSnapshot({
			schemaVersion: 1, catalogProvider: "convex", items: [body.item],
		});
		return snapshot ? { version: 1, purpose, item: snapshot.items[0]! } : null;
	}
	if (
		purpose !== "checkout"
		&& exactKeys(body, ["version", "stripeSessionId", "itemIndex"])
		&& isStripeCheckoutSessionId(body.stripeSessionId)
		&& Number.isSafeInteger(body.itemIndex)
		&& Number(body.itemIndex) >= 0
		&& Number(body.itemIndex) < 40
	) {
		return {
			version: 1,
			purpose,
			stripeSessionId: body.stripeSessionId,
			itemIndex: Number(body.itemIndex),
		};
	}
	return null;
}

type SnapshotItem = Extract<CatalogCommerceRequest, { purpose: "checkout" }>["item"];
type LoadedGraph = NonNullable<Awaited<ReturnType<typeof loadCatalogProductGraphV2Revision>>>;

function requireProductAndRevisionIds(ctx: QueryCtx, item: SnapshotItem) {
	const productId = ctx.db.normalizeId("catalogProducts", item.productKey);
	const revisionId = ctx.db.normalizeId("catalogProductRevisions", item.revisionId);
	if (!productId || !revisionId) throw rejected();
	return { productId, revisionId };
}

function selectedVariant(graph: LoadedGraph, item: SnapshotItem) {
	const variant = graph.variants.find(({ variantKey }) => variantKey === item.variantKey);
	if (
		!variant
		|| variant.status !== "enabled"
		|| !Number.isSafeInteger(variant.retailPriceCents)
		|| variant.retailPriceCents === undefined
		|| (variant.materialOptionKey ?? null) !== item.materialOptionKey
		|| (variant.sizeOptionKey ?? null) !== item.sizeOptionKey
	) throw rejected();
	return variant as typeof variant & { retailPriceCents: number };
}

function catalogMoneyCents(value: number) {
	const match = String(value).match(/^(\d+)(?:\.(\d{1,2}))?$/);
	if (!match) throw rejected();
	const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
	if (!Number.isSafeInteger(cents)) throw rejected();
	return cents;
}

function resolvePrintCommerce(graph: LoadedGraph, item: SnapshotItem, retailPriceCents: number) {
	if (graph.draft.productKind !== "print" && graph.draft.productKind !== "print_set") {
		if (item.materialOptionKey !== null || item.sizeOptionKey !== null
			|| item.borderOptionKey !== null || item.frameOptionKey !== null) {
			throw rejected();
		}
		return { amountCents: retailPriceCents, finish: null };
	}
	const materialKey = item.materialOptionKey;
	const sizeKey = item.sizeOptionKey;
	const borderKey = item.borderOptionKey ?? "none";
	const frameKey = item.frameOptionKey ?? "none";
	const paper = materialKey ? getPaper(materialKey) : undefined;
	const size = sizeKey ? getSize(sizeKey) : undefined;
	const border = getBorder(borderKey);
	const frame = getFrame(frameKey);
	if (!paper || !size || !border || !frame || getWholesaleCost(paper.slug, size.slug) === null) {
		throw rejected();
	}
	const canvas = isCanvasPaper(paper.slug) ? parseCanvasSlug(paper.slug) : null;
	if (
		(canvas && (border.inches !== 0 || frame.subcategoryId !== 0))
		|| (!graph.draft.printOptions.borderOptionsEnabled && border.inches !== 0)
		|| (!graph.draft.printOptions.frameOptionsEnabled && frame.subcategoryId !== 0)
		|| (frame.subcategoryId !== 0 && border.inches !== FRAMED_BORDER_INCHES)
	) throw rejected();
	let frameSurchargeCents = 0;
	if (frame.subcategoryId !== 0) {
		const frameCost = getFrameWholesaleCost(frame.value, size.slug);
		if (frameCost === null) throw rejected();
		const numerator = BigInt(catalogMoneyCents(frameCost))
			* BigInt(graph.draft.printOptions.framePriceMultiplierBasisPoints);
		frameSurchargeCents = Number((numerator + 5_000n) / 10_000n);
	}
	const amountCents = retailPriceCents + frameSurchargeCents;
	if (!Number.isSafeInteger(amountCents)) throw rejected();
	return {
		amountCents,
		finish: {
			materialKey: item.materialOptionKey,
			sizeKey: item.sizeOptionKey,
			borderKey: item.borderOptionKey,
			frameKey: item.frameOptionKey,
			paper: { name: paper.name, subcategoryId: canvas?.subcategoryId ?? paper.subcategoryId },
			size: { label: size.label, width: size.width, height: size.height },
			border: { inches: border.inches },
			frame: { subcategoryId: frame.subcategoryId },
			canvas,
		},
	};
}

function privateDescriptor(graph: LoadedGraph) {
	if (graph.draft.productKind === "print" || graph.draft.productKind === "print_set") {
		const members = graph.draft.productKind === "print_set"
			? new Map(graph.setMembers.map((member) => [member.printSourceKey, member.memberKey]))
			: new Map<string, string>();
		return {
			kind: "print_sources" as const,
			sources: graph.printSourceAssets.map(({ relationKey, asset }) => ({
				memberKey: members.get(relationKey) ?? null,
				relationKey,
				key: asset.privateObjectKey,
				mime: asset.mimeType,
				bytes: asset.sizeBytes,
				hash: asset.sha256,
				dimensions: { width: asset.widthPixels, height: asset.heightPixels },
			})),
		};
	}
	if (graph.draft.productKind === "digital_download") {
		const file = graph.paidFileAsset;
		if (!file) throw rejected();
		return {
			kind: "paid_zip" as const,
			relationKey: file.relationKey,
			key: file.asset.privateObjectKey,
			mime: file.asset.mimeType,
			bytes: file.asset.sizeBytes,
			hash: file.asset.sha256,
			filename: file.asset.originalFilename,
			version: file.asset.version ?? null,
		};
	}
	return { kind: "merchant" as const, source: null };
}

function fulfillmentMedia(graph: LoadedGraph) {
	const media = projectCatalogProductGraphV2Public(graph).media;
	const withoutPresentationCopy = (item: (typeof media)[number]) => ({
		...item,
		// Checkout and fulfillment use role/order/asset identity only. Keep the
		// exact envelope shape while excluding presentation copy whose UTF-8 size
		// can exceed the private resolver's bounded response contract.
		altText: null,
	});
	if (graph.draft.productKind === "print") {
		const primary = media.find(({ role }) => role === "primary");
		if (!primary) throw rejected();
		return [withoutPresentationCopy(primary)];
	}
	if (graph.draft.productKind === "print_set") {
		const cover = media.find(({ role }) => role === "cover");
		const members = media.filter(({ role }) => role === "set_member");
		if (!cover || members.length === 0) throw rejected();
		return [cover, ...members].map(withoutPresentationCopy);
	}
	const gallery = media.find(({ role }) => role === "gallery");
	if (!gallery) throw rejected();
	return [withoutPresentationCopy(gallery)];
}

function baseResponse(graph: LoadedGraph, item: SnapshotItem) {
	const variant = selectedVariant(graph, item);
	const commerce = resolvePrintCommerce(graph, item, variant.retailPriceCents);
	return {
		version: 1 as const,
		item,
		identity: {
			productId: graph.revision.productId,
			revisionId: graph.revision._id,
			productKind: graph.revision.productKind,
			title: graph.draft.title!,
			slug: graph.revision.slug,
			variantKey: variant.variantKey,
		},
		commerce: { currency: "usd" as const, ...commerce },
		media: fulfillmentMedia(graph),
	};
}

async function loadExactGraph(ctx: QueryCtx, siteUrl: string, item: SnapshotItem,
	mode: "strict-current" | "paid-historical" = "strict-current") {
	const { productId, revisionId } = requireProductAndRevisionIds(ctx, item);
	const value = await ctx.db.get(productId);
	if (!value || value.siteUrl !== siteUrl) throw rejected();
	const product = requireCatalogProductGraphV2Product(value);
	if (product.productKind !== item.productKind) throw rejected();
	const graph = await (mode === "paid-historical"
		? loadPaidHistoricalCatalogProductGraphV2Revision
		: loadCatalogProductGraphV2Revision)(ctx, product, revisionId);
	if (!graph) throw rejected();
	return { product, graph };
}

function isRefunded(order: Doc<"orders">) {
	return order.status === "refunded" || order.stripeRefundId !== undefined
		|| order.fulfillmentRecoveryStatus === "refund_pending"
		|| order.fulfillmentRecoveryStatus === "refunded";
}

export async function resolveCatalogCommerce(
	ctx: QueryCtx,
	siteUrl: string,
	request: CatalogCommerceRequest,
) {
	if (request.purpose === "checkout") {
		const { product, graph } = await loadExactGraph(ctx, siteUrl, request.item);
		const enabledKinds = await loadCatalogProductKinds(ctx, siteUrl);
		if (!enabledKinds.includes(product.productKind)
			|| product.publishedRevisionId !== graph.revision._id
			|| graph.draft.saleAvailability !== "available") {
			throw rejected();
		}
		return { purpose: "checkout" as const, ...baseResponse(graph, request.item) };
	}

	const order = await ctx.db.query("orders")
		.withIndex("by_stripeSessionId", (query) => query.eq("stripeSessionId", request.stripeSessionId))
		.unique();
	const snapshot = order?.checkoutSnapshot;
	if (!order || order.siteUrl !== siteUrl || !snapshot || snapshot.catalogProvider !== "convex") {
		throw rejected();
	}
	if (isRefunded(order)) throw resolutionError("refunded");
	const storedItem = snapshot.items[request.itemIndex];
	if (!storedItem) throw rejected();
	const item: SnapshotItem = {
		...storedItem,
		materialOptionKey: storedItem.materialOptionKey ?? null,
		sizeOptionKey: storedItem.sizeOptionKey ?? null,
		borderOptionKey: storedItem.borderOptionKey ?? null,
		frameOptionKey: storedItem.frameOptionKey ?? null,
	};
	const { product, graph } = await loadExactGraph(ctx, siteUrl, item, "paid-historical");
	if (request.purpose === "paid_download") {
		if (item.productKind !== "digital_download") {
			throw rejected();
		}
	} else if (item.productKind === "digital_download") {
		throw rejected();
	}
	const enabledKinds: string[] = await loadCatalogProductKinds(ctx, siteUrl).catch(() => []);
	const response = baseResponse(graph, item);
	return {
		purpose: request.purpose,
		...response,
		current: {
			kindEnabled: enabledKinds.includes(product.productKind),
			publishedRevision: product.publishedRevisionId === graph.revision._id,
			slugMatches: product.slug === graph.revision.slug,
			available: product.publishedRevisionId === graph.revision._id
				&& graph.draft.saleAvailability === "available",
			variantEnabled: product.publishedRevisionId === graph.revision._id
				&& graph.variants.some(({ variantKey, status }) =>
					variantKey === item.variantKey && status === "enabled"),
		},
		descriptor: privateDescriptor(graph),
	};
}
