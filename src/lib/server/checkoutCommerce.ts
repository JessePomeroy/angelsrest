import { ConvexHttpClient } from "convex/browser";
import { api } from "$convex/api";
import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { SITE_DOMAIN } from "$lib/config/site";
import {
	CatalogBoundaryError,
	type CatalogBoundaryPhase,
	resolveCatalogCheckout,
} from "$lib/server/catalogCommerceClients";
import {
	type CheckoutSelection,
	type CheckoutSnapshotItem,
	type ResolvedCheckoutItem,
	resolveCheckoutItem,
} from "$lib/server/checkoutCatalog";
import { logStructured } from "$lib/server/logger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KINDS = new Set("print print_set postcard tapestry digital_download merchandise".split(" "));
const PRIMARY_ROLES = { print: "primary", print_set: "cover" } as const;
const CANVAS_KEYS = "color thickness subcategoryId wrapOptionId wrapHex";
type SecondaryPhase = CatalogBoundaryPhase | "query" | "graph" | "resolver" | "authority";
class ShadowSecondaryError extends Error {
	constructor(readonly phase: SecondaryPhase) {
		super("Checkout catalog secondary failed");
	}
}

type Dependencies = {
	provider?: () => unknown;
	query?: (slug: string, signal: AbortSignal) => Promise<unknown>;
	resolve?: (item: CheckoutSnapshotItem, signal: AbortSignal) => Promise<unknown>;
	resolveSanity?: (selection: CheckoutSelection) => Promise<ResolvedCheckoutItem>;
	log?: typeof logStructured;
};
export function parseCheckoutCatalogProvider(value: unknown) {
	return value === "sanity" || value === "shadow" || value === "convex" ? value : "sanity";
}
function invalid(): never {
	throw new Error("Checkout catalog resolution failed");
}
function object(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function required(value: unknown, keys: string) {
	if (!object(value)) invalid();
	const list = keys.split(" ");
	if (Object.keys(value).length !== list.length || list.some((key) => !(key in value))) invalid();
	return value;
}
function string(value: unknown, max = 500) {
	if (typeof value !== "string" || !value || value !== value.trim() || value.length > max)
		invalid();
	return value;
}
function integer(value: unknown, minimum = 0) {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) invalid();
	return Number(value);
}
const nullableKey = (value: unknown) => (value === null ? null : string(value, 128));
function discover(value: unknown, selection: CheckoutSelection) {
	if (!object(value) || !Array.isArray(value.variants)) invalid();
	const slug = string(selection.productId, 200);
	const kind = value.productKind;
	if (value.schemaVersion !== 2 || value.slug !== slug || !KINDS.has(kind as string)) invalid();
	if ((selection.isPrintSet === true) !== (kind === "print_set")) invalid();
	const isPrint = kind === "print" || kind === "print_set";
	const material = isPrint ? string(selection.paperSlug, 128) : null;
	const size = isPrint ? string(selection.sizeSlug, 128) : null;
	if (selection.paperIndex !== undefined || selection.paper !== undefined) invalid();
	if (
		!isPrint &&
		[selection.paperSlug, selection.sizeSlug, selection.borderWidth, selection.frame].some(
			(part) => part !== undefined,
		)
	)
		invalid();
	const variants = value.variants.filter((variant) => {
		if (!object(variant)) return false;
		if (!isPrint) return variant.materialOption === null && variant.sizeOption === null;
		return (
			object(variant.materialOption) &&
			variant.materialOption.slug === material &&
			object(variant.sizeOption) &&
			variant.sizeOption.slug === size
		);
	});
	if (variants.length !== 1 || !variants[0]) invalid();
	const option = (part: unknown) => (part === undefined ? "none" : nullableKey(part));
	return {
		slug,
		item: {
			productKey: string(value.productId, 128),
			revisionId: string(value.revisionId, 128),
			productKind: kind as CheckoutSnapshotItem["productKind"],
			variantKey: string(variants[0].key, 128),
			materialOptionKey: material,
			sizeOptionKey: size,
			borderOptionKey: isPrint ? option(selection.borderWidth) : null,
			frameOptionKey: isPrint ? option(selection.frame) : null,
		} satisfies CheckoutSnapshotItem,
	};
}
function publicMedia(value: unknown) {
	const media = required(value, "key role order altText asset");
	const asset = required(media.asset, "assetId source derivatives");
	const derivatives = required(asset.derivatives, "thumb card display1280 display2048 display2560");
	const display = required(derivatives.display1280, "contentType width height");
	const assetId = string(asset.assetId, 36);
	if (!UUID.test(assetId) || display.contentType !== "image/webp") invalid();
	integer(display.width, 1);
	integer(display.height, 1);
	integer(media.order);
	return {
		role: string(media.role, 20),
		url: `https://media.angelsrest.online/sites/${SITE_DOMAIN}/web/${assetId}/display-1280.webp`,
	};
}
function authority(value: unknown, item: CheckoutSnapshotItem, slug: string) {
	const root = required(value, "version purpose item identity commerce media");
	if (root.version !== 1 || root.purpose !== "checkout") invalid();
	const echoed = required(
		root.item,
		"productKey revisionId productKind variantKey materialOptionKey sizeOptionKey borderOptionKey frameOptionKey",
	);
	if (Object.entries(item).some(([key, part]) => echoed[key] !== part)) invalid();
	const identity = required(
		root.identity,
		"productId revisionId productKind title slug variantKey",
	);
	if (
		identity.productId !== item.productKey ||
		identity.revisionId !== item.revisionId ||
		identity.productKind !== item.productKind ||
		identity.variantKey !== item.variantKey ||
		identity.slug !== slug
	)
		invalid();
	const commerce = required(root.commerce, "currency amountCents finish");
	if (commerce.currency !== "usd") invalid();
	const isPrint = item.productKind === "print" || item.productKind === "print_set";
	let paper: ResolvedCheckoutItem["legacyFulfillment"]["paper"] = null;
	if (isPrint) {
		const finish = required(
			commerce.finish,
			"materialKey sizeKey borderKey frameKey paper size border frame canvas",
		);
		if (
			finish.materialKey !== item.materialOptionKey ||
			finish.sizeKey !== item.sizeOptionKey ||
			finish.borderKey !== item.borderOptionKey ||
			finish.frameKey !== item.frameOptionKey
		)
			invalid();
		const material = required(finish.paper, "name subcategoryId");
		const size = required(finish.size, "label width height");
		const border = required(finish.border, "inches");
		const frame = required(finish.frame, "subcategoryId");
		const canvas = finish.canvas === null ? null : required(finish.canvas, CANVAS_KEYS);
		if (typeof border.inches !== "number" || !Number.isFinite(border.inches) || border.inches < 0)
			invalid();
		if (canvas) {
			if (canvas.color !== "black" && canvas.color !== "white") invalid();
			string(canvas.thickness, 20);
			integer(canvas.wrapOptionId, 1);
		}
		paper = {
			name: string(material.name, 120),
			subcategoryId: integer(material.subcategoryId, 1),
			width: integer(size.width, 1),
			height: integer(size.height, 1),
			borderWidth: border.inches || undefined,
			frameSubcategoryId: integer(frame.subcategoryId) || undefined,
			canvasSubcategoryId: canvas ? integer(canvas.subcategoryId, 1) : undefined,
			canvasWrapHex: canvas ? string(canvas.wrapHex, 20) : undefined,
		};
	} else if (commerce.finish !== null) invalid();
	if (!Array.isArray(root.media) || root.media.length < 1 || root.media.length > 50) invalid();
	const media = root.media.map(publicMedia);
	const primaryRole =
		item.productKind === "print" || item.productKind === "print_set"
			? PRIMARY_ROLES[item.productKind]
			: "gallery";
	const publicImage = media.find(({ role }) => role === primaryRole)?.url;
	if (!publicImage) invalid();
	const setImages = media.filter(({ role }) => role === "set_member").map(({ url }) => url);
	if (setImages.length > 20) invalid();
	return {
		productId: slug,
		title: string(identity.title),
		unitPriceCents: integer(commerce.amountCents),
		productCategory: item.productKind,
		publicImage,
		snapshot: item,
		legacyFulfillment: {
			isDigital: item.productKind === "digital_download",
			isPrintSet: item.productKind === "print_set",
			imageUrl: publicImage,
			imageUrls: item.productKind === "print_set" ? setImages : [],
			paper,
		},
	} satisfies ResolvedCheckoutItem;
}
function client(signal: AbortSignal) {
	return new ConvexHttpClient(publicEnv.PUBLIC_CONVEX_URL || "", {
		logger: false,
		fetch: (input, init) => fetch(input, { ...init, signal }),
	});
}
async function secondaryStep<T>(
	phase: SecondaryPhase,
	diagnose: boolean,
	operation: () => T | Promise<T>,
) {
	try {
		return await operation();
	} catch (error) {
		if (!diagnose) throw error;
		throw new ShadowSecondaryError(error instanceof CatalogBoundaryError ? error.phase : phase);
	}
}
async function secondary(
	selections: readonly CheckoutSelection[],
	signal: AbortSignal,
	dependencies: Dependencies,
	diagnose = false,
) {
	const query =
		dependencies.query ??
		((slug, bound) =>
			client(bound).query(api.catalogProductGraphs.getPublishedBySlug, {
				siteUrl: SITE_DOMAIN,
				slug,
			}));
	const resolve = dependencies.resolve ?? ((item, bound) => resolveCatalogCheckout(item, bound));
	return Promise.all(
		selections.map(async (selection) => {
			const graph = await secondaryStep("query", diagnose, () =>
				query(string(selection.productId, 200), signal),
			);
			const found = await secondaryStep("graph", diagnose, () => discover(graph, selection));
			const resolved = await secondaryStep("resolver", diagnose, () => resolve(found.item, signal));
			return secondaryStep("authority", diagnose, () =>
				authority(resolved, found.item, found.slug),
			);
		}),
	);
}
function semantics(item: ResolvedCheckoutItem) {
	const fulfillment = item.legacyFulfillment;
	return JSON.stringify([
		item.unitPriceCents,
		fulfillment.isDigital,
		fulfillment.isPrintSet,
		fulfillment.paper,
		Boolean(item.publicImage),
		fulfillment.isPrintSet ? fulfillment.imageUrls.length : 0,
	]);
}
export async function resolveCheckoutCommerce(
	fetcher: Parameters<typeof resolveCheckoutItem>[0],
	selections: readonly CheckoutSelection[],
	dependencies: Dependencies = {},
): Promise<{ provider: "sanity" | "convex"; items: ResolvedCheckoutItem[] }> {
	const provider = parseCheckoutCatalogProvider(
		(dependencies.provider ?? (() => privateEnv.CHECKOUT_CATALOG_PROVIDER))(),
	);
	const resolveSanity =
		dependencies.resolveSanity ??
		((selection: CheckoutSelection) => resolveCheckoutItem(fetcher, selection, true));
	const sanity = () => Promise.all(selections.map(resolveSanity));
	if (provider === "sanity") return { provider, items: await sanity() };
	if (provider === "convex") {
		const items = await secondary(selections, AbortSignal.timeout(5_000), dependencies);
		return { provider, items };
	}
	const started = Date.now();
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const bounded = Promise.race([
		secondary(selections, controller.signal, dependencies, true)
			.then((items) => ({ items }))
			.catch((error: unknown) => ({
				reason: "secondary_error" as const,
				secondaryPhase: error instanceof ShadowSecondaryError ? error.phase : ("resolver" as const),
			})),
		new Promise<{ reason: "timeout" }>((resolve) => {
			timer = setTimeout(() => {
				controller.abort();
				resolve({ reason: "timeout" });
			}, 750);
		}),
	]).finally(() => {
		controller.abort();
		clearTimeout(timer);
	});
	let primary: ResolvedCheckoutItem[];
	try {
		primary = await sanity();
	} catch (error) {
		controller.abort();
		clearTimeout(timer);
		throw error;
	}
	const outcome = await bounded;
	const mismatch =
		"items" in outcome &&
		(outcome.items.length !== primary.length ||
			outcome.items.some(
				(item, index) => !primary[index] || semantics(item) !== semantics(primary[index]),
			));
	const reason = "reason" in outcome ? outcome.reason : mismatch ? "mismatch" : null;
	if (reason)
		(dependencies.log ?? logStructured)({
			event: "checkout.catalog_shadow_closed",
			level: "warn",
			durationMs: Math.max(0, Math.min(750, Math.round(Date.now() - started))),
			meta: {
				reason,
				primaryCount: primary.length,
				secondaryCount: "items" in outcome ? outcome.items.length : null,
				...("secondaryPhase" in outcome ? { secondaryPhase: outcome.secondaryPhase } : {}),
			},
		});
	return { provider: "sanity", items: primary };
}
