import { logActivity } from "./activityLog";
import { calculateInvoiceAmounts } from "../src/invoiceAmounts";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireSiteAdmin, requireWebhookCallerOrAuth } from "./authHelpers";
import { deleteDocument } from "./helpers/deleting";
import { allocateNextInvoiceNumber, previewNextInvoiceNumber } from "./helpers/documentNumbering";
import { markDocumentSent } from "./helpers/marking";
import { patchDocument } from "./helpers/patching";
import {
	invoicePaymentBalance,
	invoiceReceivedCents,
	paidInvoiceStatus,
	preserveLegacyCheckout,
} from "./helpers/invoicePayments";

// Keep in sync with the `invoices.status` union in schema.ts. Widening to
// v.string() here lets nonsense values through arg validation and only fails
// later at patch time (audit H22).
const statusValidator = v.union(
	v.literal("draft"),
	v.literal("sent"),
	v.literal("paid"),
	v.literal("partial"),
	v.literal("overdue"),
	v.literal("canceled"),
);

export const list = query({
	args: {
		siteUrl: v.string(),
		status: v.optional(v.string()),
	},
	handler: async (ctx, { siteUrl, status }) => {
		await requireSiteAdmin(ctx, siteUrl);
		const selectedStatus = statusValidator.members.find((member) => member.value === status)?.value;
		if (status !== undefined && selectedStatus === undefined) return [];
		const documents = ctx.db.query("invoices");
		const matching =
			selectedStatus === undefined
				? documents.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
				: documents.withIndex("by_siteUrl_status", (q) =>
						q.eq("siteUrl", siteUrl).eq("status", selectedStatus),
					);
		const all = await matching.order("desc").take(200);
		return all.map((invoice) => ({
			...invoice,
			clientName: invoice.clientName ?? "unknown",
		}));
	},
});

export const get = query({
	args: { invoiceId: v.id("invoices") },
	handler: async (ctx, { invoiceId }) => {
		const invoice = await ctx.db.get(invoiceId);
		if (!invoice) return null;
		await requireSiteAdmin(ctx, invoice.siteUrl);
		const client = await ctx.db.get(invoice.clientId);
		return {
			...invoice,
			clientName: client?.name ?? "unknown",
			clientEmail: client?.email,
		};
	},
});

export const create = mutation({
	args: {
		siteUrl: v.string(),
		// Compatibility-only preview from older admin clients. The mutation
		// allocates the authoritative value below.
		invoiceNumber: v.optional(v.string()),
		clientId: v.id("photographyClients"),
		invoiceType: v.union(
			v.literal("one-time"),
			v.literal("recurring"),
			v.literal("deposit"),
			v.literal("package"),
			v.literal("milestone"),
		),
		items: v.array(
			v.object({
				description: v.string(),
				quantity: v.number(),
				unitPrice: v.number(),
			}),
		),
		taxPercent: v.optional(v.number()),
		notes: v.optional(v.string()),
		dueDate: v.optional(v.string()),
		recurring: v.optional(
			v.object({
				interval: v.union(
					v.literal("weekly"),
					v.literal("monthly"),
					v.literal("quarterly"),
					v.literal("yearly"),
				),
				nextDueDate: v.optional(v.string()),
				endDate: v.optional(v.string()),
			}),
		),
		depositPercent: v.optional(v.number()),
		totalProject: v.optional(v.number()),
		milestoneName: v.optional(v.string()),
		milestoneIndex: v.optional(v.number()),
		parentInvoiceId: v.optional(v.id("invoices")),
	},
	handler: async (ctx, args) => {
		await requireSiteAdmin(ctx, args.siteUrl);
		const client = await ctx.db.get(args.clientId);
		if (!client || client.siteUrl !== args.siteUrl) {
			throw new Error("Client not found");
		}
		calculateInvoiceAmounts(args.items, args.taxPercent);
		const invoiceNumber = await allocateNextInvoiceNumber(ctx, args.siteUrl);
		const invoiceId = await ctx.db.insert("invoices", {
			...args,
			invoiceNumber,
			clientName: client.name,
			status: "draft",
		});

		await logActivity(ctx, {
			siteUrl: args.siteUrl,
			clientId: args.clientId,
			action: "invoice_created",
			description: `invoice ${invoiceNumber} created`,
			metadata: JSON.stringify({ docType: "invoice", docId: invoiceId }),
		});

		return invoiceId;
	},
});

