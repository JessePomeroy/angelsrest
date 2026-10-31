import { paginationOptsValidator } from "convex/server";
import { enqueueInquiryNotification, inquiryNotificationEnvelope } from "./helpers/inquiryNotifications";
import { v } from "convex/values";
import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { assertClientFeature } from "./authHelpers";
import { logActivity } from "./activityLog";
import { categoryValidator } from "./helpers/validators";
import {
	requireDocumentSiteAdmin,
	requireDocumentSiteAdminWithClient,
	requireSiteAdmin,
	requireWebhookCallerOrAuth,
} from "./authHelpers";

// Contact form ingress. The unauthenticated browser submits to the host's
// `/api/contact` route, which applies Turnstile and payload validation before
// calling this mutation with the shared server-only webhook secret.
export const create = mutation({
	args: {
		webhookSecret: v.string(),
		siteUrl: v.string(),
		name: v.string(),
		email: v.string(),
		phone: v.optional(v.string()),
		subject: v.optional(v.string()),
		message: v.string(),
		notification: v.optional(inquiryNotificationEnvelope),
	},
	handler: async (ctx, { webhookSecret, notification, ...args }) => {
		await requireWebhookCallerOrAuth(ctx, webhookSecret, { allowAuth: false });
		const client = await ctx.db.query("platformClients").withIndex("by_siteUrl", q => q.eq("siteUrl", args.siteUrl)).unique();
		if (client?.offboarding) throw new Error("Site intake is disabled");
		if (client) assertClientFeature(client, "inquiries");
		const id = await ctx.db.insert("inquiries", {
			...args,
			status: "new",
		});
		if (notification) await enqueueInquiryNotification(ctx, id, args.siteUrl, notification);
		return id;
	},
});

export const list = query({
	args: {
		siteUrl: v.string(),
		status: v.optional(v.union(v.literal("new"), v.literal("read"), v.literal("replied"))),
		limit: v.optional(v.number()),
	},
	handler: async (ctx, { siteUrl, status, limit }) => {
		await requireSiteAdmin(ctx, siteUrl, "inquiries");
		// Bounded by default — spam writes to inquiries are public, so an
		// unbounded `.collect()` was a DoS vector. See audit H11.
		const take = Math.min(limit ?? 200, 500);
		if (status) {
			return await ctx.db
				.query("inquiries")
				.withIndex("by_siteUrl_status", (q) =>
					q.eq("siteUrl", siteUrl).eq("status", status),
				)
				.order("desc")
				.take(take);
		}
		return await ctx.db
			.query("inquiries")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.take(take);
	},
});

/** Page through the complete site inbox, filtering before the bounded read. */
export const listPaginated = query({
	args: {
		siteUrl: v.string(),
		status: v.optional(v.union(v.literal("new"), v.literal("read"), v.literal("replied"))),
		paginationOpts: paginationOptsValidator,
		followUpBefore: v.optional(v.string()),
	},
	handler: async (ctx, { siteUrl, status, paginationOpts, followUpBefore }) => {
		await requireSiteAdmin(ctx, siteUrl, "inquiries");
		if (followUpBefore && status) throw new Error("Choose a status or follow-up filter");
		if (followUpBefore) validateFollowUpDate(followUpBefore);
		const inquiries = followUpBefore
			? ctx.db.query("inquiries").withIndex("by_siteUrl_and_followUpDate", (q) =>
				q.eq("siteUrl", siteUrl).gt("followUpDate", "").lte("followUpDate", followUpBefore))
			: status
			? ctx.db.query("inquiries").withIndex("by_siteUrl_status", (q) =>
				q.eq("siteUrl", siteUrl).eq("status", status),
			)
			: ctx.db.query("inquiries").withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl));
		return await inquiries.order(followUpBefore ? "asc" : "desc").paginate({
			...paginationOpts,
			numItems: Math.min(paginationOpts.numItems, 50),
			// Also bound reactive ranges requested with an end cursor.
			maximumRowsRead: 50,
		});
	},
});

function validateFollowUpDate(value: string) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))
		|| new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
		throw new Error("Follow-up date must be a calendar date");
	}
}

async function requireWorkflowAdmin(ctx: QueryCtx | MutationCtx, id: Id<"inquiries">) {
	const { doc, client } = await requireDocumentSiteAdminWithClient(ctx, "inquiries", id, "inquiries");
	if (client.tier !== "full") throw new Error("Full CRM access is required");
	assertClientFeature(client, "crm");
	return doc;
}

/** Inquiry and CRM reads remain scoped to the inquiry's stored tenant. */
export const getWorkflow = query({
	args: { id: v.id("inquiries") },
	handler: async (ctx, { id }) => {
		const inquiry = await requireWorkflowAdmin(ctx, id);
		const client = inquiry.clientId ? await ctx.db.get(inquiry.clientId) : null;
		return { inquiry, client: client?.siteUrl === inquiry.siteUrl ? client : null };
	},
});

export const clientOptions = query({
	args: { id: v.id("inquiries"), paginationOpts: paginationOptsValidator },
	handler: async (ctx, { id, paginationOpts }) => {
		const inquiry = await requireWorkflowAdmin(ctx, id);
		const result = await ctx.db.query("photographyClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", inquiry.siteUrl))
			.order("desc").paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, 50), maximumRowsRead: 50 });
		return { ...result, page: result.page.map((client) => ({ _id: client._id, name: client.name, email: client.email })) };
	},
});

