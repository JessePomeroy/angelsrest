import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import { verifyClientPaymentReadiness } from "$lib/server/clientPaymentReadiness.server";
import { getConvex } from "$lib/server/convexClient";
import { getPublicSiteOrigin } from "$lib/server/runtimeConfig";
import {
	buildCheckoutLineItem,
	createPaymentCheckoutSession,
} from "$lib/server/stripeCheckoutSession";
import { getStripe } from "$lib/server/stripeClient";
import {
	buildTenantCheckoutOptions,
	ClientPaymentUnavailableError,
	normalizeCommerceTenantSiteUrl,
} from "$lib/server/stripeConnect";
import { resolveStripeTenantForSite } from "$lib/server/stripeTenant";
import { getWebhookSecret } from "$lib/server/webhookSecret";
import {
	calculateInvoiceAmounts,
	invoiceBalance,
} from "../../../../../packages/crm-api/src/invoiceAmounts";

const convex = getConvex();

export async function POST({ request }) {
	try {
		const parsed: unknown = await request.json();
		if (
			!parsed ||
			typeof parsed !== "object" ||
			!("token" in parsed) ||
			typeof parsed.token !== "string" ||
			!parsed.token
		)
			throw error(400, "Missing required field: token");
		const webhookSecret = getWebhookSecret();
		const invoice = await convex.query(api.portal.getInvoiceCheckoutTarget, {
			token: parsed.token,
			webhookSecret,
		});
		if (!invoice) throw error(404, "Invalid invoice link");
		if (!["sent", "overdue", "partial"].includes(invoice.status))
			throw error(400, "Invoice is not payable");
		try {
			const amounts = calculateInvoiceAmounts(invoice.items, invoice.taxPercent);
			if (invoiceBalance(amounts.totalCents, invoice.paidAmount).remainingCents < 50)
				throw new Error("Invoice total must be at least $0.50 to pay online.");
		} catch (cause) {
			throw error(400, cause instanceof Error ? cause.message : "Invalid invoice amounts");
		}

		const stripe = getStripe();
		const tenant = await resolveStripeTenantForSite(invoice.siteUrl, {
			requirePlatformClient: true,
		});
		if (normalizeCommerceTenantSiteUrl(tenant.siteUrl) !== "angelsrest.online") {
			if (!tenant.tenantId || !tenant.stripeConnectedAccountId)
				throw new ClientPaymentUnavailableError();
			await verifyClientPaymentReadiness({
				siteUrl: normalizeCommerceTenantSiteUrl(tenant.siteUrl),
				tenantId: tenant.tenantId,
				accountId: tenant.stripeConnectedAccountId,
				stripe,
				convex,
				webhookSecret,
			});
		}
		const checkout = await convex.mutation(api.invoices.prepareCheckout, {
			invoiceId: invoice.invoiceId,
			siteUrl: invoice.siteUrl,
			webhookSecret,
			stripeAccountId: tenant.stripeConnectedAccountId ?? undefined,
			origin: getPublicSiteOrigin(),
		});
		if (
			!checkout.items ||
			checkout.amountCents === undefined ||
			checkout.expiresAt === undefined ||
			!checkout.origin
		)
			throw new Error("Invoice checkout snapshot unavailable");
		const amounts = calculateInvoiceAmounts(checkout.items, checkout.taxPercent);
		const lineItems = checkout.paidBeforeCents
			? [
					buildCheckoutLineItem({
						name: "Invoice remaining balance",
						unitAmountCents: checkout.amountCents,
					}),
				]
			: checkout.items.map((item, index) =>
					buildCheckoutLineItem({
						name: Number.isInteger(item.quantity)
							? item.description
							: `${item.description} (${item.quantity} units)`,
						unitAmountCents: Number.isInteger(item.quantity)
							? item.unitPrice
							: amounts.lineAmountsCents[index],
						quantity: Number.isInteger(item.quantity) ? item.quantity : 1,
					}),
				);
		if (!checkout.paidBeforeCents && amounts.taxCents > 0)
			lineItems.push(
				buildCheckoutLineItem({
					name: `Tax (${checkout.taxPercent}%)`,
					unitAmountCents: amounts.taxCents,
				}),
			);
		const tenantCheckout = buildTenantCheckoutOptions({
			tenant,
			kind: "service",
			subtotalCents: checkout.amountCents,
		});
		const session = await createPaymentCheckoutSession({
			purpose: "invoice-payment",
			stripe,
			lineItems,
			tenantCheckout,
			expiresAt: checkout.expiresAt,
			successUrl: `${checkout.origin}/invoice/payment-success?session_id={CHECKOUT_SESSION_ID}`,
			cancelUrl: `${checkout.origin}/invoice/payment-canceled`,
			metadata: {
				type: "invoice_payment",
				invoiceId: invoice.invoiceId,
				siteUrl: invoice.siteUrl,
				checkoutFingerprint: checkout.fingerprint,
				invoiceCheckoutId: checkout._id,
			},
			idempotencyKey: `invoice-checkout:${checkout._id}`,
		});
		await convex.mutation(api.invoices.recordCheckoutStarted, {
			webhookSecret,
			invoiceId: invoice.invoiceId,
			siteUrl: invoice.siteUrl,
			checkoutId: checkout._id,
			stripeCheckoutSessionId: session.sessionId,
			stripeCheckoutFingerprint: checkout.fingerprint,
		});
		return json({ url: session.url });
	} catch (cause: unknown) {
		if (cause instanceof ClientPaymentUnavailableError) throw error(503, cause.message);
		if (cause && typeof cause === "object" && "status" in cause) throw cause;
		console.error(
			"Invoice checkout error:",
			cause instanceof Error ? cause.message : "Checkout unavailable",
		);
		throw error(500, "payment is temporarily unavailable. please contact the business.");
	}
}
