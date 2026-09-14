import { createHash } from "node:crypto";
import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { getConvex } from "$lib/server/convexClient";
import { getPublicSiteOrigin } from "$lib/server/runtimeConfig";
import {
	buildCheckoutLineItem,
	createPaymentCheckoutSession,
} from "$lib/server/stripeCheckoutSession";
import { getStripe } from "$lib/server/stripeClient";
import { buildTenantCheckoutOptions } from "$lib/server/stripeConnect";
import { resolveStripeTenantForSite } from "$lib/server/stripeTenant";
import { getWebhookSecret } from "$lib/server/webhookSecret";
import { calculateInvoiceAmounts } from "../../../../../packages/crm-api/src/invoiceAmounts";

const convex = getConvex();
const MIN_USD_CHARGE_CENTS = 50;

interface InvoiceCheckoutIdempotencyInput {
	siteUrl: string;
	invoiceId: string;
	lineItemsCents: { description: string; quantity: number; unitPriceCents: number }[];
	taxPercent: number;
	taxCents: number;
}

function buildInvoiceCheckoutIdempotencyKey({
	siteUrl,
	invoiceId,
	lineItemsCents,
	taxPercent,
	taxCents,
}: InvoiceCheckoutIdempotencyInput): string {
	const fingerprint = buildInvoiceCheckoutFingerprint({
		lineItemsCents,
		taxPercent,
		taxCents,
	});
	return `invoice-checkout:${siteUrl}:${invoiceId}:${fingerprint}`;
}

function buildInvoiceCheckoutFingerprint({
	lineItemsCents,
	taxPercent,
	taxCents,
}: Pick<InvoiceCheckoutIdempotencyInput, "lineItemsCents" | "taxPercent" | "taxCents">): string {
	return createHash("sha256")
		.update(JSON.stringify({ lineItemsCents, taxPercent, taxCents }))
		.digest("hex")
		.slice(0, 24);
}

export async function POST({ request }) {
	const stripe = getStripe();
	try {
		const siteOrigin = getPublicSiteOrigin();
		const { token } = await request.json();

		if (!token) {
			throw error(400, "Missing required field: token");
		}

		const webhookSecret = getWebhookSecret();
		const invoice = await convex.query(api.portal.getInvoiceCheckoutTarget, {
			token,
			webhookSecret,
		});
		if (!invoice) throw error(404, "Invalid invoice link");
		const invoiceId = invoice.invoiceId;
		const siteUrl = invoice.siteUrl;

		if (invoice.status === "paid") {
			throw error(400, "Invoice has already been paid");
		}
		if (invoice.status !== "sent" && invoice.status !== "overdue") {
			throw error(400, "Invoice is not payable");
		}

		let amounts: ReturnType<typeof calculateInvoiceAmounts>;
		try {
			amounts = calculateInvoiceAmounts(invoice.items, invoice.taxPercent);
		} catch (err) {
			throw error(400, err instanceof Error ? err.message : "Invalid invoice amounts");
		}
		// Keep the original quantities in the fingerprint. Existing integer
		// invoices retain their exact Stripe payload and retry identity.
		const lineItemsCents = invoice.items.map((item) => ({
			description: item.description,
			quantity: item.quantity,
			unitPriceCents: item.unitPrice,
		}));
		const taxPercent = invoice.taxPercent ?? 0;
		const { taxCents, totalCents } = amounts;
		if (totalCents < MIN_USD_CHARGE_CENTS) {
			throw error(400, "Invoice total must be at least $0.50 to pay online.");
		}
		const checkoutFingerprint = buildInvoiceCheckoutFingerprint({
			lineItemsCents,
			taxPercent,
			taxCents,
		});
		const tenant = await resolveStripeTenantForSite(siteUrl, {
			requirePlatformClient: true,
		});
		const tenantCheckout = buildTenantCheckoutOptions({
			tenant,
			kind: "service",
			subtotalCents: totalCents,
		});

		const lineItems = lineItemsCents.map((item, index) => {
			const fractional = !Number.isInteger(item.quantity);
			// Stripe quantities are integers; a fractional service line becomes
			// one billed line at its already-rounded cent amount.
			return buildCheckoutLineItem({
				name: fractional ? `${item.description} (${item.quantity} units)` : item.description,
				unitAmountCents: fractional ? amounts.lineAmountsCents[index] : item.unitPriceCents,
				quantity: fractional ? 1 : item.quantity,
			});
		});

		// Add tax as a separate line item if applicable
		if (taxCents > 0) {
			lineItems.push(
				buildCheckoutLineItem({
					name: `Tax (${taxPercent}%)`,
					unitAmountCents: taxCents,
				}),
			);
		}

		const session = await createPaymentCheckoutSession({
			purpose: "invoice-payment",
			stripe,
			lineItems,
			successUrl: `${siteOrigin}/invoice/payment-success?session_id={CHECKOUT_SESSION_ID}`,
			cancelUrl: `${siteOrigin}/invoice/payment-canceled`,
			metadata: {
				type: "invoice_payment",
				invoiceId,
				siteUrl,
				checkoutFingerprint,
			},
			tenantCheckout,
			idempotencyKey: buildInvoiceCheckoutIdempotencyKey({
				siteUrl,
				invoiceId,
				lineItemsCents,
				taxPercent,
				taxCents,
			}),
		});

		await convex.mutation(api.invoices.recordCheckoutStarted, {
			webhookSecret,
			invoiceId: invoiceId as Id<"invoices">,
			siteUrl,
			stripeCheckoutSessionId: session.sessionId,
			stripeCheckoutFingerprint: checkoutFingerprint,
		});

		return json({ url: session.url });
	} catch (err: unknown) {
		if (err && typeof err === "object" && "status" in err) {
			throw err;
		}
		console.error(
			"Invoice checkout error:",
			err instanceof Error ? err.message : "Failed to create checkout session",
		);
		throw error(500, "payment is temporarily unavailable. please contact the business.");
	}
}
