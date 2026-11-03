import type { Infer } from "convex/values";
import { v } from "convex/values";
import { clientFeatureAllowed } from "../src/clientFeatures";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { gmailRecord, recordArgs, unresolvedSend } from "./gmailConversations";
import {
	internalMutation,
	internalQuery,
	type MutationCtx,
	mutation,
	type QueryCtx,
	query,
} from "./_generated/server";
import {
	compareHistory,
	decimalId,
	gmailImportedMessage,
	gmailMessageRef,
	gmailPolicy,
	gmailExpiresAt,
	gmailUploadType,
	mailboxAddress,
	providerId,
	pilotAddressAllowed,
	requirePilotAddress,
	requireGmailServer,
} from "./helpers/gmail/policy";

async function activeMailbox(ctx: QueryCtx | MutationCtx, id: Id<"gmailMailboxes">) {
	const mailbox = await ctx.db.get(id);
	if (!mailbox) throw new Error("Mailbox unavailable");
	const owner = await ctx.db
		.query("platformClients")
		.withIndex("by_siteUrl", (q) => q.eq("siteUrl", mailbox.siteUrl))
		.unique();
	if (!owner || owner.offboarding) throw new Error("Mailbox unavailable");
	return mailbox;
}
async function validTarget(ctx: QueryCtx | MutationCtx, c: Doc<"gmailConversations">) {
	const record = c.inquiryId
		? await ctx.db.get(c.inquiryId)
		: c.clientId
			? await ctx.db.get(c.clientId)
			: null;
	const owner = await ctx.db
		.query("platformClients")
		.withIndex("by_siteUrl", (q) => q.eq("siteUrl", c.siteUrl))
		.unique();
	return Boolean(
		record &&
			pilotAddressAllowed("RECIPIENTS", c.recipient) &&
			!c.deletingAt && gmailExpiresAt(c) > Date.now() &&
			record.siteUrl === c.siteUrl &&
			owner &&
			!owner.offboarding &&
			clientFeatureAllowed(owner, c.inquiryId ? "inquiries" : "crm"),
	);
}
async function leased(ctx: MutationCtx, id: Id<"gmailMailboxes">, lease: string) {
	const m = await activeMailbox(ctx, id);
	if (
		m.status !== "connected" ||
		m.dataDeletionRequestedAt ||
		m.lease !== lease ||
		!m.leaseExpiresAt ||
		m.leaseExpiresAt < Date.now()
	)
		throw new Error("Sync lease expired");
	return m;
}
export const install = internalMutation({
	args: {
		siteUrl: v.string(),
		address: v.string(),
		encryptedRefreshToken: v.string(),
		historyId: v.string(),
		watchExpiresAt: v.number(),
		credentialSource: v.optional(v.union(v.literal("login"), v.literal("mailbox"))),
	},
	handler: async (ctx, a) => {
		decimalId(a.historyId);
		mailboxAddress(a.address);
		const owner = await ctx.db
			.query("platformClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", a.siteUrl))
			.unique();
		if (!owner || owner.offboarding) throw new Error("Mailbox unavailable");
		const old = await ctx.db
			.query("gmailMailboxes")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", a.siteUrl))
			.unique();
		if (old?.dataDeletionRequestedAt) throw new Error("Finish deleting imported Gmail data before reconnecting");
		const other = await ctx.db
			.query("gmailMailboxes")
			.withIndex("by_address", (q) => q.eq("address", a.address))
			.unique();
		if (old?.connectionBusyUntil && old.connectionBusyUntil > Date.now())
			throw new Error("Another mailbox connection action is still finishing");
		if ((other && other.siteUrl !== a.siteUrl) || (old && old.address !== a.address))
			throw new Error(
				"Reconnect the originally connected mailbox; mailbox reassignment requires an operator migration",
			);
		if (old) {
			await ctx.db.patch(old._id, {
				encryptedRefreshToken: a.encryptedRefreshToken,
				credentialSource: a.credentialSource ?? "mailbox",
				generation: old.generation + 1,
				status: "connected",
				watchExpiresAt: a.watchExpiresAt,
				watchRenewedAt: Date.now(),
				lease: undefined,
				leaseExpiresAt: undefined,
				syncError: undefined,
			});
			await ctx.scheduler.runAfter(0, internal.gmailNode.sync, { mailboxId: old._id });
			return old._id;
		}
		const id = await ctx.db.insert("gmailMailboxes", {
			siteUrl: a.siteUrl,
			address: a.address,
			encryptedRefreshToken: a.encryptedRefreshToken,
			credentialSource: a.credentialSource ?? "mailbox",
			generation: 1,
			status: "connected",
			cursor: a.historyId,
			watchExpiresAt: a.watchExpiresAt,
			watchRenewedAt: Date.now(),
			lastSyncAt: Date.now(),
		});
		return id;
	},
});
export const getMailbox = internalQuery({
	args: { mailboxId: v.id("gmailMailboxes") },
	handler: (ctx, { mailboxId }) => activeMailbox(ctx, mailboxId),
});
export const findMailbox = internalQuery({
	args: { address: v.string() },
	handler: (ctx, { address }) =>
		ctx.db
			.query("gmailMailboxes")
			.withIndex("by_address", (q) => q.eq("address", address))
			.unique(),
});
export const acquire = internalMutation({
	args: { mailboxId: v.id("gmailMailboxes"), lease: v.string() },
	handler: async (ctx, { mailboxId, lease }) => {
		const m = await activeMailbox(ctx, mailboxId);
		if (m.status !== "connected" || (m.leaseExpiresAt && m.leaseExpiresAt > Date.now()))
			return null;
		await ctx.db.patch(mailboxId, { lease, leaseExpiresAt: Date.now() + gmailPolicy.leaseMs });
		return m;
	},
});
export const stagePage = internalMutation({
	args: {
		mailboxId: v.id("gmailMailboxes"),
		lease: v.string(),
		kind: v.union(v.literal("history"), v.literal("resync")),
		refs: v.array(gmailMessageRef),
		nextPageToken: v.optional(v.string()),
		done: v.boolean(),
		endHistoryId: v.string(),
		conversationId: v.optional(v.id("gmailConversations")),
	},
	handler: async (ctx, a) => {
		const m = await leased(ctx, a.mailboxId, a.lease);
		if (
			m.pending ||
			a.refs.length > 2000 ||
			(a.nextPageToken?.length ?? 0) > 2048 ||
			a.done === Boolean(a.nextPageToken)
		)
			throw new Error("Invalid history page");
		decimalId(a.endHistoryId);
		if (a.kind === "history" && compareHistory(a.endHistoryId, m.cursor) < 0)
			throw new Error("History moved backwards");
		for (const ref of a.refs) {
			providerId(ref.id);
			providerId(ref.threadId);
		}
		await ctx.db.patch(m._id, {
			pending: {
				kind: a.kind,
				refs: a.refs,
				offset: 0,
				nextPageToken: a.nextPageToken,
				done: a.done,
				endHistoryId: a.endHistoryId,
				conversationId: a.conversationId,
			},
		});
	},
});
export const knownThreads = internalQuery({
	args: { mailboxId: v.id("gmailMailboxes"), threadIds: v.array(v.string()) },
	handler: async (ctx, { mailboxId, threadIds }) => {
		await activeMailbox(ctx, mailboxId);
		if (threadIds.length > 25) throw new Error("Batch exceeds limit");
		const rows = await Promise.all(
			threadIds.map((threadId) =>
				ctx.db
					.query("gmailConversations")
					.withIndex("by_mailboxId_and_threadId", (q) =>
						q.eq("mailboxId", mailboxId).eq("threadId", threadId),
					)
					.unique(),
			),
		);
		const allowed: Doc<"gmailConversations">[] = [];
		for (const row of rows) if (row && (await validTarget(ctx, row))) allowed.push(row);
		return allowed;
	},
});
async function importMessage(
	ctx: MutationCtx,
	m: Doc<"gmailMailboxes">,
	c: Doc<"gmailConversations">,
	message: Infer<typeof gmailImportedMessage>,
	origin: "gmail" | "admin",
) {
	const old = await ctx.db
		.query("gmailMessages")
		.withIndex("by_mailboxId_and_providerId", (q) =>
			q.eq("mailboxId", m._id).eq("providerId", message.providerId),
		)
		.unique();
	if (old) {
		if (old.conversationId !== c._id)
			throw new Error("Message already belongs to a different conversation");
		if (old.origin === "admin" && !message.blocked) {
			if (!old.providerObservedAt) {
				await ctx.db.patch(old._id, { date: message.date, providerObservedAt: Date.now() });
				if (message.sent && message.date >= (c.lastRelevantAt ?? 0))
					await ctx.db.patch(c._id, { workflowState: "waiting", followUpAt: undefined,
						lastRelevantAt: message.date, revision: c.revision + 1 });
			}
			const files = await ctx.db
				.query("gmailAttachments")
				.withIndex("by_messageId", (q) => q.eq("messageId", old._id))
				.take(20);
			if (
				files.length === message.attachments.length &&
				files.every(
					(f, i) =>
						f.name === message.attachments[i].name &&
						f.type === message.attachments[i].type &&
						f.size === message.attachments[i].size &&
						!message.attachments[i].blocked,
				)
			) {
				for (let i = 0; i < files.length; i++) {
					const f = files[i],
						imported = message.attachments[i];
					if (f.storageId) await ctx.storage.delete(f.storageId);
					await ctx.db.patch(f._id, {
						storageId: undefined,
						partId: imported.partId,
						providerAttachmentId: imported.providerAttachmentId,
						inlineData: imported.inlineData,
					});
				}
			}
			if (message.rfcId) {
				await ctx.db.patch(old._id, { rfcId: message.rfcId });
				if (c.lastMessageId === message.providerId)
					await ctx.db.patch(c._id, { lastRfcId: message.rfcId });
			}
		}
		return old._id;
	}
	const { attachments, threadId: _threadId, ...value } = message;
	const id = await ctx.db.insert("gmailMessages", {
		...value,
		siteUrl: m.siteUrl,
		mailboxId: m._id,
		conversationId: c._id,
		origin,
	});
	for (const { blocked, ...f } of attachments)
		await ctx.db.insert("gmailAttachments", {
			...f,
			siteUrl: m.siteUrl,
			conversationId: c._id,
			messageId: id,
			status: blocked ? "blocked" : "ready",
			problem: blocked,
		});
	// Only newly imported, relevant mail changes workflow. Replayed or older history
	// cannot reopen a completed item or clear a newer incoming reply.
	const workflow: Partial<Doc<"gmailConversations">> = {};
	if (!message.blocked && origin === "gmail") {
		if (!message.sent && message.date >= (c.lastIncomingAt ?? 0)) {
			workflow.lastIncomingAt = message.date;
			workflow.lastIncomingId = id;
		}
		if (message.date >= (c.lastRelevantAt ?? 0)) {
			workflow.lastRelevantAt = message.date;
			workflow.workflowState = message.sent ? "waiting" : c.workflowState === "needs_reply" ? "needs_reply" : "review";
			if (message.sent) workflow.followUpAt = undefined;
		}
	}
	if (message.blocked) workflow.problem = message.blocked;
	if (message.date >= (c.lastMessageAt ?? 0))
		await ctx.db.patch(c._id, {
			...workflow,
			lastMessageAt: message.date,
			lastRfcId: message.blocked ? c.lastRfcId : message.rfcId || c.lastRfcId,
			lastMessageId: message.providerId,
			revision: c.revision + 1,
			...(message.blocked ? { problem: message.blocked } : {}),
		});
	else await ctx.db.patch(c._id, { ...workflow, revision: c.revision + 1 });
	return id;
}
export const commitBatch = internalMutation({
	args: {
		mailboxId: v.id("gmailMailboxes"),
		lease: v.string(),
		consumed: v.number(),
		messages: v.array(gmailImportedMessage),
	},
	handler: async (ctx, a) => {
		const m = await leased(ctx, a.mailboxId, a.lease),
			p = m.pending;
		if (
			!p ||
			!Number.isInteger(a.consumed) ||
			a.consumed < 0 ||
			a.consumed > 20 ||
			(a.consumed === 0 && p.refs.length !== p.offset)
		)
			throw new Error("Invalid sync checkpoint");
		const slice = p.refs.slice(p.offset, p.offset + a.consumed);
		if (slice.length !== a.consumed || a.messages.length > slice.length)
			throw new Error("Invalid sync batch");
		for (const message of a.messages) {
			if (!slice.some((r) => r.id === message.providerId && r.threadId === message.threadId))
				throw new Error("Message is outside this checkpoint");
			const c = await ctx.db
				.query("gmailConversations")
				.withIndex("by_mailboxId_and_threadId", (q) =>
					q.eq("mailboxId", m._id).eq("threadId", message.threadId),
				)
				.unique();
			if (!c || c.siteUrl !== m.siteUrl || !(await validTarget(ctx, c))) continue;
			await importMessage(ctx, m, c, message, "gmail");
		}
		const offset = p.offset + a.consumed;
		if (offset >= p.refs.length && p.kind === "resync" && p.conversationId) {
			const c = await ctx.db.get(p.conversationId);
			if (c && c.mailboxId === m._id && !c.deletingAt) await ctx.db.patch(c._id, { importPending: undefined });
		}
		if (offset < p.refs.length) await ctx.db.patch(m._id, { pending: { ...p, offset } });
		else if (p.kind === "resync" && !p.done)
			await ctx.db.patch(m._id, {
				pending: undefined,
				resync: { anchor: p.endHistoryId, conversationCursor: p.nextPageToken },
			});
		else if (p.kind === "history" && !p.done)
			await ctx.db.patch(m._id, { pending: undefined, pageToken: p.nextPageToken });
		else
			await ctx.db.patch(m._id, {
				pending: undefined,
				pageToken: undefined,
				resync: undefined,
				cursor: p.endHistoryId,
				catchingUp: p.kind === "resync" ? true : undefined,
				lastSyncAt: p.kind === "resync" ? m.lastSyncAt : Date.now(),
				syncError: p.kind === "resync" ? "Registered history recovered; catching up on newer mail" : undefined,
			});
		return offset >= p.refs.length;
	},
});
export const startResync = internalMutation({
	args: { mailboxId: v.id("gmailMailboxes"), lease: v.string(), anchor: v.string() },
	handler: async (ctx, a) => {
		await leased(ctx, a.mailboxId, a.lease);
		decimalId(a.anchor);
		await ctx.db.patch(a.mailboxId, {
			forceRecovery: undefined,
			pending: undefined,
			pageToken: undefined,
			resync: { anchor: a.anchor },
			syncError: "History expired; recovering registered conversations",
		});
	},
});
export const resyncPage = internalQuery({
	args: { mailboxId: v.id("gmailMailboxes"), cursor: v.union(v.string(), v.null()) },
	handler: async (ctx, { mailboxId, cursor }) => {
		await activeMailbox(ctx, mailboxId);
		return ctx.db
			.query("gmailConversations")
			.withIndex("by_mailboxId", (q) => q.eq("mailboxId", mailboxId))
			.paginate({ numItems: 1, cursor });
	},
});
export const release = internalMutation({
	args: {
		mailboxId: v.id("gmailMailboxes"),
		lease: v.string(),
		error: v.optional(v.string()),
		reconnect: v.optional(v.boolean()),
		more: v.optional(v.boolean()),
	},
	handler: async (ctx, a) => {
		const m = await ctx.db.get(a.mailboxId);
		if (!m || m.lease !== a.lease) return;
		await ctx.db.patch(m._id, {
			lease: undefined,
			leaseExpiresAt: undefined,
			...(a.error
				? { syncError: a.error, ...(a.reconnect ? { status: "reconnect" as const } : {}) }
				: {}),
		});
		if (a.more && m.status === "connected")
			await ctx.scheduler.runAfter(0, internal.gmailNode.sync, { mailboxId: m._id });
	},
});
export const acknowledge = internalMutation({
	args: { mailboxId: v.id("gmailMailboxes"), pubsubId: v.string(), historyId: v.string() },
	handler: async (ctx, a) => {
		const m = await activeMailbox(ctx, a.mailboxId);
		decimalId(a.historyId);
		providerId(a.pubsubId);
		if (
			m.status !== "connected" ||
			m.resync ||
			m.pending ||
			m.pageToken ||
			m.syncError ||
			m.forceRecovery ||
			compareHistory(m.cursor, a.historyId) < 0
		)
			return false;
		const old = await ctx.db
			.query("gmailPushReceipts")
			.withIndex("by_mailboxId_and_pubsubId", (q) =>
				q.eq("mailboxId", m._id).eq("pubsubId", a.pubsubId),
			)
			.unique();
		if (old && old.historyId !== a.historyId) throw new Error("Notification identity changed");
		if (!old)
			await ctx.db.insert("gmailPushReceipts", {
				...a,
				generation: m.generation,
				expiresAt: Date.now() + 7 * 24 * 60 * 60_000,
			});
		await ctx.db.patch(m._id, { lastNoticeAt: Date.now() });
		return true;
	},
});
export const sendData = internalQuery({
	args: { attemptId: v.id("gmailSendAttempts") },
	handler: async (ctx, { attemptId }) => {
		const attempt = await ctx.db.get(attemptId);
		if (!attempt) throw new Error("Send unavailable");
		const mailbox = await activeMailbox(ctx, attempt.mailboxId),
			conversation = await ctx.db.get(attempt.conversationId);
		const files = await Promise.all(attempt.attachmentIds.map((id) => ctx.db.get(id)));
		return { attempt, mailbox, conversation, files };
	},
});
export const claimSend = internalMutation({
	args: { attemptId: v.id("gmailSendAttempts") },
	handler: async (ctx, { attemptId }) => {
		const a = await ctx.db.get(attemptId);
		if (!a || a.status !== "queued") return false;
		const m = await activeMailbox(ctx, a.mailboxId),
			c = await ctx.db.get(a.conversationId);
		const target = c?.inquiryId
			? await ctx.db.get(c.inquiryId)
			: c?.clientId
				? await ctx.db.get(c.clientId)
				: null;
		if (
			m.status !== "connected" ||
			m.generation !== a.generation ||
			!pilotAddressAllowed("MAILBOXES", m.address) ||
			!c ||
			c.revision !== a.conversationRevision ||
			c.recipient !== a.recipient ||
			c.problem ||
			c.importPending ||
			m.resync ||
			m.pending ||
			m.pageToken ||
			m.syncError ||
			!(await validTarget(ctx, c)) ||
			!target?.email ||
			mailboxAddress(target.email) !== a.recipient
		) {
			await ctx.db.patch(a._id, {
				status: "failed",
				problem: "Connection or conversation changed before send. Review and save the draft again",
			});
			return false;
		}
		await ctx.db.patch(a._id, { status: "submitting", startedAt: Date.now() });
		return true;
	},
});
export const failSend = internalMutation({
	args: {
		attemptId: v.id("gmailSendAttempts"),
		submitted: v.boolean(),
		uncertain: v.boolean(),
		problem: v.string(),
	},
	handler: async (ctx, a) => {
		const old = await ctx.db.get(a.attemptId);
		if (
			!old ||
			(a.submitted ? !["submitting", "uncertain"].includes(old.status) : old.status !== "queued")
		)
			return;
		await ctx.db.patch(old._id, {
			status: a.uncertain ? "uncertain" : "failed",
			problem: a.problem,
		});
	},
});
export const acceptSend = internalMutation({
	args: {
		attemptId: v.id("gmailSendAttempts"),
		providerId: v.string(),
		threadId: v.string(),
		date: v.number(),
		rfcId: v.optional(v.string()),
	},
	handler: async (ctx, a) => {
		providerId(a.providerId);
		providerId(a.threadId);
		if (a.rfcId !== undefined && !/^<[^<>\s]+@[^<>\s]+>$/.test(a.rfcId))
			throw new Error("Invalid provider Message-ID");
		const old = await ctx.db.get(a.attemptId);
		if (!old || old.status === "accepted") return;
		if (!["submitting", "uncertain"].includes(old.status))
			throw new Error("Send has no provider attempt");
		const m = await ctx.db.get(old.mailboxId),
			c = await ctx.db.get(old.conversationId);
		if (!m || !c || (c.threadId && c.threadId !== a.threadId))
			throw new Error("Provider thread mismatch");
		const other = await ctx.db
			.query("gmailConversations")
			.withIndex("by_mailboxId_and_threadId", (q) =>
				q.eq("mailboxId", m._id).eq("threadId", a.threadId),
			)
			.unique();
		if (other && other._id !== c._id) throw new Error("Thread already assigned");
		await ctx.db.patch(c._id, { threadId: a.threadId });
		if (!c.threadId)
			await ctx.db.patch(m._id, {
				resync: { anchor: m.cursor },
				pending: undefined,
				pageToken: undefined,
				lease: undefined,
				leaseExpiresAt: undefined,
			});
		const id = await importMessage(
			ctx,
			m,
			c,
			{
				providerId: a.providerId,
				threadId: a.threadId,
				rfcId: a.rfcId ?? old.rfcId,
				from: m.address,
				to: [old.recipient],
				subject: old.subject,
				text: old.text,
				sent: true,
				date: a.date,
				attachments: [],
			},
			"admin",
		);
		for (const fileId of old.attachmentIds)
			await ctx.db.patch(fileId, { messageId: id, expiresAt: undefined });
		await ctx.db.patch(old._id, {
			status: "accepted",
			providerId: a.providerId,
			problem: undefined,
		});
		const draft = await ctx.db
			.query("gmailDrafts")
			.withIndex("by_conversationId_and_author", (q) =>
				q.eq("conversationId", c._id).eq("author", old.author),
			)
			.unique();
		if (draft?.revision === old.draftRevision)
			await ctx.db.patch(draft._id, { text: "", attachmentIds: [], revision: draft.revision + 1 });
	},
});
export const renew = internalMutation({
	args: { mailboxId: v.id("gmailMailboxes"), generation: v.number(), expiresAt: v.number() },
	handler: async (ctx, a) => {
		const m = await activeMailbox(ctx, a.mailboxId);
		if (m.generation === a.generation && m.status === "connected")
			await ctx.db.patch(m._id, { watchExpiresAt: a.expiresAt, watchRenewedAt: Date.now() });
	},
});
export const disconnect = mutation({
	args: { secret: v.string(), siteUrl: v.string() },
	handler: async (ctx, { secret, siteUrl }) => {
		requireGmailServer(secret);
		const m = await ctx.db
			.query("gmailMailboxes")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.unique();
		if (!m) return null;
		if (m.connectionBusyUntil && m.connectionBusyUntil > Date.now())
			throw new Error("A mailbox connection action is still finishing");
		await ctx.db.patch(m._id, {
			status: "disconnected",
			encryptedRefreshToken: undefined,
			generation: m.generation + 1,
			lease: undefined,
			leaseExpiresAt: undefined,
			connectionBusyUntil: Date.now() + 60_000,
		});
		return m;
	},
});
export const uploadGrant = mutation({
	args: { secret: v.string(), attachmentId: v.id("gmailAttachments") },
	handler: async (ctx, a) => {
		requireGmailServer(a.secret);
		const f = await ctx.db.get(a.attachmentId);
		if (!f || f.status !== "pending" || !f.expiresAt || f.expiresAt < Date.now())
			throw new Error("Upload expired");
		return ctx.storage.generateUploadUrl();
	},
});
export const completeUpload = mutation({
	args: { secret: v.string(), attachmentId: v.id("gmailAttachments"), storageId: v.id("_storage") },
	handler: async (ctx, a) => {
		requireGmailServer(a.secret);
		const f = await ctx.db.get(a.attachmentId),
			meta = await ctx.db.system.get(a.storageId);
		if (
			!f ||
			f.status !== "pending" ||
			!f.expiresAt ||
			f.expiresAt < Date.now() ||
			!meta ||
			meta.size !== f.size ||
			meta.contentType !== gmailUploadType(f._id)
		) {
			await ctx.storage.delete(a.storageId);
			return false;
		}
		await ctx.db.patch(f._id, { storageId: a.storageId, status: "ready" });
		return true;
	},
});
export const fileTransport = query({
	args: { secret: v.string(), attachmentId: v.id("gmailAttachments") },
	handler: async (ctx, a) => {
		requireGmailServer(a.secret);
		const f = await ctx.db.get(a.attachmentId),
			c = f ? await ctx.db.get(f.conversationId) : null;
		if (!f || !c || f.status !== "ready") throw new Error("Attachment unavailable");
		await activeMailbox(ctx, c.mailboxId);
		const message = f.messageId ? await ctx.db.get(f.messageId) : null;
		return {
			file: f,
			mailboxId: c.mailboxId,
			providerMessageId: message?.providerId ?? null,
			storageUrl: f.storageId ? await ctx.storage.getUrl(f.storageId) : null,
		};
	},
});
export const maintain = internalMutation({
	args: { cursor: v.optional(v.string()) },
	handler: async (ctx, { cursor }) => {
		const page = await ctx.db
			.query("gmailMailboxes")
			.withIndex("by_status", (q) => q.eq("status", "connected"))
			.paginate({ numItems: 25, cursor: cursor ?? null });
		for (const m of page.page)
			await ctx.scheduler.runAfter(0, internal.gmailNode.sync, { mailboxId: m._id });
		if (!page.isDone)
			await ctx.scheduler.runAfter(0, internal.gmailState.maintain, {
				cursor: page.continueCursor,
			});
		const stuck = await ctx.db
			.query("gmailSendAttempts")
			.withIndex("by_status", (q) => q.eq("status", "submitting"))
			.take(50);
		for (const a of stuck)
			if (a.startedAt && a.startedAt < Date.now() - 120_000)
				await ctx.db.patch(a._id, {
					status: "uncertain",
					problem: "The send stopped without a confirmed result. Check Gmail Sent; do not resend",
				});
		const queued = await ctx.db
			.query("gmailSendAttempts")
			.withIndex("by_status", (q) => q.eq("status", "queued"))
			.take(50);
		for (const a of queued)
			await ctx.scheduler.runAfter(0, internal.gmailNode.send, { attemptId: a._id });
		for (const r of await ctx.db
			.query("gmailPushReceipts")
			.withIndex("by_expiresAt", (q) => q.lt("expiresAt", Date.now()))
			.take(100))
			await ctx.db.delete(r._id);
		for (const r of await ctx.db
			.query("gmailConnectStates")
			.withIndex("by_expiresAt", (q) => q.lt("expiresAt", Date.now()))
			.take(100))
			await ctx.db.delete(r._id);
		for (const f of await ctx.db
			.query("gmailAttachments")
			.withIndex("by_expiresAt", (q) => q.gt("expiresAt", 0).lt("expiresAt", Date.now()))
			.take(50)) {
			const attempts = await ctx.db
				.query("gmailSendAttempts")
				.withIndex("by_conversationId", (q) => q.eq("conversationId", f.conversationId))
				.order("desc")
				.take(10);
			if (
				attempts.some(
					(a) =>
						["queued", "submitting", "uncertain"].includes(a.status) &&
						a.attachmentIds.includes(f._id),
				)
			)
				continue;
			if (f.storageId) await ctx.storage.delete(f.storageId);
			await ctx.db.patch(f._id, {
				storageId: undefined,
				status: "blocked",
				problem: "Unsent attachment expired; select the file again",
				expiresAt: undefined,
			});
		}
	},
});

