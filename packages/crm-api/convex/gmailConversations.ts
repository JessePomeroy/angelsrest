import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, type QueryCtx, query } from "./_generated/server";
import { requireDocumentSiteAdmin, requireSiteAdmin } from "./authHelpers";
import { connectionError } from "./helpers/gmail/connection";
import { filePolicy, gmailExpiresAt, gmailPolicy, gmailWorkflow, requirePilotAddress } from "./helpers/gmail/policy";

export const recordArgs = {
	inquiryId: v.optional(v.id("inquiries")),
	clientId: v.optional(v.id("photographyClients")),
};
export async function gmailRecord(
	ctx: QueryCtx | MutationCtx,
	args: { inquiryId?: Id<"inquiries">; clientId?: Id<"photographyClients"> },
) {
	if (Boolean(args.inquiryId) === Boolean(args.clientId))
		throw new Error("Choose one inquiry or client");
	if (args.inquiryId) {
		const record = await requireDocumentSiteAdmin(ctx, "inquiries", args.inquiryId, "inquiries");
		return {
			siteUrl: record.siteUrl,
			recipient: record.email.trim().toLowerCase(),
			subject: record.subject?.trim() || "Your inquiry",
			inquiryId: record._id,
			clientId: record.clientId,
		};
	}
	if (!args.clientId) throw new Error("Client is required");
	const record = await requireDocumentSiteAdmin(ctx, "photographyClients", args.clientId, "crm");
	return {
		siteUrl: record.siteUrl,
		recipient: (record.email ?? "").trim().toLowerCase(),
		subject: `Conversation with ${record.name}`,
		inquiryId: undefined,
		clientId: record._id,
	};
}
export async function gmailConversation(ctx: QueryCtx | MutationCtx, id: Id<"gmailConversations">) {
	const conversation = await requireDocumentSiteAdmin(ctx, "gmailConversations", id);
	const record = await gmailRecord(
		ctx,
		conversation.inquiryId
			? { inquiryId: conversation.inquiryId }
			: { clientId: conversation.clientId },
	);
	if (record.siteUrl !== conversation.siteUrl) throw new Error("Conversation unavailable");
	return {
		conversation,
		record,
		identity: (await requireSiteAdmin(ctx, conversation.siteUrl)).identity,
	};
}
const safeMailbox = (m: Doc<"gmailMailboxes"> | null) =>
	m
		? {
				address: m.address,
				status: m.status,
				lastSyncAt: m.lastSyncAt ?? null,
				watchExpiresAt: m.watchExpiresAt,
				problem: m.syncError ?? null,
				recovering: Boolean(m.resync || m.pending || m.pageToken || m.forceRecovery || m.catchingUp),
				lastNoticeAt: m.lastNoticeAt ?? null,
				leaseExpiresAt: m.leaseExpiresAt ?? null,
				progress: m.pending ? { completed: m.pending.offset, total: m.pending.refs.length } : null,
				dataDeletionRequested: Boolean(m.dataDeletionRequestedAt),
			}
		: null;

