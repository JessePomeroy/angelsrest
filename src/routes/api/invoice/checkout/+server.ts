import { createHash } from "node:crypto";
import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import type { Doc, Id } from "$convex/dataModel";
import { PUBLIC_SITE_URL } from "$env/static/public";
import { getConvex } from "$lib/server/convexClient";
import { validatePortalToken } from "$lib/server/portalToken";
import {
	buildCheckoutLineItem,
	createPaymentCheckoutSession,
} from "$lib/server/stripeCheckoutSession";
import { getStripe } from "$lib/server/stripeClient";
import { buildTenantCheckoutOptions } from "$lib/server/stripeConnect";
import { resolveStripeTenantForSite } from "$lib/server/stripeTenant";
import { getWebhookSecret } from "$lib/server/webhookSecret";

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
		const { token } = await request.json();

		if (!token) {
			throw error(400, "Missing required field: token");
		}

		const portal = await validatePortalToken(convex, token, "invoice");
		const invoice = portal.document as Doc<"invoices">;
		const invoiceId = portal.token.documentId;
		const siteUrl = portal.token.siteUrl;

		if (invoice.status === "paid") {
			throw error(400, "Invoice has already been paid");
		}
		if (invoice.status !== "sent" && invoice.status !== "overdue") {
			throw error(400, "Invoice is not payable");
		}

		// Invoice amounts are stored in cents in Convex/admin (`unitPrice: 100`
		// means $1.00). Stripe also expects `unit_amount` in cents, so do not
		// multiply again here.
		const lineItemsCents = invoice.items.map(
			(item: { description: string; quantity: number; unitPrice: number }) => {
				if (
					!Number.isFinite(item.quantity) ||
					item.quantity <= 0 ||
					!Number.isInteger(item.quantity)
				) {
					throw error(400, "Invalid invoice line item quantity");
				}
				if (
					!Number.isFinite(item.unitPrice) ||
					item.unitPrice < 0 ||
					!Number.isInteger(item.unitPrice)
				) {
					throw error(400, "Invalid invoice line item price");
				}
				return {
					description: item.description,
					quantity: item.quantity,
					unitPriceCents: item.unitPrice,
				};
			},
		);
		const subtotalCents = lineItemsCents.reduce(
			(sum: number, item: { quantity: number; unitPriceCents: number }) =>
				sum + item.quantity * item.unitPriceCents,
			0,
		);
		const taxPercent = Number(invoice.taxPercent ?? 0);
		if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100) {
			throw error(400, "Invalid invoice tax percentage");
		}
		const taxCents = taxPercent > 0 ? Math.round((subtotalCents * taxPercent) / 100) : 0;
		const totalCents = subtotalCents + taxCents;
		if (totalCents < MIN_USD_CHARGE_CENTS) {
			throw error(400, "Invoice total must be at least $0.50 to pay online.");
		}
		const checkoutFingerprint = buildInvoiceCheckoutFingerprint({
			lineItemsCents,
			taxPercent,
			taxCents,
		});
		const webhookSecret = getWebhookSecret();
		const tenant = await resolveStripeTenantForSite(siteUrl, {
			requirePlatformClient: true,
		});
		const tenantCheckout = buildTenantCheckoutOptions({
			tenant,
			kind: "service",
			subtotalCents: totalCents,
		});

		const lineItems = lineItemsCents.map(
			(item: { description: string; quantity: number; unitPriceCents: number }) =>
				buildCheckoutLineItem({
					name: item.description,
					unitAmountCents: item.unitPriceCents,
					quantity: item.quantity,
				}),
		);

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
			stripe,
			lineItems,
			successUrl: `${PUBLIC_SITE_URL}/invoice/payment-success?session_id={CHECKOUT_SESSION_ID}`,
			cancelUrl: `${PUBLIC_SITE_URL}/invoice/payment-canceled`,
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