export const failUpload = mutation({
	args: { secret: v.string(), attachmentId: v.id("gmailAttachments") },
	handler: async (ctx, a) => {
		requireGmailServer(a.secret);
		const f = await ctx.db.get(a.attachmentId);
		if (f?.status === "pending")
			await ctx.db.patch(f._id, {
				status: "blocked",
				problem: "Upload did not complete. Select this file again or remove it before sending",
			});
	},
});

export const forSite = internalQuery({
	args: { siteUrl: v.string() },
	handler: (ctx, { siteUrl }) =>
		ctx.db
			.query("gmailMailboxes")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.unique(),
});
export const finishDisconnect = internalMutation({
	args: { mailboxId: v.id("gmailMailboxes"), generation: v.number() },
	handler: async (ctx, a) => {
		const m = await ctx.db.get(a.mailboxId);
		if (m?.generation === a.generation)
			await ctx.db.patch(m._id, { connectionBusyUntil: undefined });
	},
});

/** Only marked Gmail uploads can be removed; unknown shared-storage objects are never candidates. */
export const cleanUploadOrphans = internalMutation({
	args: { cursor: v.optional(v.string()) },
	handler: async (ctx, { cursor }) => {
		const page = await ctx.db.system
			.query("_storage")
			.paginate({ numItems: 100, cursor: cursor ?? null });
		for (const object of page.page) {
			if (object._creationTime > Date.now() - 24 * 60 * 60_000) continue;
			const marker = object.contentType?.match(
				/^application\/x-angelsrest-gmail-upload; attachment=([A-Za-z0-9]{16,80})$/,
			);
			const attachmentId = marker ? ctx.db.normalizeId("gmailAttachments", marker[1]) : null;
			if (!attachmentId) continue;
			const selected = await ctx.db.get(attachmentId);
			if (selected?.storageId !== object._id) await ctx.storage.delete(object._id);
		}
		if (!page.isDone)
			await ctx.scheduler.runAfter(0, internal.gmailState.cleanUploadOrphans, {
				cursor: page.continueCursor,
			});
	},
});

