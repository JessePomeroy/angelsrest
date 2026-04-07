import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function PATCH({ params, request }) {
	const { id } = params;
	const data = await request.json();

	if (data._type === "preset") {
		try {
			const { _type, ...rest } = data;
			await convex.mutation(api.quotes.updatePreset, {
				presetId: id as Id<"quotePresets">,
				siteUrl: SITE_DOMAIN,
				...rest,
			});
			return json({ success: true });
		} catch (err) {
			console.error("Failed to update preset:", err);
			throw error(500, "Failed to update preset");
		}
	}

	try {
		if (data.action === "send") {
			await convex.mutation(api.quotes.markSent, {
				quoteId: id as Id<"quotes">,
				siteUrl: SITE_DOMAIN,
			});
		} else if (data.action === "accept") {
			await convex.mutation(api.quotes.markAccepted, {
				quoteId: id as Id<"quotes">,
				siteUrl: SITE_DOMAIN,
			});
		} else if (data.action === "decline") {
			await convex.mutation(api.quotes.markDeclined, {
				quoteId: id as Id<"quotes">,
				siteUrl: SITE_DOMAIN,
			});
		} else if (data.action === "convert") {
			const invoiceId = await convex.mutation(api.quotes.convertToInvoice, {
				quoteId: id as Id<"quotes">,
				siteUrl: SITE_DOMAIN,
				invoiceNumber: data.invoiceNumber,
				invoiceType: data.invoiceType || "one-time",
				dueDate: data.dueDate || undefined,
				notes: data.notes || undefined,
			});
			return json({ success: true, invoiceId });
		} else if (data.action === "expire") {
			await convex.mutation(api.quotes.update, {
				quoteId: id as Id<"quotes">,
				siteUrl: SITE_DOMAIN,
				status: "expired",
			});
		} else {
			await convex.mutation(api.quotes.update, {
				quoteId: id as Id<"quotes">,
				siteUrl: SITE_DOMAIN,
				...data,
			});
		}
		return json({ success: true });
	} catch (err) {
		console.error("Failed to update quote:", err);
		throw error(500, "Failed to update quote");
	}
}

export async function DELETE({ params, request }) {
	const { id } = params;

	try {
		const data = await request.json().catch(() => ({}));
		if (data._type === "preset") {
			await convex.mutation(api.quotes.removePreset, {
				presetId: id as Id<"quotePresets">,
				siteUrl: SITE_DOMAIN,
			});
		} else {
			await convex.mutation(api.quotes.remove, {
				quoteId: id as Id<"quotes">,
				siteUrl: SITE_DOMAIN,
			});
		}
		return json({ success: true });
	} catch (err) {
		console.error("Failed to delete:", err);
		throw error(500, "Failed to delete");
	}
}
