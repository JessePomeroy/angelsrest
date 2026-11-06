import { type PaginationOptions, paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { ClientFeature } from "../src/clientFeatures";
import type { Doc, Id } from "./_generated/dataModel";
import { type QueryCtx, query } from "./_generated/server";
import { assertClientFeature, requireDocumentSiteAdminWithClient } from "./authHelpers";
import { invoicePaymentBalance } from "./helpers/invoicePayments";

const args = {
	clientId: v.id("photographyClients"),
	paginationOpts: paginationOptsValidator,
};

async function authorizeClient(
	ctx: QueryCtx,
	clientId: Id<"photographyClients">,
	feature: ClientFeature,
) {
	const { doc, client } = await requireDocumentSiteAdminWithClient(
		ctx,
		"photographyClients",
		clientId,
		"crm",
	);
	assertClientFeature(client, feature);
	return doc.siteUrl;
}

function pageOptions(options: PaginationOptions) {
	if (!Number.isInteger(options.numItems) || options.numItems < 1 || options.numItems > 50) {
		throw new Error("Client workspace pages must contain 1 to 50 records");
	}
	return { ...options, maximumRowsRead: 50, maximumBytesRead: 1_000_000 };
}

function assertRecordScope(
	rows: ReadonlyArray<{ siteUrl: string; clientId: Id<"photographyClients"> }>,
	siteUrl: string,
	clientId: Id<"photographyClients">,
) {
	// A client index is not permission for a malformed cross-site relationship.
	if (rows.some((row) => row.siteUrl !== siteUrl || row.clientId !== clientId)) {
		throw new Error("Client workspace record ownership does not match");
	}
}

function invoiceBalance(invoice: Doc<"invoices">) {
	try {
		return invoicePaymentBalance(invoice);
	} catch {
		// Historical amounts can be incomplete. Unknown must not look like zero owed.
		return null;
	}
}

export const listInvoices = query({
	args,
	handler: async (ctx, { clientId, paginationOpts }) => {
		const siteUrl = await authorizeClient(ctx, clientId, "invoicing");
		const result = await ctx.db
			.query("invoices")
			.withIndex("by_client", (q) => q.eq("clientId", clientId))
			.order("desc")
			.paginate(pageOptions(paginationOpts));
		assertRecordScope(result.page, siteUrl, clientId);
		return {
			...result,
			clientId,
			siteUrl,
			page: result.page.map((row) => ({
				_id: row._id,
				_creationTime: row._creationTime,
				invoiceNumber: row.invoiceNumber,
				invoiceType: row.invoiceType,
				status: row.status,
				dueDate: row.dueDate ?? null,
				balance: invoiceBalance(row),
			})),
		};
	},
});

export const listQuotes = query({
	args,
	handler: async (ctx, { clientId, paginationOpts }) => {
		const siteUrl = await authorizeClient(ctx, clientId, "quotes");
		const result = await ctx.db
			.query("quotes")
			.withIndex("by_client", (q) => q.eq("clientId", clientId))
			.order("desc")
			.paginate(pageOptions(paginationOpts));
		assertRecordScope(result.page, siteUrl, clientId);
		return {
			...result,
			clientId,
			siteUrl,
			page: result.page.map((row) => ({
				_id: row._id,
				_creationTime: row._creationTime,
				quoteNumber: row.quoteNumber,
				status: row.status,
				validUntil: row.validUntil ?? null,
			})),
		};
	},
});

export const listContracts = query({
	args,
	handler: async (ctx, { clientId, paginationOpts }) => {
		const siteUrl = await authorizeClient(ctx, clientId, "contracts");
		const result = await ctx.db
			.query("contracts")
			.withIndex("by_client", (q) => q.eq("clientId", clientId))
			.order("desc")
			.paginate(pageOptions(paginationOpts));
		assertRecordScope(result.page, siteUrl, clientId);
		return {
			...result,
			clientId,
			siteUrl,
			page: result.page.map((row) => ({
				_id: row._id,
				_creationTime: row._creationTime,
				title: row.title,
				status: row.status,
				eventDate: row.eventDate ?? null,
				signedAt: row.signedAt ?? null,
			})),
		};
	},
});

export const listDeliveryGalleries = query({
	args,
	handler: async (ctx, { clientId, paginationOpts }) => {
		const siteUrl = await authorizeClient(ctx, clientId, "galleryDelivery");
		const result = await ctx.db
			.query("galleries")
			.withIndex("by_client", (q) => q.eq("clientId", clientId))
			.order("desc")
			.paginate(pageOptions(paginationOpts));
		assertRecordScope(result.page, siteUrl, clientId);
		return {
			...result,
			clientId,
			siteUrl,
			page: result.page.map((row) => ({
				_id: row._id,
				_creationTime: row._creationTime,
				name: row.name,
				status: row.status,
				imageCount: row.imageCount,
				expiresAt: row.expiresAt ?? null,
				proofSubmittedAt: row.proofSubmittedAt ?? null,
			})),
		};
	},
});