export const registerThread = internalMutation({
	args: { ...recordArgs, mailboxId: v.id("gmailMailboxes"), generation: v.number(), author: v.string(),
		threadId: v.string(), recipient: v.string(), subject: v.string() },
	handler: async (ctx, args) => {
		const record = await gmailRecord(ctx, args);
		requirePilotAddress("RECIPIENTS", record.recipient);
		const identity = await ctx.auth.getUserIdentity();
		const m = await activeMailbox(ctx, args.mailboxId);
		requirePilotAddress("MAILBOXES", m.address);
		if (!identity || identity.tokenIdentifier !== args.author || m.siteUrl !== record.siteUrl || m.status !== "connected" ||
			m.dataDeletionRequestedAt || m.generation !== args.generation || record.recipient !== args.recipient)
			throw new Error("Mailbox or record changed. Preview the conversation again");
		providerId(args.threadId);
		if (!args.subject || args.subject.length > 200 || /[\r\n\0]/.test(args.subject)) throw new Error("Invalid thread subject");
		const old = await ctx.db.query("gmailConversations").withIndex("by_mailboxId_and_threadId", q => q.eq("mailboxId", m._id).eq("threadId", args.threadId)).unique();
		if (old) {
			if (old.deletingAt || gmailExpiresAt(old) <= Date.now()) throw new Error("This thread is awaiting data cleanup");
			if (args.inquiryId ? old.inquiryId !== args.inquiryId : old.inquiryId || old.clientId !== args.clientId)
				throw new Error("This Gmail thread is already linked to a different record");
			if (old.importPending) await ctx.scheduler.runAfter(0, internal.gmailNode.sync, { mailboxId: m._id });
			return old._id;
		}
		const id = await ctx.db.insert("gmailConversations", { ...record, mailboxId: m._id, subject: args.subject,
			threadId: args.threadId, revision: 0, importPending: true, workflowState: "review" });
		// Replay from the durable cursor through the existing registered-thread recovery.
		// Fencing the lease prevents an in-flight page from skipping the new association.
		await ctx.db.patch(m._id, { resync: { anchor: m.cursor }, pending: undefined, pageToken: undefined,
			lease: undefined, leaseExpiresAt: undefined, syncError: "Importing an explicitly linked conversation; sending is paused" });
		await ctx.scheduler.runAfter(0, internal.gmailNode.sync, { mailboxId: m._id });
		return id;
	},
});

