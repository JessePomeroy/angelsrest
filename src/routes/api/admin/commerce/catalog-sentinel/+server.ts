import { error, json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { client } from "$lib/sanity/client";
import type { CheckoutSelection, ResolvedCheckoutItem } from "$lib/server/checkoutCatalog";
import {
	parseCheckoutCatalogProvider,
	resolveCheckoutCommerce,
} from "$lib/server/checkoutCommerce";
import { checkoutSnapshotMode } from "$lib/server/handleCheckout";
import { verifySiteAdminRequest } from "$lib/server/siteAdminAuthorization";

const MAX_BODY_BYTES = 4_096;
const encoder = new TextEncoder();

export async function POST({ request }: { request: Request }) {
	if (!(await verifySiteAdminRequest(request))) throw error(401, "Unauthorized");
	const text = await request.text();
	if (encoder.encode(text).byteLength > MAX_BODY_BYTES) throw error(400, "Invalid sentinel input");
	const selection = parseSelection(text);
	try {
		const fetcher = client.fetch.bind(client);
		const [active, sanity, convex] = await Promise.all([
			resolveCheckoutCommerce(fetcher, [selection]),
			resolveCheckoutCommerce(fetcher, [selection], { provider: () => "sanity" }),
			resolveCheckoutCommerce(fetcher, [selection], { provider: () => "convex" }),
		]);
		return json({
			version: 1,
			checkoutCatalogProvider: parseCheckoutCatalogProvider(env.CHECKOUT_CATALOG_PROVIDER),
			activeResolutionProvider: active.provider,
			checkoutSnapshotMode: checkoutSnapshotMode(env.CHECKOUT_SNAPSHOT_MODE),
			parity: semantics(sanity.items[0]) === semantics(convex.items[0]) ? "match" : "mismatch",
			resolution: active.items.length === 1 ? "resolved" : "invalid",
		});
	} catch {
		throw error(503, "Catalog sentinel unavailable");
	}
}

function parseSelection(text: string): CheckoutSelection {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw error(400, "Invalid sentinel input");
	}
	if (
		!exactObject(value, [
			"productId",
			"isPrintSet",
			"paperSlug",
			"sizeSlug",
			"borderWidth",
			"frame",
		])
	)
		throw error(400, "Invalid sentinel input");
	const nullable = (part: unknown) =>
		part === null ||
		(typeof part === "string" && part.length > 0 && part === part.trim() && part.length <= 200);
	if (
		typeof value.productId !== "string" ||
		value.productId.length < 1 ||
		value.productId.length > 200 ||
		value.productId !== value.productId.trim() ||
		typeof value.isPrintSet !== "boolean" ||
		!nullable(value.paperSlug) ||
		!nullable(value.sizeSlug) ||
		!nullable(value.borderWidth) ||
		!nullable(value.frame)
	)
		throw error(400, "Invalid sentinel input");
	return {
		productId: value.productId,
		isPrintSet: value.isPrintSet,
		...(value.paperSlug === null ? {} : { paperSlug: value.paperSlug as string }),
		...(value.sizeSlug === null ? {} : { sizeSlug: value.sizeSlug as string }),
		...(value.borderWidth === null ? {} : { borderWidth: value.borderWidth as string }),
		...(value.frame === null ? {} : { frame: value.frame as string }),
	};
}

function semantics(item: ResolvedCheckoutItem | undefined) {
	if (!item) return null;
	return JSON.stringify({
		amount: item.unitPriceCents,
		kind: item.productCategory,
		digital: item.legacyFulfillment.isDigital,
		set: item.legacyFulfillment.isPrintSet,
		paper: item.legacyFulfillment.paper,
		media: Boolean(item.publicImage),
		setMediaCount: item.legacyFulfillment.imageUrls.length,
	});
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
	return (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.keys(value).length === keys.length &&
		keys.every((key) => Object.hasOwn(value, key))
	);
}
