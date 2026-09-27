import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { calculateInvoiceAmounts, invoiceBalance } from "../../src/invoiceAmounts";

export function invoiceReceivedCents(invoice: Doc<"invoices">) {
	if (invoice.status === "partial" && invoice.paidAmount === undefined)
		throw new Error("Historical partial invoice needs a recorded payment amount");
	// Historical manual settlements did not store paidAmount.
	return invoiceBalance(
		0,
		invoice.paidAmount ??
			(invoice.status === "paid"
				? calculateInvoiceAmounts(invoice.items, invoice.taxPercent).totalCents
				: 0),
	).paidCents;
}

export function invoicePaymentBalance(invoice: Doc<"invoices">) {
	const { totalCents } = calculateInvoiceAmounts(invoice.items, invoice.taxPercent);
	return { totalCents, ...invoiceBalance(totalCents, invoiceReceivedCents(invoice)) };
}

export function paidInvoiceStatus(invoice: Doc<"invoices">, paidCents: number, totalCents: number) {
	if (invoice.status === "canceled") return "canceled" as const;
	return paidCents >= totalCents ? ("paid" as const) : ("partial" as const);
}

/** Match the original host's exact USD Checkout fingerprint before freezing legacy amounts. */
export async function legacyInvoiceCheckoutSnapshot(invoice: Doc<"invoices">) {
	try {
		const { totalCents, taxCents } = calculateInvoiceAmounts(invoice.items, invoice.taxPercent);
		const input = JSON.stringify({
			lineItemsCents: invoice.items.map((item) => ({
				description: item.description,
				quantity: item.quantity,
				unitPriceCents: item.unitPrice,
			})),
			taxPercent: invoice.taxPercent ?? 0,
			taxCents,
		});
		const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
		const fingerprint = [...new Uint8Array(digest)]
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join("")
			.slice(0, 24);
		return fingerprint === invoice.stripeCheckoutFingerprint
			? {
					items: invoice.items,
					taxPercent: invoice.taxPercent ?? 0,
					totalCents,
					amountCents: totalCents,
				}
			: {};
	} catch {
		return {}; // Historical amounts are unknown until a signed webhook supplies evidence.
	}
}

/** Preserve the only session known to older hosts before their mutable slot changes. */
export async function preserveLegacyCheckout(ctx: MutationCtx, invoice: Doc<"invoices">) {
	if (!invoice.stripeCheckoutSessionId) return;
	const existing = await ctx.db
		.query("invoiceCheckouts")
		.withIndex("by_siteUrl_and_stripeSessionId", (q) =>
			q.eq("siteUrl", invoice.siteUrl).eq("stripeSessionId", invoice.stripeCheckoutSessionId),
		)
		.unique();
	if (existing) {
		if (existing.invoiceId !== invoice._id)
			throw new Error("Invoice checkout session already bound");
		return existing;
	}
	const id = await ctx.db.insert("invoiceCheckouts", {
		invoiceId: invoice._id,
		siteUrl: invoice.siteUrl,
		stripeSessionId: invoice.stripeCheckoutSessionId,
		fingerprint: invoice.stripeCheckoutFingerprint ?? "",
		legacy: true,
		...(await legacyInvoiceCheckoutSnapshot(invoice)),
		// Do not invent an old checkout amount from mutable current invoice items.
		...(invoice.stripeCheckoutStatus === "paid"
			? {
					paidAt: invoice.paidAt ?? invoice._creationTime,
				}
			: {}),
	});
	return await ctx.db.get(id);
}