export const reconciliationEvidence = internalMutation({
	args: { attemptId: v.id("gmailSendAttempts"), outcome: v.union(v.literal("accepted"), v.literal("not_found"), v.literal("ambiguous"), v.literal("mismatch"), v.literal("unavailable")) },
	handler: async (ctx, { attemptId, outcome }) => {
		const a = await ctx.db.get(attemptId);
		if (!a || !["submitting", "uncertain", "accepted"].includes(a.status)) return;
		await ctx.db.patch(a._id, { checkedAt: Date.now(), checkOutcome: a.status === "accepted" ? "accepted" : outcome });
	},
});

/** Each stage is repeatable, bounded, and fenced against new sends/imports. */
export const eraseConversation = internalMutation({
	args: { conversationId: v.id("gmailConversations") },
	handler: async (ctx, { conversationId }) => {
		const c = await ctx.db.get(conversationId);
		if (!c || !c.deletingAt) return;
		if (await unresolvedSend(ctx, c._id)) {
			await ctx.db.patch(c._id, { deletingAt: undefined, retentionHoldAt: c.retentionHoldAt ?? Date.now() });
			return;
		}
		const files = await ctx.db.query("gmailAttachments").withIndex("by_conversationId", q => q.eq("conversationId", c._id)).take(50);
		if (files.length) {
			for (const f of files) {
				if (f.storageId) await ctx.storage.delete(f.storageId);
				await ctx.db.delete(f._id);
			}
		} else {
			const messages = await ctx.db.query("gmailMessages").withIndex("by_conversationId_and_date", q => q.eq("conversationId", c._id)).take(50);
			if (messages.length) for (const m of messages) await ctx.db.delete(m._id);
			else {
				const drafts = await ctx.db.query("gmailDrafts").withIndex("by_conversationId_and_author", q => q.eq("conversationId", c._id)).take(50);
				if (drafts.length) for (const d of drafts) await ctx.db.delete(d._id);
				else {
					const attempts = await ctx.db.query("gmailSendAttempts").withIndex("by_conversationId", q => q.eq("conversationId", c._id)).take(50);
					if (attempts.length) for (const a of attempts) await ctx.db.delete(a._id);
					else {
						await ctx.db.delete(c._id);
						const m = await ctx.db.get(c.mailboxId);
						if (m?.dataDeletionRequestedAt) await ctx.scheduler.runAfter(0, internal.gmailState.eraseMailboxData, { mailboxId: m._id });
						return;
					}
				}
			}
		}
		await ctx.scheduler.runAfter(0, internal.gmailState.eraseConversation, { conversationId });
	},
});

