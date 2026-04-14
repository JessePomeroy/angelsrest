import { error, json } from "@sveltejs/kit";
import Stripe from "stripe";
import { api } from "$convex/api";
import { STRIPE_SECRET_KEY } from "$env/static/private";
import { PUBLIC_SITE_URL } from "$env/static/public";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";

const stripe = new Stripe(STRIPE_SECRET_KEY);
const convex = getConvex();

export async function POST({ request }) {
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

		// Calculate total from line items
		const subtotal = invoice.items.reduce(
			(sum: number, item: { quantity: number; unitPrice: number }) =>
				sum + item.quantity * item.unitPrice,
			0,
		);
		const taxAmount = invoice.taxPercent ? subtotal * (invoice.taxPercent / 100) : 0;
		const _total = subtotal + taxAmount;

		// Build Stripe line items from invoice items
		const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = invoice.items.map(
			(item: { description: string; quantity: number; unitPrice: number }) => ({
				price_data: {
					currency: "usd",
					product_data: {
						name: item.description,
					},
					unit_amount: Math.round(item.unitPrice * 100),
				},
				quantity: item.quantity,
			}),
		);

		// Add tax as a separate line item if applicable
		if (taxAmount > 0) {
			lineItems.push({
				price_data: {
					currency: "usd",
					product_data: {
						name: `Tax (${invoice.taxPercent}%)`,
					},
					unit_amount: Math.round(taxAmount * 100),
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
