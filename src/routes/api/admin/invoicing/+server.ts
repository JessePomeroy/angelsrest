import { error, json } from "@sveltejs/kit";
import { ConvexHttpClient } from "convex/browser";
import { env as publicEnv } from "$env/dynamic/public";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

const convex = new ConvexHttpClient(publicEnv.PUBLIC_CONVEX_URL || "");

export async function POST({ request }) {
	const data = await request.json();

	if (!data.invoiceNumber || !data.clientId || !data.items?.length) {
		throw error(400, "Invoice number, client, and at least one item required");
	}

	try {
		const args: Record<string, unknown> = {
			siteUrl: "angelsrest.online",
			invoiceNumber: data.invoiceNumber,
			clientId: data.clientId as Id<"photographyClients">,
			invoiceType: data.invoiceType || "one-time",
			items: data.items,
			taxPercent: data.taxPercent || undefined,
			notes: data.notes || undefined,
			dueDate: data.dueDate || undefined,
		};

		// Recurring fields
		if (data.recurring) {
			args.recurring = data.recurring;
		}

		// Deposit fields
		if (data.depositPercent !== undefined) {
			args.depositPercent = data.depositPercent;
		}
		if (data.totalProject !== undefined) {
			args.totalProject = data.totalProject;
		}

		// Milestone fields
		if (data.milestoneName) {
			args.milestoneName = data.milestoneName;
		}
		if (data.milestoneIndex !== undefined) {
			args.milestoneIndex = data.milestoneIndex;
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
