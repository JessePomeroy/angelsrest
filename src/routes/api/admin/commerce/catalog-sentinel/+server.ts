import { error, json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { client } from "$lib/sanity/client";
import { resolveCatalogCheckout } from "$lib/server/catalogCommerceClients";
import type { CheckoutSelection, ResolvedCheckoutItem } from "$lib/server/checkoutCatalog";
import {
	parseCheckoutCatalogProvider,
	resolveCheckoutCommerce,
} from "$lib/server/checkoutCommerce";
import { checkoutSnapshotMode } from "$lib/server/handleCheckout";
import { authorizeR4ReadRequest, r4ReadPurposes } from "$lib/server/r4ReadAuthorization";

const fixedSelection: CheckoutSelection = {
	productId: "raw-nerve-1",
	isPrintSet: false,
	paperSlug: "archival-matte",
	sizeSlug: "4x6",
};
const sentinelAuthorization = "r4_checkout_catalog_sentinel_v1";
const sentinelDeadlineMs = 6_000;

export async function POST({ request }: { request: Request }) {
	const authorization = await authorizeR4ReadRequest(
		request,
		r4ReadPurposes.checkoutCatalogSentinel,
	);
	if (!authorization) {
		throw error(401, "Unauthorized");
	}
	if (!exactAuthorization(authorization.rawBody)) throw error(400, "Invalid sentinel input");
	try {
		const controller = new AbortController();
		const fetcher = <T = unknown>(query: string, params: Record<string, unknown> = {}) =>
			client.fetch<T>(query, params, { signal: controller.signal });
		let timer: ReturnType<typeof setTimeout> | undefined;
		const [active, sanity, convex] = await Promise.race([
			Promise.all([
				resolveCheckoutCommerce(fetcher, [fixedSelection]),
				resolveCheckoutCommerce(fetcher, [fixedSelection], { provider: () => "sanity" }),
				resolveCheckoutCommerce(fetcher, [fixedSelection], {
					provider: () => "convex",
					resolve: (item, signal) =>
						resolveCatalogCheckout(item, {
							origin: publicEnv.PUBLIC_CONVEX_SITE_URL,
							bearer: env.CATALOG_COMMERCE_CHECKOUT_RESOLVER_SECRET,
							signal,
						}),
				}),
			]),
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => {
					controller.abort();
					reject(new Error("Catalog sentinel deadline"));
				}, sentinelDeadlineMs);
			}),
		]).finally(() => {
			controller.abort();
			clearTimeout(timer);
		});
		const forcedProviderBinding =
			sanity.provider === "sanity" && convex.provider === "convex" ? "exact" : "mismatch";
		const resolved = [active, sanity, convex].every((result) => result.items.length === 1);
		const checkoutCatalogProvider = parseCheckoutCatalogProvider(env.CHECKOUT_CATALOG_PROVIDER);
		const expectedActiveProvider = checkoutCatalogProvider === "convex" ? "convex" : "sanity";
		const expectedActive = expectedActiveProvider === "sanity" ? sanity : convex;
		const activeProviderBinding =
			active.provider === expectedActiveProvider &&
			resolved &&
			semantics(active.items[0]) === semantics(expectedActive.items[0])
				? "exact"
				: "mismatch";
		return json(
			{
				version: 1,
				checkoutCatalogProvider,
				checkoutCatalogConfiguration: checkoutCatalogConfiguration(env.CHECKOUT_CATALOG_PROVIDER),
				activeResolutionProvider: active.provider,
				activeProviderBinding,
				forcedProviderBinding,
				checkoutSnapshotMode: checkoutSnapshotMode(env.CHECKOUT_SNAPSHOT_MODE),
				parity:
					forcedProviderBinding === "exact" &&
					activeProviderBinding === "exact" &&
					resolved &&
					semantics(sanity.items[0]) === semantics(convex.items[0])
						? "match"
						: "mismatch",
				resolution: resolved ? "resolved" : "invalid",
			},
			{ headers: { "cache-control": "no-store" } },
		);
	} catch {
		throw error(503, "Catalog sentinel unavailable");
	}
}

function exactAuthorization(rawBody: string) {
	let value: unknown;
	try {
		value = JSON.parse(rawBody);
	} catch {
		return false;
	}
	return (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.keys(value).length === 1 &&
		(value as { authorization?: unknown }).authorization === sentinelAuthorization
	);
}

function checkoutCatalogConfiguration(value: unknown) {
	if (value === undefined) return "absent";
	return value === "sanity" || value === "shadow" || value === "convex" ? "exact" : "invalid";
}

function semantics(item: ResolvedCheckoutItem | undefined) {
	if (!item) return null;
	return JSON.stringify({
		title: item.title,
		amount: item.unitPriceCents,
		kind: item.productCategory,
		digital: item.legacyFulfillment.isDigital,
		set: item.legacyFulfillment.isPrintSet,
		paper: item.legacyFulfillment.paper,
		media: Boolean(item.publicImage),
		setMediaCount: item.legacyFulfillment.imageUrls.length,
	});
}
