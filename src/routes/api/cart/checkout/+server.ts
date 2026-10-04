import { error, json } from "@sveltejs/kit";
import type Stripe from "stripe";
import { SITE_DOMAIN } from "$lib/config/site";
import { ApiErrorCode, apiError } from "$lib/server/apiError";
import { parseHandleCartIntent } from "$lib/server/cartCheckoutHelpers";
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
import { resolveCurrentCheckoutCommerce } from "$lib/server/current/currentCheckoutCommerce.server";
import {
	createHandleCheckoutSession,
	validateSameOriginCheckoutAttemptRequest,
} from "$lib/server/handleCheckout";
import { getPublicSiteOrigin, isStagingEnvironment } from "$lib/server/runtimeConfig";
import { buildCheckoutLineItem } from "$lib/server/stripeCheckoutSession";
import { getStripe } from "$lib/server/stripeClient";
import { buildTenantProductCheckoutOptions } from "$lib/server/stripeConnect";
import { resolveStripeTenantForSite } from "$lib/server/stripeTenant";

interface CartCheckoutRequest {
	items: unknown;
	attempt?: unknown;
	attemptStartedAt?: unknown;
	attemptProof?: unknown;
}

export async function POST({ request, cookies }) {
	try {
		const siteOrigin = getPublicSiteOrigin();
		const staging = isStagingEnvironment();
		const checkoutSite = staging ? SITE_DOMAIN : siteOrigin;
		const body = (await request.json()) as CartCheckoutRequest;
		const control = assertNewOrderCheckoutOpen(checkoutSite);
		const attemptIdentity = validateSameOriginCheckoutAttemptRequest(
			checkoutSite,
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
			if (!catalogItem?.snapshot) {
				throw new CurrentCheckoutCommerceError("invalid_authority", "authority");
			}
			return {
				catalogItem,
				snapshot: catalogItem.snapshot,
				quantity: item.quantity,
			};
		});

		const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = resolved.map(
			({ catalogItem, quantity }) => {
				const { paper, imageUrl } = catalogItem.legacyFulfillment;
				const hasPaper = typeof paper?.subcategoryId === "number";
				const name = hasPaper
					? `${catalogItem.title} — ${paper.name}, ${paper.width}×${paper.height}`
					: catalogItem.title;
				return buildCheckoutLineItem({
					name,
					imageUrl: imageUrl ?? undefined,
					unitAmountCents: catalogItem.unitPriceCents,
					quantity,
				});
			},
		);

		const tenant = await runCheckoutSessionStage("checkout_tenant", () =>
			resolveStripeTenantForSite(checkoutSite),
		);
		if (control.tenantId !== undefined && control.tenantId !== tenant.tenantId) {
			throw new NewOrderCheckoutClosedError();
		}
		const tenantCheckout = buildTenantProductCheckoutOptions({
			items: resolved.map(({ catalogItem, snapshot, quantity }) => ({
				productKind: snapshot.productKind,
				unitPriceCents: catalogItem.unitPriceCents,
				quantity,
			})),
			tenant,
		});

		const successUrl = `${siteOrigin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
		const cancelUrl = `${siteOrigin}/checkout/cancel`;
		const snapshots = resolved.map(({ snapshot }) => snapshot);
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
			allowedRedirectOrigins: staging ? [siteOrigin] : undefined,
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
