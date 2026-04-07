import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";
import { trimString, validatePositiveNumber } from "$lib/server/validation";

const convex = getConvex();

export async function POST({ request }) {
	const data = await request.json();

	const invoiceNumber = trimString(data.invoiceNumber, 255);
	if (!invoiceNumber || !data.clientId || !data.items?.length) {
		throw error(400, "Invoice number, client, and at least one item required");
	}

	// Validate item prices
	for (const item of data.items) {
		if (!item.description || typeof item.description !== "string") {
			throw error(400, "Each item must have a description");
		}
		item.description = item.description.trim().slice(0, 255);
		item.quantity = validatePositiveNumber(item.quantity, "quantity");
		item.unitPrice = validatePositiveNumber(item.unitPrice, "unitPrice");
	}

	try {
		const args: Record<string, unknown> = {
			siteUrl: SITE_DOMAIN,
			invoiceNumber,
			clientId: data.clientId as Id<"photographyClients">,
			invoiceType: data.invoiceType || "one-time",
			items: data.items,
			taxPercent:
				data.taxPercent !== undefined
					? validatePositiveNumber(data.taxPercent, "taxPercent")
					: undefined,
			notes: trimString(data.notes, 5000) || undefined,
			dueDate: trimString(data.dueDate, 255) || undefined,
		};

		if (data.recurring) {
			args.recurring = data.recurring;
		}

		if (data.depositPercent !== undefined) {
			args.depositPercent = validatePositiveNumber(
				data.depositPercent,
				"depositPercent",
			);
		}
		if (data.totalProject !== undefined) {
			args.totalProject = validatePositiveNumber(
				data.totalProject,
				"totalProject",
			);
		}

		if (data.milestoneName) {
			args.milestoneName = trimString(data.milestoneName, 255);
		}
		if (data.milestoneIndex !== undefined) {
			args.milestoneIndex = validatePositiveNumber(
				data.milestoneIndex,
				"milestoneIndex",
			);
		}
		if (data.parentInvoiceId) {
			args.parentInvoiceId = data.parentInvoiceId as Id<"invoices">;
		}

		// biome-ignore lint/suspicious/noExplicitAny: dynamic args built from request body
		const id = await convex.mutation(api.invoices.create, args as any);
		return json({ success: true, id });
	} catch (err) {
		console.error("Failed to create invoice:", err);
		throw error(500, "Failed to create invoice");
	}
}
