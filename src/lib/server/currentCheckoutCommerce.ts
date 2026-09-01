import { ConvexHttpClient } from "convex/browser";
import { api } from "$convex/api";
import { env as publicEnv } from "$env/dynamic/public";
import { SITE_DOMAIN } from "$lib/config/site";
import { CatalogBoundaryError, resolveCatalogCheckout } from "$lib/server/catalogCommerceClients";
import type {
	CheckoutSelection,
	CheckoutSnapshotItem,
	ResolvedCheckoutItem,
} from "$lib/server/checkoutCatalog";
import {
	CurrentCheckoutCommerceError,
	type CurrentCheckoutCommercePhase,
} from "$lib/server/checkoutFailures";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KINDS = new Set("print print_set postcard tapestry digital_download merchandise".split(" "));
const PRIMARY_ROLES = { print: "primary", print_set: "cover" } as const;
const CANVAS_KEYS = "color thickness subcategoryId wrapOptionId wrapHex";

export type { CurrentCheckoutCommercePhase } from "$lib/server/checkoutFailures";
export { CurrentCheckoutCommerceError } from "$lib/server/checkoutFailures";

export class CurrentCheckoutCommerceDiagnosticError extends Error {
	constructor(readonly phase: CurrentCheckoutCommercePhase) {
		super("Current checkout catalog authority failed");
	}
}

export interface CurrentCheckoutCommerceDependencies {
	query?: (slug: string, signal: AbortSignal) => Promise<unknown>;
	resolve?: (item: CheckoutSnapshotItem, signal: AbortSignal) => Promise<unknown>;
	signal?: AbortSignal;
}

function selectionChanged(phase: CurrentCheckoutCommercePhase): never {
	throw new CurrentCheckoutCommerceError("selection_changed", phase);
}

function unavailable(phase: CurrentCheckoutCommercePhase): never {
	throw new CurrentCheckoutCommerceError("unavailable", phase);
}

function invalidAuthority(phase: CurrentCheckoutCommercePhase): never {
	throw new CurrentCheckoutCommerceError("invalid_authority", phase);
}

function object(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function required(value: unknown, keys: string, phase: CurrentCheckoutCommercePhase = "authority") {
	if (!object(value)) invalidAuthority(phase);
	const list = keys.split(" ");
	if (Object.keys(value).length !== list.length || list.some((key) => !(key in value))) {
		invalidAuthority(phase);
	}
	return value;
}

function trustedString(
	value: unknown,
	max = 500,
	phase: CurrentCheckoutCommercePhase = "authority",
) {
	if (typeof value !== "string" || !value || value !== value.trim() || value.length > max)
		invalidAuthority(phase);
	return value;
}

function selectionString(value: unknown, max: number, phase: CurrentCheckoutCommercePhase) {
	if (typeof value !== "string" || !value || value !== value.trim() || value.length > max) {
		selectionChanged(phase);
	}
	return value;
}

function trustedInteger(
	value: unknown,
	minimum = 0,
	phase: CurrentCheckoutCommercePhase = "authority",
) {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) invalidAuthority(phase);
	return Number(value);
}

const selectionKey = (value: unknown, phase: CurrentCheckoutCommercePhase) =>
	value === null ? null : selectionString(value, 128, phase);

