import { v } from "convex/values";
import { calculateInvoiceAmounts } from "../src/invoiceAmounts";
import { clientFeatureAllowed } from "../src/clientFeatures";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { requireSiteAdmin } from "./authHelpers";
import { logActivity } from "./activityLog";
import { businessSearchText } from "./helpers/businessSearch";
import { allocateNextInvoiceNumber } from "./helpers/documentNumbering";
import { calendarDate, recurringDate } from "./helpers/recurringCalendar";
const args = { siteUrl: v.string(), invoiceId: v.id("invoices") };
const today = () => new Date(Date.now()).toISOString().slice(0, 10);
async function scheduleNext(ctx: MutationCtx, row: Doc<"recurringInvoiceSchedules">) {
	if (row.nextDueDate > "2099-12-31" || (row.endDate && row.nextDueDate > row.endDate)) {
		await ctx.db.patch(row._id, { state: "completed" });
		return;
	}
	await ctx.scheduler.runAt(
		Math.max(Date.now(), calendarDate(row.nextDueDate)),
		internal.recurringInvoices.wake,
		{ id: row._id, expectedDate: row.nextDueDate },
	);
}
export const get = query({
	args,
	handler: async (ctx, { siteUrl, invoiceId }) => {
		await requireSiteAdmin(ctx, siteUrl, "invoicing");
		const invoice = await ctx.db.get(invoiceId);
		if (!invoice || invoice.siteUrl !== siteUrl) throw new Error("Invoice not found");
		return await ctx.db
			.query("recurringInvoiceSchedules")
			.withIndex("by_template", (q) => q.eq("templateInvoiceId", invoiceId))
			.unique();
	},
});
export const activate = mutation({
	args: { ...args, firstDueDate: v.string() },
	handler: async (ctx, { siteUrl, invoiceId, firstDueDate }) => {
		await requireSiteAdmin(ctx, siteUrl, "invoicing");
		calendarDate(firstDueDate);
		if (firstDueDate < today())
			throw new Error(
				"Choose today or a future first cycle; activation never backfills old recurring metadata",
			);
		const invoice = await ctx.db.get(invoiceId);
		if (
			!invoice ||
			invoice.siteUrl !== siteUrl ||
			invoice.invoiceType !== "recurring" ||
			!invoice.recurring ||
			invoice.recurringScheduleId ||
			invoice.status === "canceled"
		)
			throw new Error("A recurring template invoice is required");
		const existing = await ctx.db
			.query("recurringInvoiceSchedules")
			.withIndex("by_template", (q) => q.eq("templateInvoiceId", invoiceId))
			.unique();
		if (existing) throw new Error("This invoice already has a schedule");
		const client = await ctx.db.get(invoice.clientId);
		if (!client || client.siteUrl !== siteUrl) throw new Error("Client unavailable");
		const endDate = invoice.recurring.endDate;
		if (endDate) {
			calendarDate(endDate);
			if (endDate < firstDueDate) throw new Error("The schedule ends before its first cycle");
		}
		calculateInvoiceAmounts(invoice.items, invoice.taxPercent);
		const id = await ctx.db.insert("recurringInvoiceSchedules", {
			siteUrl,
			templateInvoiceId: invoiceId,
			clientId: client._id,
			clientName: client.name,
			items: invoice.items,
			taxPercent: invoice.taxPercent,
			notes: invoice.notes,
			interval: invoice.recurring.interval,
			anchor: firstDueDate,
			cycle: 0,
			nextDueDate: firstDueDate,
			endDate,
			state: "active",
		});
		await scheduleNext(ctx, (await ctx.db.get(id))!);
		return id;
	},
});
export const changeState = mutation({
	args: {
		...args,
		state: v.union(v.literal("active"), v.literal("paused"), v.literal("canceled")),
	},
	handler: async (ctx, { siteUrl, invoiceId, state }) => {
		await requireSiteAdmin(ctx, siteUrl, "invoicing");
		const row = await ctx.db
			.query("recurringInvoiceSchedules")
			.withIndex("by_template", (q) => q.eq("templateInvoiceId", invoiceId))
			.unique();
		if (!row || row.siteUrl !== siteUrl || row.state === "canceled" || row.state === "completed")
			throw new Error("Schedule unavailable");
		let cycle = row.cycle;
		let nextDueDate = row.nextDueDate;
		// Resuming skips dates missed while paused, preserving the original calendar anchor.
		if (state === "active")
			while (nextDueDate < today() && nextDueDate <= "2099-12-31") {
				cycle += 1;
				nextDueDate = recurringDate(row.anchor, row.interval, cycle);
			}
		await ctx.db.patch(row._id, { state, cycle, nextDueDate, reason: undefined });
		if (state === "active") await scheduleNext(ctx, { ...row, state, cycle, nextDueDate });
	},
});
export const wake = internalMutation({
	args: { id: v.id("recurringInvoiceSchedules"), expectedDate: v.string() },
	handler: async (ctx, { id, expectedDate }) => {
		const row = await ctx.db.get(id);
		if (
			!row ||
			row.state !== "active" ||
			row.nextDueDate !== expectedDate ||
			expectedDate > today()
		)
			return;
		const tenant = await ctx.db
			.query("platformClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", row.siteUrl))
			.unique();
		const client = await ctx.db.get(row.clientId);
		const template = await ctx.db.get(row.templateInvoiceId);
		if (
			!tenant ||
			tenant.offboarding ||
			tenant.subscriptionStatus === "canceled" ||
			!clientFeatureAllowed(tenant, "invoicing") ||
			!client ||
			client.siteUrl !== row.siteUrl ||
			!template ||
			template.siteUrl !== row.siteUrl ||
			template.status === "canceled"
		) {
			await ctx.db.patch(id, { state: "paused", reason: "template_or_account_unavailable" });
			return;
		}
		if (row.endDate && expectedDate > row.endDate) {
			await ctx.db.patch(id, { state: "completed" });
			return;
		}
		const existing = await ctx.db
			.query("invoices")
			.withIndex("by_schedule_cycle", (q) =>
				q.eq("recurringScheduleId", id).eq("recurringCycleDate", expectedDate),
			)
			.unique();
		if (!existing) {
			calculateInvoiceAmounts(row.items, row.taxPercent);
			const invoiceNumber = await allocateNextInvoiceNumber(ctx, row.siteUrl);
			const invoiceId = await ctx.db.insert("invoices", {
				siteUrl: row.siteUrl,
				invoiceNumber,
				clientId: row.clientId,
				clientName: row.clientName,
				invoiceType: "one-time",
				status: "draft",
				items: row.items,
				taxPercent: row.taxPercent,
				notes: row.notes,
				dueDate: expectedDate,
				recurringScheduleId: id,
				recurringCycleDate: expectedDate,
				searchText: businessSearchText({ invoiceNumber, clientName: row.clientName }),
			});
			await logActivity(ctx, {
				siteUrl: row.siteUrl,
				clientId: row.clientId,
				action: "invoice_created",
				description: `recurring draft ${invoiceNumber} created for ${expectedDate}`,
				metadata: JSON.stringify({ docType: "invoice", docId: invoiceId }),
			});
		}
		const cycle = row.cycle + 1;
		const nextDueDate = recurringDate(row.anchor, row.interval, cycle);
		await ctx.db.patch(id, { cycle, nextDueDate });
		await scheduleNext(ctx, { ...row, cycle, nextDueDate });
	},
});
/** A bounded watchdog also recovers a failed scheduled transaction; each wake creates at most one draft. */
export const recoverDue = internalMutation({
	args: {},
	handler: async (ctx) => {
		const due = await ctx.db
			.query("recurringInvoiceSchedules")
			.withIndex("by_state_next", (q) => q.eq("state", "active").lte("nextDueDate", today()))
			.take(25);
		for (const row of due)
			await ctx.scheduler.runAfter(0, internal.recurringInvoices.wake, {
				id: row._id,
				expectedDate: row.nextDueDate,
			});
	},
});
