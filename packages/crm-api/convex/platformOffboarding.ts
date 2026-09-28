import { resolveTenantContext } from "./helpers/tenantContext";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireCreator } from "./authHelpers";

export const RETENTION_DAYS = 90;
export const disable = mutation({
	args: { clientId: v.id("platformClients"), confirmSiteUrl: v.string() },
	handler: async (ctx, args) => {
		const { identity } = await requireCreator(ctx);
		const client = await ctx.db.get(args.clientId);
		if (!client || client.siteUrl !== args.confirmSiteUrl)
			throw new Error("Confirm the exact client site");
		if (client.role === "creator" || client.siteUrl === "angelsrest.online")
			throw new Error("The platform owner cannot be offboarded");
		if (client.offboarding) return client.offboarding;
		const now = Date.now();
		const offboarding = {
			disabledAt: now,
			disabledBy: identity.tokenIdentifier,
			retainUntil: now + RETENTION_DAYS * 86400000,
		};
		await ctx.db.patch(client._id, { offboarding });
		return offboarding;
	},
});
export const requestErasure = mutation({
	args: {
		clientId: v.id("platformClients"),
		confirmSiteUrl: v.string(),
		eraseImmediately: v.boolean(),
	},
	handler: async (ctx, args) => {
		const { identity } = await requireCreator(ctx);
		const client = await ctx.db.get(args.clientId);
		if (!client || client.siteUrl !== args.confirmSiteUrl || !client.offboarding)
			throw new Error("Offboard and confirm the exact client site first");
		if (client.role === "creator" || client.siteUrl === "angelsrest.online")
			throw new Error("The platform owner cannot be erased");
		if (client.offboarding.erasureRequestedAt !== undefined) return client.offboarding;
		if (!args.eraseImmediately && Date.now() < client.offboarding.retainUntil)
			throw new Error(
				"The 90-day retention period has not elapsed; immediate erasure needs an explicit owner choice",
			);
		const offboarding = {
			...client.offboarding,
			erasureRequestedAt: Date.now(),
			erasureRequestedBy: identity.tokenIdentifier,
			immediateErasure: args.eraseImmediately,
		};
		await ctx.db.patch(client._id, { offboarding });
		return offboarding;
	},
});
export const restoreAccess = mutation({
	args: { clientId: v.id("platformClients"), confirmSiteUrl: v.string() },
	handler: async (ctx, args) => {
		await requireCreator(ctx);
		const client = await ctx.db.get(args.clientId);
		if (!client || client.siteUrl !== args.confirmSiteUrl)
			throw new Error("Confirm the exact client site");
		if (client.offboarding?.erasureRequestedAt !== undefined)
			throw new Error("Erasure has been requested; automatic restoration is unsafe");
		await ctx.db.patch(client._id, { offboarding: undefined });
		return { restored: true };
	},
});
export const isActive = query({
 args: { siteUrl: v.string() },
 handler: async (ctx, { siteUrl }) => {
  const tenant = await resolveTenantContext(ctx, { siteUrl });
  return { active: !!tenant && !tenant.client.offboarding };
 },
});

/** Bounded, repeatable metadata cleanup. Files and retained obligations are separate phases. */
export const eraseRecords = mutation({
	args: {
		clientId: v.id("platformClients"),
		confirmSiteUrl: v.string(),
		collection: v.union(
			v.literal("inquiries"),
			v.literal("emailTemplates"),
			v.literal("quotePresets"),
			v.literal("contractTemplates"),
			v.literal("quotes"),
			v.literal("contracts"),
			v.literal("invoices"),
		),
		cursor: v.union(v.string(), v.null()),
	},
	handler: async (ctx, args) => {
		await requireCreator(ctx);
		const client = await ctx.db.get(args.clientId);
		if (
			!client ||
			client.siteUrl !== args.confirmSiteUrl ||
			client.offboarding?.erasureRequestedAt === undefined
		)
			throw new Error("Owner-approved erasure is required");
		const result = await ctx.db
			.query(args.collection)
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", client.siteUrl))
			.paginate({ cursor: args.cursor, numItems: 50 });
		let deleted = 0;
		let retained = 0;
		for (const row of result.page) {
			const protectedQuote =
				"quoteNumber" in row &&
				(row.status === "accepted" ||
					row.acceptedAt !== undefined ||
					row.convertedToInvoice !== undefined);
			const protectedContract =
				"clientId" in row &&
				"body" in row &&
				(row.status === "signed" ||
					row.signedAt !== undefined ||
					row.signatureData !== undefined ||
					row.signedByName !== undefined ||
					row.signedByEmail !== undefined ||
					row.signedIp !== undefined);
			const protectedInvoice =
				"invoiceNumber" in row &&
				(row.activeCheckoutId !== undefined ||
					row.stripeCheckoutSessionId !== undefined ||
					(row.paidAmount ?? 0) > 0 ||
					row.paidAt !== undefined ||
					row.status === "paid" ||
					row.status === "partial");
			const linkedQuote =
				"invoiceNumber" in row
					? await ctx.db
							.query("quotes")
							.withIndex("by_convertedToInvoice", (q) => q.eq("convertedToInvoice", row._id))
							.first()
					: null;
			if (protectedQuote || protectedContract || protectedInvoice || linkedQuote) {
				retained++;
				continue;
			}
			await ctx.db.delete(row._id);
			deleted++;
		}
		return { deleted, retained, isDone: result.isDone, cursor: result.continueCursor };
	},
});

export const getState = query({
	args: { clientId: v.id("platformClients") },
	handler: async (ctx, { clientId }) => {
		await requireCreator(ctx);
		const client = await ctx.db.get(clientId);
		if (!client) throw new Error("Client not found");
		return {
			siteUrl: client.siteUrl,
			isCreator: client.role === "creator" || client.siteUrl === "angelsrest.online",
			offboarding: client.offboarding ?? null,
		};
	},
});