export const update = mutation({
	args: {
		invoiceId: v.id("invoices"),
		siteUrl: v.string(),
		items: v.optional(
			v.array(
				v.object({
					description: v.string(),
					quantity: v.number(),
					unitPrice: v.number(),
				}),
			),
		),
		taxPercent: v.optional(v.number()),
		notes: v.optional(v.string()),
		dueDate: v.optional(v.string()),
		status: v.optional(statusValidator),
	},
	handler: async (ctx, { invoiceId, siteUrl, ...updates }) => {
		const previous = await patchDocument(ctx, invoiceId, siteUrl, updates);
		await preserveLegacyCheckout(ctx, previous);
		const previousPaidCents = invoiceReceivedCents(previous);
		if (previous.paidAmount === undefined && previous.status === "paid")
			await ctx.db.patch(invoiceId, { paidAmount: previousPaidCents });
		const items = updates.items ?? previous.items;
		const taxPercent = updates.taxPercent ?? previous.taxPercent;
		const changed =
			JSON.stringify(items) !== JSON.stringify(previous.items) ||
			(taxPercent ?? 0) !== (previous.taxPercent ?? 0);
		if (updates.items !== undefined || updates.taxPercent !== undefined) {
			// A failed validation rolls back the patch in this atomic mutation.
			calculateInvoiceAmounts(
				updates.items ?? previous.items,
				updates.taxPercent ?? previous.taxPercent,
			);
		}
		if (changed) {
			const { totalCents } = calculateInvoiceAmounts(items, taxPercent);
			const status =
				previousPaidCents > 0
					? paidInvoiceStatus(
							{ ...previous, status: updates.status ?? previous.status },
							previousPaidCents,
							totalCents,
						)
					: (updates.status ?? previous.status);
			await ctx.db.patch(invoiceId, {
				paymentRevision: (previous.paymentRevision ?? 0) + 1,
				paidAmount: previousPaidCents,
				status,
				paidAt: status === "paid" ? (previous.paidAt ?? Date.now()) : undefined,
			});
		}
		if (updates.status !== previous.status) {
			if (updates.status === "paid")
				await ctx.db.patch(invoiceId, {
					status: "paid",
					paidAt: Date.now(),
					paidAmount: Math.max(
						previousPaidCents,
						calculateInvoiceAmounts(items, taxPercent).totalCents,
					),
				});
			if (updates.status === "overdue") await ctx.db.patch(invoiceId, { overdueAt: Date.now() });
		}
		return await ctx.db.get(invoiceId);
	},
});

export const markSent = mutation({
	args: { invoiceId: v.id("invoices"), siteUrl: v.string() },
	handler: async (ctx, { invoiceId, siteUrl }) => {
		await markDocumentSent(
			ctx,
			invoiceId,
			siteUrl,
			"invoice_sent",
			"invoice",
			(invoice) => `invoice ${invoice.invoiceNumber} sent`,
		);
	},
});

