import { env as privateEnv } from "$env/dynamic/private";
import type { CheckoutSelection, ResolvedCheckoutItem } from "$lib/server/checkoutCatalog";
import { resolveCheckoutItem } from "$lib/server/checkoutCatalog";
import {
	type CurrentCheckoutCommerceDependencies,
	CurrentCheckoutCommerceDiagnosticError,
	resolveCurrentCheckoutCommerce,
	resolveCurrentCheckoutCommerceForComparison,
} from "$lib/server/currentCheckoutCommerce";
import { logStructured } from "$lib/server/logger";

type Dependencies = CurrentCheckoutCommerceDependencies & {
	provider?: () => unknown;
	resolveSanity?: (selection: CheckoutSelection) => Promise<ResolvedCheckoutItem>;
	log?: typeof logStructured;
};

export function parseCheckoutCatalogProvider(value: unknown) {
	return value === "sanity" || value === "shadow" || value === "convex" ? value : "sanity";
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

/**
 * Temporary Sanity-primary parity interface retained for the catalog sentinel.
 * Newly initiated checkout imports currentCheckoutCommerce directly instead.
 */
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
	if (provider === "convex") return resolveCurrentCheckoutCommerce(selections, dependencies);

	const started = Date.now();
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const bounded = Promise.race([
		resolveCurrentCheckoutCommerceForComparison(selections, controller.signal, dependencies)
			.then(({ items }) => ({ items }))
			.catch((error: unknown) => ({
				reason: "secondary_error" as const,
				secondaryPhase:
					error instanceof CurrentCheckoutCommerceDiagnosticError
						? error.phase
						: ("resolver" as const),
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