export const connection = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireSiteAdmin(ctx, siteUrl);
		const mailbox = await ctx.db
			.query("gmailMailboxes")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.unique();
		return { mailbox: safeMailbox(mailbox), policy: gmailPolicy };
	},
});
export const list = query({
	args: { ...recordArgs, paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		await gmailRecord(ctx, args);
		const q = args.inquiryId
			? ctx.db
					.query("gmailConversations")
					.withIndex("by_inquiryId", (q) => q.eq("inquiryId", args.inquiryId))
			: ctx.db
					.query("gmailConversations")
					.withIndex("by_clientId", (q) => q.eq("clientId", args.clientId));
		return q.order("desc").paginate({
			...args.paginationOpts,
			numItems: Math.min(25, args.paginationOpts.numItems),
			maximumRowsRead: 25,
		});
	},
});
export const create = mutation({
	args: recordArgs,
	handler: async (ctx, args) => {
		const record = await gmailRecord(ctx, args);
		if (record.subject.length > 200 || /[\r\n\0]/.test(record.subject))
			throw new Error("The record subject must be a single line under 200 characters");
		const mailbox = await ctx.db
			.query("gmailMailboxes")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", record.siteUrl))
			.unique();
		if (!mailbox || mailbox.status !== "connected" || mailbox.dataDeletionRequestedAt) throw new Error("Connect Gmail first");
		requirePilotAddress("MAILBOXES", mailbox.address);
		requirePilotAddress("RECIPIENTS", record.recipient);
		const existing = args.inquiryId
			? await ctx.db
					.query("gmailConversations")
					.withIndex("by_inquiryId", (q) => q.eq("inquiryId", args.inquiryId))
					.order("desc")
					.take(100)
			: await ctx.db
					.query("gmailConversations")
					.withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
					.order("desc")
					.take(100);
		const same = existing.find(
			(c) =>
				c.recipient === record.recipient &&
				c.mailboxId === mailbox._id &&
				Boolean(c.inquiryId) === Boolean(args.inquiryId),
		);
		if (same?.deletingAt || (same && gmailExpiresAt(same) <= Date.now()))
			throw new Error("The previous conversation is expiring. Complete its data review first");
		return same?._id ?? ctx.db.insert("gmailConversations", { ...record, mailboxId: mailbox._id, revision: 0 });
	},
});
export const detail = query({
	args: { conversationId: v.id("gmailConversations") },
	handler: async (ctx, { conversationId }) => {
		const { conversation, record, identity } = await gmailConversation(ctx, conversationId);
		const mailbox = await ctx.db.get(conversation.mailboxId);
		const draft = await ctx.db
			.query("gmailDrafts")
			.withIndex("by_conversationId_and_author", (q) =>
				q.eq("conversationId", conversationId).eq("author", identity.tokenIdentifier),
			)
			.unique();
		const attempts = await ctx.db
			.query("gmailSendAttempts")
			.withIndex("by_conversationId", (q) => q.eq("conversationId", conversationId))
			.order("desc")
			.take(10);
		const attempt = attempts[0];
		const files = draft ? await Promise.all(draft.attachmentIds.map((id) => ctx.db.get(id))) : [];
		return {
			conversation,
			mailbox: safeMailbox(mailbox),
			policy: gmailPolicy,
			expiresAt: gmailExpiresAt(conversation),
			recipientChanged: record.recipient !== conversation.recipient,
			draft: draft
				? {
						text: draft.text,
						revision: draft.revision,
						attachments: files
							.filter((f) => f !== null)
							.map((f) => ({
								_id: f._id,
								name: f.name,
								type: f.type,
								size: f.size,
								status: f.status,
								problem: f.problem,
								sha256: f.sha256,
							})),
					}
				: { text: "", revision: 0, attachments: [] },
			attempt: attempt
				? { _id: attempt._id, status: attempt.status, problem: attempt.problem ?? null,
					rfcId: attempt.rfcId, startedAt: attempt.startedAt ?? null,
					checkedAt: attempt.checkedAt ?? null, checkOutcome: attempt.checkOutcome ?? null }
				: null,
		};
	},
});
export const messages = query({
	args: { conversationId: v.id("gmailConversations"), paginationOpts: paginationOptsValidator },
	handler: async (ctx, { conversationId, paginationOpts }) => {
		await gmailConversation(ctx, conversationId);
		const page = await ctx.db
			.query("gmailMessages")
			.withIndex("by_conversationId_and_date", (q) => q.eq("conversationId", conversationId))
			.order("desc")
			.paginate({
				...paginationOpts,
				numItems: Math.min(25, paginationOpts.numItems),
				maximumRowsRead: 25,
			});
		return {
			...page,
			page: await Promise.all(
				page.page.map(async (m) => ({
					...m,
					attachments: (
						await ctx.db
							.query("gmailAttachments")
							.withIndex("by_messageId", (q) => q.eq("messageId", m._id))
							.take(20)
					).map((f) => ({
						_id: f._id,
						name: f.name,
						type: f.type,
						size: f.size,
						status: f.status,
						problem: f.problem,
						sha256: f.sha256,
					})),
				})),
			),
		};
	},
});
export const saveDraft = mutation({
	args: {
		conversationId: v.id("gmailConversations"),
		text: v.string(),
		attachmentIds: v.array(v.id("gmailAttachments")),
		expectedRevision: v.number(),
	},
	handler: async (ctx, args) => {
		const { identity, conversation } = await gmailConversation(ctx, args.conversationId);
		if (conversation.deletingAt || gmailExpiresAt(conversation) <= Date.now()) throw new Error("Conversation retention has ended; export or review the retained send evidence");
		if (
			args.text.length > gmailPolicy.bodyCharacters ||
			args.attachmentIds.length > gmailPolicy.files ||
			new Set(args.attachmentIds).size !== args.attachmentIds.length
		)
			throw new Error("Draft exceeds the conversation limits");
		let bytes = 0;
		for (const id of args.attachmentIds) {
			const file = await ctx.db.get(id);
			if (
				!file ||
				file.conversationId !== args.conversationId ||
				file.author !== identity.tokenIdentifier ||
				file.messageId
			)
				throw new Error("Attachment is not ready for this draft");
			bytes += file.size;
		}
		if (bytes > gmailPolicy.messageFileBytes) throw new Error("Attachments exceed 6 MiB per reply");
		const draft = await ctx.db
			.query("gmailDrafts")
			.withIndex("by_conversationId_and_author", (q) =>
				q.eq("conversationId", args.conversationId).eq("author", identity.tokenIdentifier),
			)
			.unique();
		if ((draft?.revision ?? 0) !== args.expectedRevision)
			throw new Error("Draft changed in another tab. Reopen this conversation to reload it");
		const revision = args.expectedRevision + 1;
		const value = {
			conversationId: args.conversationId,
			author: identity.tokenIdentifier,
			text: args.text,
			attachmentIds: args.attachmentIds,
			revision,
		};
		if (draft) await ctx.db.replace(draft._id, value);
		else await ctx.db.insert("gmailDrafts", value);
		return revision;
	},
});
export const queueSend = mutation({
	args: {
		conversationId: v.id("gmailConversations"),
		requestId: v.string(),
		draftRevision: v.number(),
		conversationRevision: v.number(),
	},
	handler: async (ctx, args) => {
		const { conversation: c, record, identity } = await gmailConversation(ctx, args.conversationId);
		requirePilotAddress("RECIPIENTS", c.recipient);
		if (c.deletingAt || c.importPending || gmailExpiresAt(c) <= Date.now()) throw new Error("Conversation is not available for sending");
		if (!/^[0-9a-f-]{36}$/i.test(args.requestId)) throw new Error("Invalid send request");
		const same = await ctx.db
			.query("gmailSendAttempts")
			.withIndex("by_conversationId_and_requestId", (q) =>
				q.eq("conversationId", c._id).eq("requestId", args.requestId),
			)
			.unique();
		if (same) return same._id;
		const open = await ctx.db
			.query("gmailSendAttempts")
			.withIndex("by_conversationId", (q) => q.eq("conversationId", c._id))
			.order("desc")
			.take(10);
		if (open.some((a) => ["queued", "submitting", "uncertain"].includes(a.status)))
			throw new Error("Resolve the existing send before sending again");
		const mailbox = await ctx.db.get(c.mailboxId);
		if (
			!mailbox ||
			mailbox.status !== "connected" ||
			mailbox.syncError ||
			mailbox.resync ||
			!mailbox.lastSyncAt ||
			Date.now() - mailbox.lastSyncAt > gmailPolicy.staleAfterMs
		)
			throw new Error("Sync Gmail before sending");
		if (c.problem || record.recipient !== c.recipient || c.revision !== args.conversationRevision)
			throw new Error(
				"Conversation changed. Review the latest messages and recipient before sending",
			);
		const draft = await ctx.db
			.query("gmailDrafts")
			.withIndex("by_conversationId_and_author", (q) =>
				q.eq("conversationId", c._id).eq("author", identity.tokenIdentifier),
			)
			.unique();
		if (
			!draft ||
			draft.revision !== args.draftRevision ||
			(!draft.text.trim() && !draft.attachmentIds.length)
		)
			throw new Error("Save this draft before sending");
		for (const id of draft.attachmentIds) {
			const f = await ctx.db.get(id);
			if (
				!f ||
				f.conversationId !== c._id ||
				f.author !== identity.tokenIdentifier ||
				f.status !== "ready" ||
				!f.storageId ||
				f.messageId
			)
				throw new Error("A selected attachment is unavailable; nothing was sent");
		}
		const id = await ctx.db.insert("gmailSendAttempts", {
			siteUrl: c.siteUrl,
			mailboxId: mailbox._id,
			conversationId: c._id,
			author: identity.tokenIdentifier,
			requestId: args.requestId,
			rfcId: `<${args.requestId}@gmail.angelsrest.invalid>`,
			recipient: c.recipient,
			subject: c.subject,
			text: draft.text,
			parentRfcId: c.lastRfcId,
			threadId: c.threadId,
			attachmentIds: draft.attachmentIds,
			draftRevision: draft.revision,
			conversationRevision: c.revision,
			generation: mailbox.generation,
			status: "queued",
		});
		await ctx.scheduler.runAfter(0, internal.gmailNode.send, { attemptId: id });
		return id;
	},
});
export const requestSync = mutation({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireSiteAdmin(ctx, siteUrl);
		const mailbox = await ctx.db
			.query("gmailMailboxes")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.unique();
		if (!mailbox || mailbox.status !== "connected") throw new Error("Reconnect Gmail first");
		await ctx.scheduler.runAfter(0, internal.gmailNode.sync, { mailboxId: mailbox._id });
	},
});
export const reconcile = mutation({
	args: { attemptId: v.id("gmailSendAttempts") },
	handler: async (ctx, { attemptId }) => {
		const attempt = await requireDocumentSiteAdmin(ctx, "gmailSendAttempts", attemptId);
		await gmailConversation(ctx, attempt.conversationId);
		if (!["submitting", "uncertain"].includes(attempt.status)) return;
		await ctx.scheduler.runAfter(0, internal.gmailNode.reconcile, { attemptId });
	},
});
export const reserveAttachment = mutation({
	args: {
		conversationId: v.id("gmailConversations"),
		name: v.string(),
		type: v.string(),
		size: v.number(),
		sha256: v.string(),
		expectedRevision: v.number(),
	},
	handler: async (ctx, args) => {
		const { conversation, identity } = await gmailConversation(ctx, args.conversationId);
		if (conversation.deletingAt || gmailExpiresAt(conversation) <= Date.now()) throw new Error("Conversation retention has ended");
		const problem = filePolicy(args.name, args.type, args.size);
		if (problem || !/^[a-f0-9]{64}$/.test(args.sha256))
			throw new Error(problem ?? "Invalid file fingerprint");
		const draft = await ctx.db
			.query("gmailDrafts")
			.withIndex("by_conversationId_and_author", (q) =>
				q.eq("conversationId", conversation._id).eq("author", identity.tokenIdentifier),
			)
			.unique();
		if ((draft?.revision ?? 0) !== args.expectedRevision)
			throw new Error("Draft changed; reload it before attaching a file");
		if ((draft?.attachmentIds.length ?? 0) >= gmailPolicy.files)
			throw new Error("At most five files can be selected");
		const files = draft ? await Promise.all(draft.attachmentIds.map((id) => ctx.db.get(id))) : [];
		if (files.reduce((size, f) => size + (f?.size ?? 0), args.size) > gmailPolicy.messageFileBytes)
			throw new Error("Reply attachments exceed 6 MiB");
		if (files.some((f) => f?.sha256 === args.sha256 && f.name === args.name))
			throw new Error("This file is already selected");
		const attachmentId = await ctx.db.insert("gmailAttachments", {
			conversationId: conversation._id,
			name: args.name,
			type: args.type,
			size: args.size,
			sha256: args.sha256,
			siteUrl: conversation.siteUrl,
			author: identity.tokenIdentifier,
			status: "pending",
			expiresAt: Date.now() + 24 * 60 * 60_000,
		});
		const value = {
			conversationId: conversation._id,
			author: identity.tokenIdentifier,
			text: draft?.text ?? "",
			attachmentIds: [...(draft?.attachmentIds ?? []), attachmentId],
			revision: args.expectedRevision + 1,
		};
		if (draft) await ctx.db.replace(draft._id, value);
		else await ctx.db.insert("gmailDrafts", value);
		return { attachmentId, revision: value.revision };
	},
});
export const uploadAccess = query({
	args: { attachmentId: v.id("gmailAttachments") },
	handler: async (ctx, { attachmentId }) => {
		const f = await requireDocumentSiteAdmin(ctx, "gmailAttachments", attachmentId);
		const { identity } = await gmailConversation(ctx, f.conversationId);
		if (f.author !== identity.tokenIdentifier || f.messageId || f.status !== "pending")
			throw new Error("Attachment upload unavailable");
		return { name: f.name, type: f.type, size: f.size, sha256: f.sha256 };
	},
});
export const retryAttachment = mutation({
	args: { attachmentId: v.id("gmailAttachments") },
	handler: async (ctx, { attachmentId }) => {
		const f = await requireDocumentSiteAdmin(ctx, "gmailAttachments", attachmentId);
		const { identity } = await gmailConversation(ctx, f.conversationId);
		if (f.author !== identity.tokenIdentifier || f.messageId || f.storageId)
			throw new Error("Attachment cannot be replaced");
		await ctx.db.patch(f._id, {
			status: "pending",
			problem: undefined,
			expiresAt: Date.now() + 24 * 60 * 60_000,
		});
	},
});
export const attachmentAccess = query({
	args: { attachmentId: v.id("gmailAttachments") },
	handler: async (ctx, { attachmentId }) => {
		const file = await requireDocumentSiteAdmin(ctx, "gmailAttachments", attachmentId);
		const { conversation, identity } = await gmailConversation(ctx, file.conversationId);
		if (file.status !== "ready" || (!file.messageId && file.author !== identity.tokenIdentifier))
			throw new Error("Attachment unavailable");
		return {
			attachmentId,
			mailboxId: conversation.mailboxId,
			name: file.name,
			type: file.type,
			size: file.size,
		};
	},
});
export const beginConnect = mutation({
	args: { siteUrl: v.string(), nonce: v.string() },
	handler: async (ctx, { siteUrl, nonce }) => {
		const { identity } = await requireSiteAdmin(ctx, siteUrl);
		if (!/^[a-zA-Z0-9_-]{43}$/.test(nonce)) throw new Error("Invalid connection request");
		return ctx.db.insert("gmailConnectStates", {
			siteUrl,
			identity: identity.tokenIdentifier,
			nonce,
			used: false,
			expiresAt: Date.now() + 10 * 60_000,
		});
	},
});
export const consumeConnect = mutation({
	args: { id: v.id("gmailConnectStates"), nonce: v.string() },
	handler: async (ctx, { id, nonce }) => {
		const state = await ctx.db.get(id);
		if (!state) throw connectionError("intent_expired", "intent");
		const { identity } = await requireSiteAdmin(ctx, state.siteUrl);
		if (
			state.used ||
			state.expiresAt < Date.now() ||
			state.identity !== identity.tokenIdentifier ||
			state.nonce !== nonce
		)
			throw connectionError("intent_expired", "intent");
		await ctx.db.patch(id, { used: true });
		return state.siteUrl;
	},
});

