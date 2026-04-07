import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function PATCH({ params, request }) {
	const { id } = params;
	const data = await request.json();

	try {
		if (data.action === "send") {
			await convex.mutation(api.invoices.markSent, {
				invoiceId: id as Id<"invoices">,
			});
		} else if (data.action === "pay") {
			await convex.mutation(api.invoices.markPaid, {
				invoiceId: id as Id<"invoices">,
			});
		} else if (data.action === "overdue") {
			await convex.mutation(api.invoices.update, {
				invoiceId: id as Id<"invoices">,
				status: "overdue",
			});
		} else if (data.action === "cancel") {
			await convex.mutation(api.invoices.update, {
				invoiceId: id as Id<"invoices">,
				status: "canceled",
			});
		} else {
			await convex.mutation(api.invoices.update, {
				invoiceId: id as Id<"invoices">,
				...data,
			});
		}
		return json({ success: true });
	} catch (err) {
		console.error("Failed to update invoice:", err);
		throw error(500, "Failed to update invoice");
	}
}

export async function DELETE({ params }) {
	const { id } = params;

	try {
		await convex.mutation(api.invoices.remove, {
			invoiceId: id as Id<"invoices">,
		});
		return json({ success: true });
	} catch (err) {
		console.error("Failed to delete invoice:", err);
		throw error(500, "Failed to delete invoice");
	}
}