function discover(value: unknown, selection: CheckoutSelection) {
	if (value === null) selectionChanged("query");
	if (!object(value) || !Array.isArray(value.variants)) invalidAuthority("graph");
	const slug = selectionString(selection.productId, 200, "query");
	const kind = value.productKind;
	if (
		value.schemaVersion !== 2 ||
		trustedString(value.slug, 200, "graph") !== slug ||
		!KINDS.has(kind as string)
	) {
		invalidAuthority("graph");
	}
	if (
		(selection.isPrintSet !== undefined && typeof selection.isPrintSet !== "boolean") ||
		(selection.isPrintSet === true) !== (kind === "print_set")
	) {
		selectionChanged("graph");
	}
	const isPrint = kind === "print" || kind === "print_set";
	if (selection.paper !== undefined) selectionChanged("graph");
	let material: string | null = null;
	let size: string | null = null;
	if (isPrint) {
		if (selection.paperIndex !== undefined) selectionChanged("graph");
		material = selectionString(selection.paperSlug, 128, "graph");
		size = selectionString(selection.sizeSlug, 128, "graph");
	} else {
		if (selection.paperIndex !== undefined && selection.paperIndex !== 0) {
			selectionChanged("graph");
		}
		if (
			[selection.paperSlug, selection.sizeSlug, selection.borderWidth, selection.frame].some(
				(part) => part !== undefined,
			)
		) {
			selectionChanged("graph");
		}
	}
	const variants = value.variants.map((variant) => {
		if (!object(variant)) invalidAuthority("graph");
		const key = trustedString(variant.key, 128, "graph");
		if (!isPrint) {
			if (variant.materialOption !== null || variant.sizeOption !== null) {
				invalidAuthority("graph");
			}
			return { key, material: null, size: null };
		}
		if (!object(variant.materialOption) || !object(variant.sizeOption)) {
			invalidAuthority("graph");
		}
		return {
			key,
			material: trustedString(variant.materialOption.slug, 128, "graph"),
			size: trustedString(variant.sizeOption.slug, 128, "graph"),
		};
	});
	const matches = variants.filter(
		(variant) => !isPrint || (variant.material === material && variant.size === size),
	);
	if (matches.length === 0) selectionChanged("graph");
	if (matches.length !== 1 || !matches[0]) invalidAuthority("graph");
	const option = (part: unknown) => (part === undefined ? "none" : selectionKey(part, "graph"));
	return {
		slug,
		item: {
			productKey: trustedString(value.productId, 128, "graph"),
			revisionId: trustedString(value.revisionId, 128, "graph"),
			productKind: kind as CheckoutSnapshotItem["productKind"],
			variantKey: matches[0].key,
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
	const assetId = trustedString(asset.assetId, 36);
	if (!UUID.test(assetId) || display.contentType !== "image/webp") invalidAuthority("authority");
	trustedInteger(display.width, 1);
	trustedInteger(display.height, 1);
	trustedInteger(media.order);
	return {
		role: trustedString(media.role, 20),
		url: `https://media.angelsrest.online/sites/${SITE_DOMAIN}/web/${assetId}/display-1280.webp`,
	};
}

function authority(value: unknown, item: CheckoutSnapshotItem, slug: string) {
	const root = required(value, "version purpose item identity commerce media");
	if (root.version !== 1 || root.purpose !== "checkout") invalidAuthority("authority");
	const echoed = required(
		root.item,
		"productKey revisionId productKind variantKey materialOptionKey sizeOptionKey borderOptionKey frameOptionKey",
	);
	if (Object.entries(item).some(([key, part]) => echoed[key] !== part)) {
		invalidAuthority("authority");
	}
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
		invalidAuthority("authority");
	const commerce = required(root.commerce, "currency amountCents finish");
	if (commerce.currency !== "usd") invalidAuthority("authority");
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
			invalidAuthority("authority");
		const material = required(finish.paper, "name subcategoryId");
		const size = required(finish.size, "label width height");
		const border = required(finish.border, "inches");
		const frame = required(finish.frame, "subcategoryId");
		const canvas = finish.canvas === null ? null : required(finish.canvas, CANVAS_KEYS);
		if (typeof border.inches !== "number" || !Number.isFinite(border.inches) || border.inches < 0)
			invalidAuthority("authority");
		if (canvas) {
			if (canvas.color !== "black" && canvas.color !== "white") {
				invalidAuthority("authority");
			}
			trustedString(canvas.thickness, 20);
			trustedInteger(canvas.wrapOptionId, 1);
		}
		paper = {
			name: trustedString(material.name, 120),
			subcategoryId: trustedInteger(material.subcategoryId, 1),
			width: trustedInteger(size.width, 1),
			height: trustedInteger(size.height, 1),
			borderWidth: border.inches || undefined,
			frameSubcategoryId: trustedInteger(frame.subcategoryId) || undefined,
			canvasSubcategoryId: canvas ? trustedInteger(canvas.subcategoryId, 1) : undefined,
			canvasWrapHex: canvas ? trustedString(canvas.wrapHex, 20) : undefined,
		};
	} else if (commerce.finish !== null) invalidAuthority("authority");
	if (!Array.isArray(root.media) || root.media.length < 1 || root.media.length > 50) {
		invalidAuthority("authority");
	}
	const media = root.media.map(publicMedia);
	const primaryRole =
		item.productKind === "print" || item.productKind === "print_set"
			? PRIMARY_ROLES[item.productKind]
			: "gallery";
	const publicImage = media.find(({ role }) => role === primaryRole)?.url;
	if (!publicImage) invalidAuthority("authority");
	const setImages = media.filter(({ role }) => role === "set_member").map(({ url }) => url);
	if (setImages.length > 20) invalidAuthority("authority");
	return {
		productId: slug,
		title: trustedString(identity.title),
		unitPriceCents: trustedInteger(commerce.amountCents),
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

async function authorityStep<T>(
	phase: CurrentCheckoutCommercePhase,
	diagnose: boolean,
	operation: () => T | Promise<T>,
	classify: (error: unknown) => never,
) {
	try {
		return await operation();
	} catch (error) {
		if (diagnose) {
			throw new CurrentCheckoutCommerceDiagnosticError(
				error instanceof CurrentCheckoutCommerceError || error instanceof CatalogBoundaryError
					? error.phase
					: phase,
			);
		}
		if (error instanceof CurrentCheckoutCommerceError) throw error;
		return classify(error);
	}
}

function boundedOperation<T>(
	signal: AbortSignal,
	phase: CurrentCheckoutCommercePhase,
	operation: () => T | Promise<T>,
): Promise<T> {
	if (signal.aborted) unavailable(phase);
	return new Promise<T>((resolve, reject) => {
		const aborted = () => reject(new CurrentCheckoutCommerceError("unavailable", phase));
		signal.addEventListener("abort", aborted, { once: true });
		Promise.resolve()
			.then(operation)
			.then(
				(value) => {
					signal.removeEventListener("abort", aborted);
					resolve(value);
				},
				(error) => {
					signal.removeEventListener("abort", aborted);
					reject(error);
				},
			);
	});
}

function resolverFailure(error: unknown): never {
	if (error instanceof CatalogBoundaryError) {
		if (error.kind === "unavailable") unavailable(error.phase);
		if (error.kind === "rejected" && error.phase === "status") {
			selectionChanged(error.phase);
		}
		invalidAuthority(error.phase);
	}
	unavailable("resolver");
}

async function resolveItems(
	selections: readonly CheckoutSelection[],
	signal: AbortSignal,
	dependencies: CurrentCheckoutCommerceDependencies,
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
			const graph = await authorityStep(
				"query",
				diagnose,
				() =>
					boundedOperation(signal, "query", () =>
						query(selectionString(selection.productId, 200, "query"), signal),
					),
				() => unavailable("query"),
			);
			const found = await authorityStep(
				"graph",
				diagnose,
				() => discover(graph, selection),
				() => invalidAuthority("graph"),
			);
			const resolved = await authorityStep(
				"resolver",
				diagnose,
				() => boundedOperation(signal, "resolver", () => resolve(found.item, signal)),
				resolverFailure,
			);
			return authorityStep(
				"authority",
				diagnose,
				() => authority(resolved, found.item, found.slug),
				() => invalidAuthority("authority"),
			);
		}),
	);
}

/**
 * Resolve authority for Angels Rest first-party direct/cart checkout. There is
 * no fallback provider.
 */
export async function resolveCurrentCheckoutCommerce(
	selections: readonly CheckoutSelection[],
	dependencies: CurrentCheckoutCommerceDependencies = {},
): Promise<{ provider: "convex"; items: ResolvedCheckoutItem[] }> {
	const items = await resolveItems(
		selections,
		dependencies.signal ?? AbortSignal.timeout(5_000),
		dependencies,
	);
	return { provider: "convex", items };
}

/** Legacy parity diagnostics; never imported by current checkout routes. */
export async function resolveCurrentCheckoutCommerceForComparison(
	selections: readonly CheckoutSelection[],
	signal: AbortSignal,
	dependencies: CurrentCheckoutCommerceDependencies = {},
): Promise<{ provider: "convex"; items: ResolvedCheckoutItem[] }> {
	const items = await resolveItems(selections, signal, dependencies, true);
	return { provider: "convex", items };
}