/** Read authorization for the explicit provider picker; never projects credentials. */
export const linkContext = query({
	args: recordArgs,
	handler: async (ctx, args) => {
		const record = await gmailRecord(ctx, args);
		const { identity } = await requireSiteAdmin(ctx, record.siteUrl);
		const mailbox = await ctx.db.query("gmailMailboxes").withIndex("by_siteUrl", q => q.eq("siteUrl", record.siteUrl)).unique();
		if (!mailbox || mailbox.status !== "connected" || mailbox.dataDeletionRequestedAt) throw new Error("Reconnect Gmail before selecting a thread");
		requirePilotAddress("MAILBOXES", mailbox.address);
		requirePilotAddress("RECIPIENTS", record.recipient);
		const destination = args.inquiryId ? await ctx.db.get(args.inquiryId) : args.clientId ? await ctx.db.get(args.clientId) : null;
		return { ...record, destination: `${args.inquiryId ? "Inquiry" : "Client"}: ${destination?.name ?? record.recipient}`,
			mailboxId: mailbox._id, mailbox: mailbox.address, generation: mailbox.generation, author: identity.tokenIdentifier };
	},
});

export const setWorkflow = mutation({
	args: { conversationId: v.id("gmailConversations"), state: gmailWorkflow, followUpAt: v.union(v.number(), v.null()), expectedRevision: v.number() },
	handler: async (ctx, args) => {
		const { conversation: c } = await gmailConversation(ctx, args.conversationId);
		if (c.deletingAt || c.revision !== args.expectedRevision) throw new Error("Conversation changed. Review the latest message before updating its status");
		if (args.followUpAt !== null && (!Number.isSafeInteger(args.followUpAt) || args.followUpAt < 0 || args.followUpAt > Date.now() + 2 * 366 * 86400000))
			throw new Error("Choose a valid follow-up date within two years");
		await ctx.db.patch(c._id, { workflowState: args.state, followUpAt: args.followUpAt ?? undefined, revision: c.revision + 1 });
	},
});

