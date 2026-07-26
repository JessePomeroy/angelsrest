import { error, json } from "@sveltejs/kit";
import type Stripe from "stripe";
import { env } from "$env/dynamic/private";
import { PUBLIC_SITE_URL } from "$env/static/public";
import { client as sanityClient } from "$lib/sanity/client";
import { ApiErrorCode, apiError } from "$lib/server/apiError";
import {
	buildCartMetadata,
	buildCartTenantCheckoutOptions,
	parseHandleCartIntent,
	validateCart,
} from "$lib/server/cartCheckoutHelpers";
import { bindCheckoutSession } from "$lib/server/checkoutBinding";
import { resolveCheckoutItem } from "$lib/server/checkoutCatalog";
import { resolveCheckoutCommerce } from "$lib/server/checkoutCommerce";
import { isCheckoutSnapshotReservationConflict } from "$lib/server/checkoutSnapshotReservationClient";
import {
	checkoutSnapshotMode,
	createHandleCheckoutSession,
	validateCheckoutAttemptRequest,
} from "$lib/server/handleCheckout";
import {
	buildCheckoutLineItem,
	createPaymentCheckoutSession,
} from "$lib/server/stripeCheckoutSession";
import { getStripe } from "$lib/server/stripeClient";
import { resolveStripeTenantForSite } from "$lib/server/stripeTenant";
import type { CartItem } from "$lib/shop/cart";

interface CartCheckoutRequest {
	items: CartItem[];
	attempt?: unknown;
	attemptStartedAt?: unknown;
}

export async function POST({ request, cookies }) {
	const stripe = getStripe();
	const mode = checkoutSnapshotMode(env.CHECKOUT_SNAPSHOT_MODE);
	try {
		const body = (await request.json()) as CartCheckoutRequest;
		const { items } = body;
		const handleIntents = mode === "handle-v2" ? parseHandleCartIntent(items) : null;
		if (mode === "handle-v2") {
			validateCheckoutAttemptRequest(body.attempt, body.attemptStartedAt);
			if (!handleIntents) throw error(400, "invalid cart checkout intent");
		} else {
			const validationError = validateCart(items);
			if (validationError) throw error(400, validationError);
		}

		const sourceItems = handleIntents ?? items;
		const selection = (item: (typeof sourceItems)[number]) => ({
			productId: item.productSlug,
			isPrintSet: item.type === "set",
			paperSlug: item.paperSlug,
			sizeSlug: item.sizeSlug,
			paperIndex: item.paperIndex,
			borderWidth:
				item.borderWidthValue ?? ("borderWidth" in item ? item.borderWidth?.toString() : undefined),
			frame: item.frameValue,
		});
		const commerce =
			mode === "handle-v2"
				? await resolveCheckoutCommerce(
						sanityClient.fetch.bind(sanityClient),
						sourceItems.map(selection),
					)
				: null;
		const resolved = await Promise.all(
			sourceItems.map(async (item, index) => {
				const catalogItem =
					commerce?.items[index] ??
					(await resolveCheckoutItem(sanityClient.fetch.bind(sanityClient), selection(item)));
				const fulfillment = catalogItem.legacyFulfillment;
				const base: CartItem =
					mode === "handle-v2"
						? {
								id: "server-resolved",
								productSlug: catalogItem.productId,
								type: fulfillment.isPrintSet ? "set" : "print",
								quantity: item.quantity,
								title: catalogItem.title,
								imageUrl: fulfillment.imageUrl ?? "",
								unitPriceCents: catalogItem.unitPriceCents,
							}
						: (item as CartItem);
				return {
					catalogItem,
					cartItem: {
						...base,
						title: catalogItem.title,
						imageUrl: fulfillment.imageUrl ?? "",
						imageUrls: fulfillment.isPrintSet ? [...fulfillment.imageUrls] : undefined,
						paperName: fulfillment.paper?.name,
						paperSubcategoryId: fulfillment.paper?.subcategoryId,
						paperWidth: fulfillment.paper?.width,
						paperHeight: fulfillment.paper?.height,
						borderWidth: fulfillment.paper?.borderWidth,
						frameSubcategoryId: fulfillment.paper?.frameSubcategoryId,
						canvasSubcategoryId: fulfillment.paper?.canvasSubcategoryId,
						canvasWrapHex: fulfillment.paper?.canvasWrapHex,
						unitPriceCents: catalogItem.unitPriceCents,
					} satisfies CartItem,
				};
			}),
		);
		const resolvedItems = resolved.map(({ cartItem }) => cartItem);
		if (mode === "legacy") {
			const resolvedValidationError = validateCart(resolvedItems);
			if (resolvedValidationError) throw error(400, resolvedValidationError);
		}

		const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = resolvedItems.map((item) => {
			const hasPaper = typeof item.paperSubcategoryId === "number";
			const name = hasPaper
				? `${item.title} — ${item.paperName}, ${item.paperWidth}×${item.paperHeight}`
				: item.title;
			return buildCheckoutLineItem({
				name,
				imageUrl: item.imageUrl,
				unitAmountCents: item.unitPriceCents,
				quantity: item.quantity,
			});
		});

		const tenant = await resolveStripeTenantForSite(PUBLIC_SITE_URL);
		const tenantCheckout = buildCartTenantCheckoutOptions({
			items: resolvedItems,
			tenant,
		});

		const successUrl = `${PUBLIC_SITE_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
		const cancelUrl = `${PUBLIC_SITE_URL}/checkout/cancel`;
		if (mode === "handle-v2") {
			const snapshots = resolved.map(({ catalogItem }) => {
				if (!catalogItem.snapshot) throw new Error("Checkout snapshot identity is unavailable");
				return catalogItem.snapshot;
			});
			const session = await createHandleCheckoutSession({
				attempt: body.attempt,
				attemptStartedAt: body.attemptStartedAt,
				site: String(tenantCheckout.metadata.commerceTenantSiteUrl),
				account: tenant.stripeConnectedAccountId?.trim() || null,
				catalogProvider: commerce?.provider ?? "sanity",
				snapshotItems: snapshots,
				stripe,
				lineItems,
				successUrl,
				cancelUrl,
				shippingAllowedCountries: ["US"],
				tenantCheckout,
				bindSession: (sessionId) => bindCheckoutSession(cookies, sessionId),
			});
			return json(session);
		}
		const session = await createPaymentCheckoutSession({
			stripe,
			shippingAllowedCountries: ["US"],
			lineItems,
			successUrl,
			cancelUrl,
			metadata: buildCartMetadata(resolvedItems),
			tenantCheckout,
		});
		bindCheckoutSession(cookies, session.sessionId);
		return json(session);
	} catch (err: unknown) {
		if (isCheckoutSnapshotReservationConflict(err)) {
			throw apiError(409, ApiErrorCode.CHECKOUT_ATTEMPT_REJECTED, "Checkout attempt rejected");
		}
		if (err && typeof err === "object" && "status" in err && (mode === "legacy" || "body" in err))
			throw err;
		if (mode === "handle-v2") {
			console.error("Cart checkout failed");
			throw error(500, "Checkout failed. Please try again.");
		}
		const message = err instanceof Error ? err.message : "unknown error";
		console.error("Cart checkout error:", message);
		throw error(500, message || "Failed to create cart checkout session");
	}
}