export const recordCheckoutStarted = mutation({
	args: {
		invoiceId: v.id("invoices"),
		siteUrl: v.string(),
		stripeCheckoutSessionId: v.string(),
		stripeCheckoutFingerprint: v.string(),
		checkoutId: v.optional(v.id("invoiceCheckouts")),
		webhookSecret: v.string(),
	},
	handler: async (
		ctx,
		{
			invoiceId,
			siteUrl,
			stripeCheckoutSessionId,
			stripeCheckoutFingerprint,
			webhookSecret,
			checkoutId,
		},
	) => {
		await requireWebhookCallerOrAuth(ctx, webhookSecret, { allowAuth: false });
		const invoice = await ctx.db.get(invoiceId);
		if (!invoice || invoice.siteUrl !== siteUrl) {
			throw new Error("Not found");
		}
		if (checkoutId) {
			const checkout = await ctx.db.get(checkoutId);
			if (
				!checkout ||
				checkout.invoiceId !== invoiceId ||
				checkout.siteUrl !== siteUrl ||
				checkout.fingerprint !== stripeCheckoutFingerprint ||
				(checkout.stripeSessionId && checkout.stripeSessionId !== stripeCheckoutSessionId)
			) {
				throw new Error("Invoice checkout session mismatch");
			}
			const bound = await ctx.db
				.query("invoiceCheckouts")
				.withIndex("by_siteUrl_and_stripeSessionId", (q) =>
					q.eq("siteUrl", siteUrl).eq("stripeSessionId", stripeCheckoutSessionId),
				)
				.unique();
			if (bound && bound._id !== checkoutId)
				throw new Error("Invoice checkout session already bound");
			await ctx.db.patch(checkoutId, { stripeSessionId: stripeCheckoutSessionId });
			// A webhook can win this race. Registration never reopens a paid invoice.
			return;
		}
		if (invoice.status === "paid") {
			throw new Error("Invoice has already been paid");
		}
		if (invoice.status !== "sent" && invoice.status !== "overdue") {
			throw new Error("Invoice is not payable");
		}
		const now = Date.now();
		await preserveLegacyCheckout(ctx, invoice);
		await ctx.db.patch(invoiceId, {
			stripeCheckoutSessionId,
			stripeCheckoutFingerprint,
			stripeCheckoutStatus: "open",
			stripeCheckoutStartedAt: invoice.stripeCheckoutStartedAt ?? now,
			stripeCheckoutUpdatedAt: now,
		});
		await preserveLegacyCheckout(ctx, {
			...invoice,
			stripeCheckoutSessionId,
			stripeCheckoutFingerprint,
			stripeCheckoutStatus: "open",
		});
	},
});

/** Snapshot the current balance before provider I/O; retries reuse its immutable identity. */
export const prepareCheckout = mutation({
	args: {
		invoiceId: v.id("invoices"),
		siteUrl: v.string(),
		webhookSecret: v.string(),
		stripeAccountId: v.optional(v.string()),
		origin: v.string(),
	},
	handler: async (ctx, { invoiceId, siteUrl, webhookSecret, stripeAccountId, origin }) => {
		await requireWebhookCallerOrAuth(ctx, webhookSecret, { allowAuth: false });
		const invoice = await ctx.db.get(invoiceId);
		if (!invoice || invoice.siteUrl !== siteUrl) throw new Error("Not found");
		if (!["sent", "overdue", "partial"].includes(invoice.status))
			throw new Error("Invoice is not payable");
		const balance = invoicePaymentBalance(invoice);
		if (balance.remainingCents < 50)
			throw new Error("Invoice balance must be at least $0.50 to pay online.");
		await preserveLegacyCheckout(ctx, invoice);
		const revision = invoice.paymentRevision ?? 0;
		const current = invoice.activeCheckoutId ? await ctx.db.get(invoice.activeCheckoutId) : null;
		if (
			current &&
			current.revision === revision &&
			current.paidBeforeCents === balance.paidCents &&
			current.stripeAccountId === stripeAccountId &&
			current.origin === origin &&
			current.paidAt === undefined
		) {
			if (current.expiresAt !== undefined && Date.now() < current.expiresAt * 1000 - 60_000)
				return current;
			// Replaying an unknown creation after Stripe's idempotency window could charge twice.
			if (!current.stripeSessionId)
				throw new Error("Invoice checkout needs reconciliation before retry");
		}
		const fingerprint = `${revision}:${balance.paidCents}:${balance.totalCents}`;
		const id = await ctx.db.insert("invoiceCheckouts", {
			invoiceId,
			siteUrl,
			legacy: false,
			revision,
			fingerprint,
			items: invoice.items,
			taxPercent: invoice.taxPercent ?? 0,
			totalCents: balance.totalCents,
			paidBeforeCents: balance.paidCents,
			amountCents: balance.remainingCents,
			stripeAccountId,
			origin,
			expiresAt: Math.floor(Date.now() / 1000) + 23 * 60 * 60,
		});
		await ctx.db.patch(invoiceId, { activeCheckoutId: id });
		const checkout = await ctx.db.get(id);
		if (!checkout) throw new Error("Invoice checkout snapshot missing");
		return checkout;
	},
});