export const linkClient = mutation({
	args: { id: v.id("inquiries"), clientId: v.optional(v.id("photographyClients")), category: categoryValidator },
	handler: async (ctx, { id, clientId, category }) => {
		const inquiry = await requireWorkflowAdmin(ctx, id);
		// A repeated click or lost HTTP acknowledgement cannot create another lead.
		if (inquiry.clientId) {
			if (clientId && clientId !== inquiry.clientId) throw new Error("Inquiry is already linked to another client");
			return inquiry.clientId;
		}
		if (clientId) {
			const client = await ctx.db.get(clientId);
			if (!client || client.siteUrl !== inquiry.siteUrl) throw new Error("Client not found");
		} else {
			clientId = await ctx.db.insert("photographyClients", {
				siteUrl: inquiry.siteUrl, name: inquiry.name, email: inquiry.email,
				phone: inquiry.phone, category, status: "lead", source: "website inquiry",
				notes: [inquiry.subject, inquiry.message].filter(Boolean).join("\n\n"),
			});
		}
		await ctx.db.patch(id, { clientId, linkedAt: Date.now(), status: inquiry.status === "new" ? "read" : inquiry.status });
		await logActivity(ctx, {
			siteUrl: inquiry.siteUrl, clientId, action: "inquiry_linked",
			description: `website inquiry: ${inquiry.subject || "no subject"}\n\n${inquiry.message}`,
			metadata: JSON.stringify({ docType: "inquiry", docId: id }),
		});
		return clientId;
	},
});

export const updateFollowUp = mutation({
	args: { id: v.id("inquiries"), date: v.union(v.string(), v.null()), notes: v.string(), completed: v.boolean() },
	handler: async (ctx, { id, date, notes, completed }) => {
		await requireWorkflowAdmin(ctx, id);
		if (date) validateFollowUpDate(date);
		if (notes.length > 5000) throw new Error("Notes must be at most 5000 characters");
		await ctx.db.patch(id, {
			followUpDate: completed ? undefined : date || undefined,
			followUpCompletedAt: completed ? Date.now() : undefined,
			internalNotes: notes.trim() || undefined,
		});
	},
});

export const unlinkClient = mutation({
	args: { id: v.id("inquiries"), expectedClientId: v.id("photographyClients") },
	handler: async (ctx, { id, expectedClientId }) => {
		const inquiry = await requireWorkflowAdmin(ctx, id);
		if (!inquiry.clientId) return;
		if (inquiry.clientId !== expectedClientId) throw new Error("Client link changed. Reload before unlinking.");
		await ctx.db.patch(id, { clientId: undefined, linkedAt: undefined });
		const prior = await ctx.db.get(expectedClientId);
		if (prior?.siteUrl === inquiry.siteUrl) await logActivity(ctx, {
			siteUrl: inquiry.siteUrl, clientId: expectedClientId, action: "inquiry_unlinked",
			description: `website inquiry unlinked: ${inquiry.subject || "no subject"}`,
			metadata: JSON.stringify({ docType: "inquiry", docId: id }),
		});
	},
});

export const listForClient = query({
	args: { clientId: v.id("photographyClients"), paginationOpts: paginationOptsValidator },
	handler: async (ctx, { clientId, paginationOpts }) => {
		const { client } = await requireDocumentSiteAdminWithClient(ctx, "photographyClients", clientId, "inquiries");
		if (client.tier !== "full") throw new Error("Full CRM access is required");
	assertClientFeature(client, "crm");
		return await ctx.db.query("inquiries").withIndex("by_clientId", (q) => q.eq("clientId", clientId))
			.order("desc").paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, 25), maximumRowsRead: 25 });
	},
});

// Count new inquiries. Previously `.collect().length` — which is both a
// DoS vector on a public-writable table and a Convex anti-pattern. Bounded
// to 99 (a typical admin-badge ceiling — UI can render "99+" if returned).
// Returns a plain number to preserve the existing caller contract. See
// audit H11.
export const countNew = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireSiteAdmin(ctx, siteUrl, "inquiries");
		const CAP = 99;
		const rows = await ctx.db
			.query("inquiries")
			.withIndex("by_siteUrl_status", (q) =>
				q.eq("siteUrl", siteUrl).eq("status", "new"),
			)
			.take(CAP);
		return rows.length;
	},
});

// Admin-only: update an inquiry's triage status (new → read → replied).
// Replaces the old Sanity-backed PATCH /api/admin/inquiries/[id] endpoint,
// which silently no-op'd because the id passed in was a Convex id, not a
// Sanity doc id. See audit #50.
export const updateStatus = mutation({
	args: {
		id: v.id("inquiries"),
		status: v.union(v.literal("new"), v.literal("read"), v.literal("replied")),
	},
	handler: async (ctx, { id, status }) => {
		await requireDocumentSiteAdmin(ctx, "inquiries", id, "inquiries");
		await ctx.db.patch(id, { status });
	},
});

/** Removes the stored inquiry only; sent messages and audit records remain separate. */
export const remove = mutation({
	args: { id: v.id("inquiries") },
	handler: async (ctx, { id }) => {
		await requireDocumentSiteAdmin(ctx, "inquiries", id, "inquiries");
		const notice=await ctx.db.query("inquiryNotifications").withIndex("by_inquiryId",q=>q.eq("inquiryId",id)).unique();
  if(notice) await ctx.db.delete(notice._id);
  await ctx.db.delete(id);
		return { deleted: true };
	},
});