export const eraseMailboxData = internalMutation({
	args: { mailboxId: v.id("gmailMailboxes") },
	handler: async (ctx, { mailboxId }) => {
		const m = await ctx.db.get(mailboxId);
		if (!m?.dataDeletionRequestedAt || m.status !== "disconnected") return;
		const c = await ctx.db.query("gmailConversations").withIndex("by_mailboxId", q => q.eq("mailboxId", m._id)).first();
		if (c) {
			if (await unresolvedSend(ctx, c._id)) return;
			await ctx.db.patch(c._id, { deletingAt: c.deletingAt ?? Date.now(), revision: c.revision + 1 });
			await ctx.scheduler.runAfter(0, internal.gmailState.eraseConversation, { conversationId: c._id });
			return;
		}
		const receipts = await ctx.db.query("gmailPushReceipts").withIndex("by_mailboxId_and_pubsubId", q => q.eq("mailboxId", m._id)).take(100);
		const states = await ctx.db.query("gmailConnectStates").withIndex("by_siteUrl", q => q.eq("siteUrl", m.siteUrl)).take(100);
		for (const row of [...receipts, ...states]) await ctx.db.delete(row._id);
		if (receipts.length || states.length) {
			await ctx.scheduler.runAfter(0, internal.gmailState.eraseMailboxData, { mailboxId });
			return;
		}
		// Keep only the mailbox/site registry and cursor: deletion never authorizes reassignment.
		await ctx.db.patch(m._id, { dataDeletionRequestedAt: undefined, lastDataDeletionAt: Date.now(), lastNoticeAt: undefined,
			lastSyncAt: undefined, syncError: undefined, pending: undefined, pageToken: undefined, resync: undefined });
	},
});

export const retain = internalMutation({
	args: { cursor: v.optional(v.string()) },
	handler: async (ctx, { cursor }) => {
		const page = await ctx.db.query("gmailConversations").order("asc").paginate({ numItems: 25, cursor: cursor ?? null });
		for (const c of page.page) {
			if (!c.deletingAt && gmailExpiresAt(c) > Date.now()) continue;
			if (await unresolvedSend(ctx, c._id)) {
				if (!c.retentionHoldAt) await ctx.db.patch(c._id, { retentionHoldAt: Date.now() });
				continue;
			}
			await ctx.db.patch(c._id, { deletingAt: c.deletingAt ?? Date.now(), revision: c.revision + 1 });
			await ctx.scheduler.runAfter(0, internal.gmailState.eraseConversation, { conversationId: c._id });
		}
		if (!page.isDone) await ctx.scheduler.runAfter(0, internal.gmailState.retain, { cursor: page.continueCursor });
	},
});