export const queue = query({
	args: { siteUrl: v.string(), state: v.optional(gmailWorkflow), paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		await requireSiteAdmin(ctx, args.siteUrl);
		const query = args.state
			? ctx.db.query("gmailConversations").withIndex("by_siteUrl_and_workflowState_and_followUpAt", q => q.eq("siteUrl", args.siteUrl).eq("workflowState", args.state))
			: ctx.db.query("gmailConversations").withIndex("by_siteUrl", q => q.eq("siteUrl", args.siteUrl));
		const page = await query.paginate({ ...args.paginationOpts, numItems: Math.min(25, args.paginationOpts.numItems), maximumRowsRead: 25 });
		const rows = await Promise.all(page.page.map(async c => {
			try { await gmailConversation(ctx, c._id); } catch { return null; }
			if (c.deletingAt) return null;
			const incoming = c.lastIncomingId ? await ctx.db.get(c.lastIncomingId) : null;
			return { _id: c._id, subject: c.subject, recipient: c.recipient, inquiryId: c.inquiryId, clientId: c.clientId,
				state: c.workflowState ?? "done", followUpAt: c.followUpAt ?? null, problem: c.problem ?? null,
				importPending: c.importPending ?? false, retentionHold: Boolean(c.retentionHoldAt),
				incoming: incoming && incoming.conversationId === c._id && !incoming.blocked ? { text: incoming.text.slice(0, 500), date: incoming.date, from: incoming.from } : null };
		}));
		return { ...page, page: rows.filter(row => row !== null) };
	},
});

