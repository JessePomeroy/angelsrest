import { error, json } from "@sveltejs/kit";
import type Stripe from "stripe";
import { PUBLIC_SITE_URL } from "$env/static/public";
import { ApiErrorCode, apiError } from "$lib/server/apiError";
import {
	buildCartTenantCheckoutOptions,
	parseHandleCartIntent,
} from "$lib/server/cartCheckoutHelpers";
import { bindCheckoutSession } from "$lib/server/checkoutBinding";
import {
	CurrentCheckoutCommerceError,
	runCheckoutSessionStage,
} from "$lib/server/checkoutFailures";
import { throwCheckoutRouteFailure } from "$lib/server/checkoutRouteFailure";
import { isCheckoutSnapshotReservationConflict } from "$lib/server/checkoutSnapshotReservationClient";
import {
	assertNewOrderCheckoutOpen,
	NewOrderCheckoutClosedError,
} from "$lib/server/commercePurposeControls";
import { resolveCurrentCheckoutCommerce } from "$lib/server/currentCheckoutCommerce";
import {
	createHandleCheckoutSession,
	validateSameOriginCheckoutAttemptRequest,
} from "$lib/server/handleCheckout";
import { buildCheckoutLineItem } from "$lib/server/stripeCheckoutSession";
import { getStripe } from "$lib/server/stripeClient";
import { resolveStripeTenantForSite } from "$lib/server/stripeTenant";
import type { CartItem } from "$lib/shop/cart";

interface CartCheckoutRequest {
	items: unknown;
	attempt?: unknown;
	attemptStartedAt?: unknown;
	attemptProof?: unknown;
}

export async function POST({ request, cookies }) {
	try {
		const body = (await request.json()) as CartCheckoutRequest;
		const control = assertNewOrderCheckoutOpen(PUBLIC_SITE_URL);
		const attemptIdentity = validateSameOriginCheckoutAttemptRequest(
			PUBLIC_SITE_URL,
			body.attempt,
			body.attemptStartedAt,
			body.attemptProof,
		);
		const { items } = body;
		const handleIntents = parseHandleCartIntent(items);
		if (!handleIntents) throw error(400, "invalid cart checkout intent");
		const stripe = await runCheckoutSessionStage("checkout_stripe", () => getStripe());

		const selection = (item: (typeof handleIntents)[number]) => ({
			productId: item.productSlug,
			isPrintSet: item.type === "set",
			paperSlug: item.paperSlug,
			sizeSlug: item.sizeSlug,
			paperIndex: item.paperIndex,
			borderWidth: item.borderWidthValue,
			frame: item.frameValue,
		});
		const commerce = await resolveCurrentCheckoutCommerce(handleIntents.map(selection));
		const resolved = handleIntents.map((item, index) => {
			const catalogItem = commerce.items[index];
			if (!catalogItem) {
				throw new CurrentCheckoutCommerceError("invalid_authority", "authority");
			}
			const fulfillment = catalogItem.legacyFulfillment;
			const base: CartItem = {
				id: "server-resolved",
				productSlug: catalogItem.productId,
				type: fulfillment.isPrintSet ? "set" : "print",
				quantity: item.quantity,
				title: catalogItem.title,
				imageUrl: fulfillment.imageUrl ?? "",
				unitPriceCents: catalogItem.unitPriceCents,
			};
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
		});
		const resolvedItems = resolved.map(({ cartItem }) => cartItem);

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

		const tenant = await runCheckoutSessionStage("checkout_tenant", () =>
			resolveStripeTenantForSite(PUBLIC_SITE_URL),
		);
		const tenantCheckout = buildCartTenantCheckoutOptions({
			items: resolvedItems,
			tenant,
		});

		const successUrl = `${PUBLIC_SITE_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
		const cancelUrl = `${PUBLIC_SITE_URL}/checkout/cancel`;
		const snapshots = resolved.map(({ catalogItem }) => {
			if (!catalogItem.snapshot) {
				throw new CurrentCheckoutCommerceError("invalid_authority", "authority");
			}
			return catalogItem.snapshot;
		});
		const session = await createHandleCheckoutSession({
			attempt: attemptIdentity.attempt,
			attemptStartedAt: attemptIdentity.attemptStartedAt,
			attemptProofClass: attemptIdentity.proofClass,
			site: String(tenantCheckout.metadata.commerceTenantSiteUrl),
			account: tenant.stripeConnectedAccountId?.trim() || null,
			catalogProvider: "convex",
			snapshotItems: snapshots,
			stripe,
			lineItems,
			successUrl,
			cancelUrl,
			shippingAllowedCountries: ["US"],
			tenantCheckout,
			bindSession: (sessionId) => bindCheckoutSession(cookies, sessionId),
			hostGeneration: control.generation,
		});
		return json(session);
	} catch (err: unknown) {
		if (err instanceof NewOrderCheckoutClosedError) {
			throw error(503, "Checkout is temporarily unavailable");
		}
		if (isCheckoutSnapshotReservationConflict(err)) {
			throw apiError(409, ApiErrorCode.CHECKOUT_ATTEMPT_REJECTED, "Checkout attempt rejected");
		}
		if (err && typeof err === "object" && "status" in err && "body" in err) throw err;
		throwCheckoutRouteFailure(err, "cart_checkout");
	}
}
