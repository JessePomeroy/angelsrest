import { createHash } from "node:crypto";
import { error, json } from "@sveltejs/kit";
import type { Doc } from "$convex/dataModel";
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

const convex = getConvex();

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
	const fingerprint = createHash("sha256")
		.update(JSON.stringify({ lineItemsCents, taxPercent, taxCents }))
		.digest("hex")
		.slice(0, 24);
	return `invoice-checkout:${siteUrl}:${invoiceId}:${fingerprint}`;
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

		// Audit H8: compute in integer cents from the start so cents-
		// rounding errors don't compound across line items. The Convex
		// `invoices.items[].unitPrice` schema stores these as dollars
		// (floats); we round each line's unit price into cents once,
		// then everything downstream (subtotal, tax, Stripe line_item
		// unit_amount) stays integer.
		const lineItemsCents = invoice.items.map(
			(item: { description: string; quantity: number; unitPrice: number }) => ({
				description: item.description,
				quantity: item.quantity,
				unitPriceCents: Math.round(item.unitPrice * 100),
			}),
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
		const tenant = await resolveStripeTenantForSite(siteUrl, {
			requirePlatformClient: true,
		});
		const tenantCheckout = buildTenantCheckoutOptions({
			tenant,
			kind: "service",
			subtotalCents: subtotalCents + taxCents,
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

		return json({ url: session.url });
	} catch (err: unknown) {
		if (err && typeof err === "object" && "status" in err) {
			throw err;
		}
		const message = err instanceof Error ? err.message : "Failed to create checkout session";
		console.error("Invoice checkout error:", message);
		throw error(500, message);
	}
}