export const restartRecovery = mutation({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireSiteAdmin(ctx, siteUrl);
		const m = await ctx.db.query("gmailMailboxes").withIndex("by_siteUrl", q => q.eq("siteUrl", siteUrl)).unique();
		if (!m || m.status !== "connected" || m.dataDeletionRequestedAt) throw new Error("Reconnect the same mailbox first");
		await ctx.db.patch(m._id, { forceRecovery: true, generation: m.generation + 1, lease: undefined, leaseExpiresAt: undefined,
			syncError: "Registered history recovery requested. Sending is paused until catch-up completes" });
		await ctx.scheduler.runAfter(0, internal.gmailNode.sync, { mailboxId: m._id });
	},
});

export async function unresolvedSend(ctx: QueryCtx | MutationCtx, conversationId: Id<"gmailConversations">) {
	for (const status of ["queued", "submitting", "uncertain"] as const) {
		const row = await ctx.db.query("gmailSendAttempts").withIndex("by_conversationId_and_status", q => q.eq("conversationId", conversationId).eq("status", status)).first();
		if (row) return row;
	}
	return null;
}
export const requestDeletion = mutation({
	args: { conversationId: v.id("gmailConversations"), confirm: v.literal("delete imported conversation") },
	handler: async (ctx, args) => {
		const { conversation: c } = await gmailConversation(ctx, args.conversationId);
		if (await unresolvedSend(ctx, c._id)) throw new Error("Deletion is on hold: reconcile the existing send without resending or discarding its evidence");
		await ctx.db.patch(c._id, { deletingAt: c.deletingAt ?? Date.now(), revision: c.revision + 1 });
		await ctx.scheduler.runAfter(0, internal.gmailState.eraseConversation, { conversationId: c._id });
		return { deleting: true };
	},
});
export const dataStatus = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireSiteAdmin(ctx, siteUrl);
		const m = await ctx.db.query("gmailMailboxes").withIndex("by_siteUrl", q => q.eq("siteUrl", siteUrl)).unique();
		if (!m) return { hasData: false, holds: [], deleting: false, lastDeletedAt: null };
		const hasData = Boolean(await ctx.db.query("gmailConversations").withIndex("by_mailboxId", q => q.eq("mailboxId", m._id)).first());
		const holds = [];
		for (const status of ["queued", "submitting", "uncertain"] as const) {
			const a = await ctx.db.query("gmailSendAttempts").withIndex("by_mailboxId_and_status", q => q.eq("mailboxId", m._id).eq("status", status)).first();
			if (a) holds.push({ conversationId: a.conversationId, status: a.status });
		}
		return { hasData, holds, deleting: Boolean(m.dataDeletionRequestedAt), lastDeletedAt: m.lastDataDeletionAt ?? null };
	},
});
export const deleteMailboxData = mutation({
	args: { siteUrl: v.string(), confirmAddress: v.string() },
	handler: async (ctx, { siteUrl, confirmAddress }) => {
		await requireSiteAdmin(ctx, siteUrl);
		const m = await ctx.db.query("gmailMailboxes").withIndex("by_siteUrl", q => q.eq("siteUrl", siteUrl)).unique();
		if (!m || confirmAddress !== m.address) throw new Error("Type the exact connected mailbox address");
		if (m.status !== "disconnected" || m.encryptedRefreshToken || (m.connectionBusyUntil ?? 0) > Date.now()) throw new Error("Stop synchronization and wait for it to finish before deleting imported data");
		for (const status of ["queued", "submitting", "uncertain"] as const) {
			if (await ctx.db.query("gmailSendAttempts").withIndex("by_mailboxId_and_status", q => q.eq("mailboxId", m._id).eq("status", status)).first())
				throw new Error("Deletion is on hold for an unresolved send. Its evidence must be retained");
		}
		await ctx.db.patch(m._id, { dataDeletionRequestedAt: m.dataDeletionRequestedAt ?? Date.now(), generation: m.generation + 1,
			lease: undefined, leaseExpiresAt: undefined, pending: undefined, resync: undefined, pageToken: undefined, forceRecovery: undefined });
		await ctx.scheduler.runAfter(0, internal.gmailState.eraseMailboxData, { mailboxId: m._id });
		return { deleting: true };
	},
});

