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
import { resolveCurrentCheckoutCommerce } from "$lib/server/currentCheckoutCommerce";
import { checkoutSnapshotMode } from "$lib/server/handleCheckout";
import { authorizeR4ReadRequest, r4ReadPurposes } from "$lib/server/r4ReadAuthorization";

const fixedSelection: CheckoutSelection = {
	productId: "raw-nerve-1",
	isPrintSet: false,
	paperSlug: "archival-matte",
	sizeSlug: "4x6",
};
const sentinelAuthorization = "r4_checkout_catalog_sentinel_v1";
const diagnosticDeadlineMs = 750;

export async function POST({ request }: { request: Request }) {
	const authorization = await authorizeR4ReadRequest(
		request,
		r4ReadPurposes.checkoutCatalogSentinel,
	);
	if (!authorization) throw error(401, "Unauthorized");
	if (!exactAuthorization(authorization.rawBody)) throw error(400, "Invalid sentinel input");

	const controller = new AbortController();
	const fetcher = <T = unknown>(query: string, params: Record<string, unknown> = {}) =>
		client.fetch<T>(query, params, { signal: controller.signal });
	const resolve = (item: Parameters<typeof resolveCatalogCheckout>[0], signal: AbortSignal) =>
		resolveCatalogCheckout(item, {
			origin: publicEnv.PUBLIC_CONVEX_SITE_URL,
			bearer: env.CATALOG_COMMERCE_CHECKOUT_RESOLVER_SECRET,
			signal,
		});

	let timer: ReturnType<typeof setTimeout> | undefined;
	const currentPromise = Promise.allSettled([
		resolveCurrentCheckoutCommerce([fixedSelection], { resolve }),
	]);
	const diagnosticPromise = Promise.race([
		Promise.allSettled([
			resolveCheckoutCommerce(fetcher, [fixedSelection], { provider: () => "sanity" }),
			resolveCheckoutCommerce(fetcher, [fixedSelection], {
				provider: () => "convex",
				resolve,
			}),
		]),
		new Promise<null>((resolveDeadline) => {
			timer = setTimeout(() => {
				controller.abort();
				resolveDeadline(null);
			}, diagnosticDeadlineMs);
		}),
	]);
	const [currentSettled, diagnosticSettled] = await Promise.all([
		currentPromise,
		diagnosticPromise,
	]).finally(() => {
		controller.abort();
		clearTimeout(timer);
	});

	const current = settledValue(currentSettled[0]);
	const sanity = settledValue(diagnosticSettled?.[0]);
	const convex = settledValue(diagnosticSettled?.[1]);
	const currentResolution =
		current?.provider === "convex" && current.items.length === 1 ? "resolved" : "unavailable";
	const forcedProviderBinding =
		!sanity || !convex
			? "unavailable"
			: sanity.provider === "sanity" && convex.provider === "convex"
				? "exact"
				: "mismatch";
	const diagnosticResolution =
		sanity?.items.length === 1 && convex?.items.length === 1
			? "resolved"
			: sanity && convex
				? "invalid"
				: "unavailable";
	const legacyParity =
		diagnosticResolution !== "resolved"
			? "unavailable"
			: semantics(sanity?.items[0]) === semantics(convex?.items[0])
				? "match"
				: "mismatch";

	return json(
		{
			version: 2,
			outcome: currentResolution === "resolved" ? "healthy" : "unavailable",
			currentCheckout: {
				catalogProvider: "convex",
				snapshotProtocol: "handle-v2",
				resolution: currentResolution,
			},
			diagnostics: {
				legacyProviderConfiguration: {
					provider: parseCheckoutCatalogProvider(env.CHECKOUT_CATALOG_PROVIDER),
					configuration: checkoutCatalogConfiguration(env.CHECKOUT_CATALOG_PROVIDER),
				},
				tenantBridgeAndIntakeSnapshotMode: checkoutSnapshotMode(env.CHECKOUT_SNAPSHOT_MODE),
				forcedProviderBinding,
				legacySanityConvexParity: legacyParity,
				resolution: diagnosticResolution,
			},
		},
		{
			status: currentResolution === "resolved" ? 200 : 503,
			headers: { "cache-control": "no-store" },
		},
	);
}

function settledValue<T>(result: PromiseSettledResult<T> | undefined): T | null {
	return result?.status === "fulfilled" ? result.value : null;
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