/**
 * Mark an invoice paid. Called by:
 *   - The Stripe webhook on `checkout.session.completed` (passes
 *     `webhookSecret`) — customer paid via the portal.
 *   - The admin UI ("mark paid" button) — uses an authenticated session.
 *
 * Audit C4 pattern: either webhook secret or admin session is required.
 */
export const markPaid = mutation({
	args: {
		invoiceId: v.id("invoices"),
		siteUrl: v.string(),
		webhookSecret: v.optional(v.string()),
		stripeCheckoutSessionId: v.optional(v.string()),
		stripeCheckoutFingerprint: v.optional(v.string()),
		checkoutId: v.optional(v.id("invoiceCheckouts")),
		paidCents: v.optional(v.number()),
		currency: v.optional(v.string()),
		stripeAccountId: v.optional(v.string()),
		paymentIntentId: v.optional(v.string()),
	},
	handler: async (
		ctx,
		{
			invoiceId,
			siteUrl,
			webhookSecret,
			stripeCheckoutSessionId,
			stripeCheckoutFingerprint,
			checkoutId,
			paidCents,
			currency,
			stripeAccountId,
			paymentIntentId,
		},
	) => {
		const auth = await requireWebhookCallerOrAuth(ctx, webhookSecret);
		if (auth.via === "auth") {
			await requireSiteAdmin(ctx, siteUrl);
		}
		const invoice = await ctx.db.get(invoiceId);
		if (!invoice || invoice.siteUrl !== siteUrl) {
			throw new Error("Not found");
		}
		if (stripeCheckoutSessionId) {
			if (auth.via !== "webhook")
				throw new Error("Provider payment evidence requires webhook authorization");
			await preserveLegacyCheckout(ctx, invoice);
			const checkout = checkoutId
				? await ctx.db.get(checkoutId)
				: await ctx.db
						.query("invoiceCheckouts")
						.withIndex("by_siteUrl_and_stripeSessionId", (q) =>
							q.eq("siteUrl", siteUrl).eq("stripeSessionId", stripeCheckoutSessionId),
						)
						.unique();
			if (
				!checkout ||
				checkout.invoiceId !== invoiceId ||
				checkout.siteUrl !== siteUrl ||
				(checkout.stripeSessionId && checkout.stripeSessionId !== stripeCheckoutSessionId)
			)
				throw new Error("Invoice checkout session mismatch");
			if (checkout.fingerprint !== (stripeCheckoutFingerprint ?? ""))
				throw new Error("Invoice checkout fingerprint mismatch");
			if (!checkout.legacy && checkout.stripeAccountId !== stripeAccountId)
				throw new Error("Invoice checkout account mismatch");
			if (checkout.paidAt !== undefined && checkout.paidCents === undefined) return; // historical completed settlement
			// Older hub handlers omit amount/currency. Only a fingerprint-proven frozen
			// legacy session can supply that evidence during the backend-first rollout.
			if (
				paidCents === undefined &&
				currency === undefined &&
				checkout.legacy &&
				checkout.amountCents !== undefined
			) {
				paidCents = checkout.amountCents;
				currency = "usd";
			}
			if (
				!Number.isSafeInteger(paidCents) ||
				paidCents === undefined ||
				paidCents <= 0 ||
				currency !== "usd"
			)
				throw new Error("Verified invoice payment amount and currency are required");
			if (checkout.amountCents !== undefined && checkout.amountCents !== paidCents)
				throw new Error("Invoice payment amount mismatch");
			if (checkout.paidAt !== undefined) {
				if (
					checkout.paidCents !== paidCents ||
					(checkout.paymentIntentId &&
						paymentIntentId &&
						checkout.paymentIntentId !== paymentIntentId)
				)
					throw new Error("Invoice payment replay mismatch");
				return;
			}
			const alreadyBound = await ctx.db
				.query("invoiceCheckouts")
				.withIndex("by_siteUrl_and_stripeSessionId", (q) =>
					q.eq("siteUrl", siteUrl).eq("stripeSessionId", stripeCheckoutSessionId),
				)
				.unique();
			if (alreadyBound && alreadyBound._id !== checkout._id)
				throw new Error("Invoice checkout session already bound");
			const balance = invoicePaymentBalance(invoice);
			const totalPaid = balance.paidCents + paidCents;
			if (!Number.isSafeInteger(totalPaid))
				throw new Error("Invoice payment exceeds safe cent precision");
			const now = Date.now();
			const status = paidInvoiceStatus(invoice, totalPaid, balance.totalCents);
			await ctx.db.patch(checkout._id, {
				stripeSessionId: stripeCheckoutSessionId,
				paidCents,
				paidAt: now,
				paymentIntentId,
			});
			await ctx.db.patch(invoiceId, {
				paidAmount: totalPaid,
				status,
				paidAt: status === "paid" ? (invoice.paidAt ?? now) : undefined,
				...(invoice.stripeCheckoutSessionId === stripeCheckoutSessionId
					? { stripeCheckoutStatus: "paid" as const }
					: {}),
			});
			await logActivity(ctx, {
				siteUrl,
				clientId: invoice.clientId,
				action: "invoice_payment_received",
				description: `invoice ${invoice.invoiceNumber}: received ${paidCents} cents; ${Math.max(0, balance.totalCents - totalPaid)} cents remaining${totalPaid > balance.totalCents ? "; overpayment requires review" : ""}${status === "canceled" ? "; canceled invoice requires review" : ""}`,
				metadata: JSON.stringify({
					docType: "invoice",
					docId: invoiceId,
					checkoutId: checkout._id,
				}),
			});
			return;
		}
		if (auth.via !== "auth") throw new Error("Provider checkout session is required");
		if (invoice.status === "paid") {
			// Repeated manual settlement does not add another payment.
			return;
		}
		const now = Date.now();
		await ctx.db.patch(invoiceId, {
			status: "paid",
			paidAt: now,
			paidAmount: Math.max(
				invoicePaymentBalance(invoice).paidCents,
				calculateInvoiceAmounts(invoice.items, invoice.taxPercent).totalCents,
			),
		});

		await logActivity(ctx, {
			siteUrl: invoice.siteUrl,
			clientId: invoice.clientId,
			action: "invoice_paid",
			description: `invoice ${invoice.invoiceNumber} marked as paid`,
			metadata: JSON.stringify({ docType: "invoice", docId: invoiceId }),
		});
	},
});

export const remove = mutation({
	args: { invoiceId: v.id("invoices"), siteUrl: v.string() },
	handler: async (ctx, { invoiceId, siteUrl }) => {
		await requireSiteAdmin(ctx, siteUrl);
		const invoice = await ctx.db.get(invoiceId);
		if (!invoice || invoice.siteUrl !== siteUrl) throw new Error("Not found");
		if (
			invoice.activeCheckoutId ||
			invoice.stripeCheckoutSessionId ||
			(invoice.paidAmount ?? 0) > 0 || invoice.paidAt !== undefined || invoice.status === "paid" || invoice.status === "partial"
		)
			throw new Error("Invoices with payment history must be retained; cancel instead");
		const sourceQuote = await ctx.db.query("quotes").withIndex("by_convertedToInvoice", q => q.eq("convertedToInvoice", invoiceId)).first();
		if (sourceQuote) throw new Error("Invoices linked to retained quotes must be retained");
		await deleteDocument(ctx, invoiceId, siteUrl);
	},
});

export const getNextNumber = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireSiteAdmin(ctx, siteUrl);
		return previewNextInvoiceNumber(ctx, siteUrl);
	},
});