export const exportContext = query({
	args: { conversationId: v.id("gmailConversations") },
	handler: async (ctx, { conversationId }) => {
		const { conversation: c, identity } = await gmailConversation(ctx, conversationId);
		if (c.deletingAt) throw new Error("Deletion has begun; this export is unavailable");
		const draft = await ctx.db.query("gmailDrafts").withIndex("by_conversationId_and_author", q => q.eq("conversationId", c._id).eq("author", identity.tokenIdentifier)).unique();
		return { conversation: c, expiresAt: gmailExpiresAt(c), draft: draft ? { text: draft.text, attachmentIds: draft.attachmentIds, revision: draft.revision } : null };
	},
});
export const exportPage = query({
	args: { conversationId: v.id("gmailConversations"), section: v.union(v.literal("messages"), v.literal("attachments"), v.literal("attempts")), paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		const { conversation: c, identity } = await gmailConversation(ctx, args.conversationId);
		if (c.deletingAt) throw new Error("Deletion has begun");
		const options = { ...args.paginationOpts, numItems: Math.min(25, args.paginationOpts.numItems), maximumRowsRead: 25 };
		if (args.section === "messages") return ctx.db.query("gmailMessages").withIndex("by_conversationId_and_date", q => q.eq("conversationId", c._id)).paginate(options);
		if (args.section === "attachments") {
			const page = await ctx.db.query("gmailAttachments").withIndex("by_conversationId", q => q.eq("conversationId", c._id)).paginate(options);
			return { ...page, page: page.page.filter(f => f.messageId || f.author === identity.tokenIdentifier).map(f => ({
				_id: f._id, messageId: f.messageId, name: f.name, type: f.type, size: f.size, status: f.status, problem: f.problem, sha256: f.sha256,
			})) };
		}
		const page = await ctx.db.query("gmailSendAttempts").withIndex("by_conversationId", q => q.eq("conversationId", c._id)).paginate(options);
		return { ...page, page: page.page.map(a => ({ _id: a._id, createdAt: a._creationTime, rfcId: a.rfcId, recipient: a.recipient,
			subject: a.subject, status: a.status, startedAt: a.startedAt, providerId: a.providerId, problem: a.problem,
			checkedAt: a.checkedAt, checkOutcome: a.checkOutcome, ...(a.author === identity.tokenIdentifier ? { text: a.text, attachmentIds: a.attachmentIds } : {}) })) };
	},
});
