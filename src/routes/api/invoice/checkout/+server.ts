import { error, json } from "@sveltejs/kit";
import type Stripe from "stripe";
import { api } from "$convex/api";
import { PUBLIC_SITE_URL } from "$env/static/public";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";
import { getStripe } from "$lib/server/stripeClient";

const convex = getConvex();

export async function POST({ request }) {
	const stripe = getStripe();
	try {
		const { invoiceId } = await request.json();

		if (!invoiceId) {
			throw error(400, "Missing required field: invoiceId");
		}

		const invoice = await convex.query(api.invoices.get, { invoiceId });

		if (!invoice) {
			throw error(404, "Invoice not found");
		}

		if (invoice.status === "paid") {
			throw error(400, "Invoice has already been paid");
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

		// Build Stripe line items from invoice items
		const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = lineItemsCents.map(
			(item: { description: string; quantity: number; unitPriceCents: number }) => ({
				price_data: {
					currency: "usd",
					product_data: {
						name: item.description,
					},
					unit_amount: item.unitPriceCents,
				},
				quantity: item.quantity,
			}),
		);

		// Add tax as a separate line item if applicable
		if (taxCents > 0) {
			lineItems.push({
				price_data: {
					currency: "usd",
					product_data: {
						name: `Tax (${taxPercent}%)`,
					},
					unit_amount: taxCents,
				},
				quantity: 1,
			});
		}

		const session = await stripe.checkout.sessions.create({
			payment_method_types: ["card"],
			line_items: lineItems,
			mode: "payment",
			success_url: `${PUBLIC_SITE_URL}/invoice/payment-success?session_id={CHECKOUT_SESSION_ID}`,
			cancel_url: `${PUBLIC_SITE_URL}/invoice/payment-canceled`,
			metadata: {
				type: "invoice_payment",
				invoiceId,
				siteUrl: SITE_DOMAIN,
			},
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
