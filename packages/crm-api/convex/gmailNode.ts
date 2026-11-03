"use node";
import { createHash, randomUUID } from "node:crypto";
import { v } from "convex/values";
import type { GmailConnectionStage } from "../src/gmailConnection";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type ActionCtx, action, internalAction } from "./_generated/server";
import { recordArgs } from "./gmailConversations";
import { connectionError, safeConnectionError } from "./helpers/gmail/connection";
import { decimalId, mailboxAddress, providerId, requireGmailServer, requirePilotAddress } from "./helpers/gmail/policy";
import {
	array,
	composeReply,
	GmailError,
	gmailClient,
	gmailScopes,
	historyPage,
	normalizeMessage,
	oauthToken,
	object,
	openToken,
	sealToken,
	string,
	threadPreview,
	verifyFile,
} from "./helpers/gmail/protocol";

function setting(name: string) {
	const value = process.env[name];
	if (!value) throw new Error("Gmail production configuration is incomplete");
	return value;
}
async function access(mailbox: Doc<"gmailMailboxes">) {
	requirePilotAddress("MAILBOXES", mailbox.address);
	if (mailbox.status !== "connected" || !mailbox.encryptedRefreshToken)
		throw new Error("Reconnect Gmail");
	const token = await oauthToken(
		{
			grant_type: "refresh_token",
			refresh_token: openToken(
				mailbox.encryptedRefreshToken,
				mailbox.siteUrl,
				setting("GMAIL_TOKEN_ENCRYPTION_KEY"),
			),
		},
		setting(mailbox.credentialSource === "login" ? "AUTH_GOOGLE_ID" : "GMAIL_OAUTH_CLIENT_ID"),
		setting(
			mailbox.credentialSource === "login" ? "AUTH_GOOGLE_SECRET" : "GMAIL_OAUTH_CLIENT_SECRET",
		),
	);
	const grantedScopes = typeof token.scope === "string" ? token.scope.split(" ") : null;
	if (grantedScopes && !gmailScopes.every(scope => grantedScopes.includes(scope))) throw new GmailError(401);
	return string(token.access_token, 4096);
}
async function syncMailbox(ctx: ActionCtx, mailboxId: Id<"gmailMailboxes">): Promise<boolean> {
	const lease = randomUUID();
	const acquired: Doc<"gmailMailboxes"> | null = await ctx.runMutation(
		internal.gmailState.acquire,
		{ mailboxId, lease },
	);
	if (!acquired) return false;
	let more = false;
	try {
		const gmail = gmailClient(await access(acquired));
		if (acquired.forceRecovery) {
			const profile = await gmail("/profile");
			if (mailboxAddress(string(profile.emailAddress)) !== acquired.address) throw new Error("Mailbox changed");
			await ctx.runMutation(internal.gmailState.startResync, { mailboxId, lease, anchor: decimalId(profile.historyId) });
			more = true;
			return false;
		}
		if (
			Date.now() - acquired.watchRenewedAt >= 24 * 60 * 60_000 ||
			acquired.watchExpiresAt < Date.now() + 60 * 60_000
		) {
			// No INBOX filter: native Gmail Sent replies must trigger the same path.
			const watch = await gmail("/watch", { topicName: setting("GMAIL_PUBSUB_TOPIC") });
			const expiresAt = Number(watch.expiration);
			if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())
				throw new Error("Invalid Gmail watch expiration");
			await ctx.runMutation(internal.gmailState.renew, {
				mailboxId,
				generation: acquired.generation,
				expiresAt,
			});
		}
		if (!acquired.pending) {
			if (acquired.resync) {
				const page: { page: Doc<"gmailConversations">[]; isDone: boolean; continueCursor: string } =
					await ctx.runQuery(internal.gmailState.resyncPage, {
						mailboxId,
						cursor: acquired.resync.conversationCursor ?? null,
					});
				const refs: { id: string; threadId: string }[] = [];
				for (const c of page.page)
					if (c.threadId) {
						try {
							const thread = await gmail(
								`/threads/${encodeURIComponent(c.threadId)}?format=minimal`,
							);
							if (thread.id !== c.threadId) throw new Error("Unexpected recovery thread");
							for (const raw of array(thread.messages ?? [], 2000)) {
								const m = object(raw);
								refs.push({ id: providerId(m.id), threadId: c.threadId });
							}
						} catch (error) {
							if (!(error instanceof GmailError && error.status === 404)) throw error;
						}
					}
				await ctx.runMutation(internal.gmailState.stagePage, {
					mailboxId,
					lease,
					kind: "resync",
					refs,
					done: page.isDone,
					...(page.isDone ? {} : { nextPageToken: page.continueCursor }),
					endHistoryId: acquired.resync.anchor,
					conversationId: page.page[0]?._id,
				});
			} else {
				try {
					const params = new URLSearchParams({
						startHistoryId: acquired.cursor,
						maxResults: "50",
						...(acquired.pageToken ? { pageToken: acquired.pageToken } : {}),
					});
					const page = historyPage(await gmail(`/history?${params}`));
					await ctx.runMutation(internal.gmailState.stagePage, {
						mailboxId,
						lease,
						kind: "history",
						...page,
					});
				} catch (error) {
					if (!(error instanceof GmailError && error.status === 404)) throw error;
					const profile = await gmail("/profile");
					if (mailboxAddress(string(profile.emailAddress)) !== acquired.address)
						throw new Error("Mailbox changed");
					await ctx.runMutation(internal.gmailState.startResync, {
						mailboxId,
						lease,
						anchor: decimalId(profile.historyId),
					});
					more = true;
					return false;
				}
			}
		}
		const m: Doc<"gmailMailboxes"> = await ctx.runQuery(internal.gmailState.getMailbox, {
			mailboxId,
		});
		if (!m.pending) throw new Error("Missing sync checkpoint");
		const refs = m.pending.refs.slice(m.pending.offset, m.pending.offset + 20);
		const known: Doc<"gmailConversations">[] = await ctx.runQuery(
			internal.gmailState.knownThreads,
			{ mailboxId, threadIds: [...new Set(refs.map((r) => r.threadId))] },
		);
		const imported = await Promise.all(
			refs.map(async (ref) => {
				const c = known.find((c) => c.threadId === ref.threadId);
				if (!c) return null; // Never fetch bodies from unrelated personal threads.
				try {
					const raw = await gmail(`/messages/${encodeURIComponent(ref.id)}?format=full`);
					// Draft label changes are watched too, but only committed mail belongs in the record.
					if (array(raw.labelIds ?? [], 100).includes("DRAFT")) return null;
					const message = normalizeMessage(raw, {
						threadId: ref.threadId,
						recipient: c.recipient,
						mailbox: m.address,
					});
					if (message.providerId !== ref.id) throw new Error("Message identity changed");
					return message;
				} catch (error) {
					if (error instanceof GmailError && error.status === 404) return null;
					throw error;
				}
			}),
		);
		// Imported rows and page progress commit in one transaction. A crash replays this batch.
		await ctx.runMutation(internal.gmailState.commitBatch, {
			mailboxId,
			lease,
			consumed: refs.length,
			messages: imported.filter((x) => x !== null),
		});
		const after: Doc<"gmailMailboxes"> = await ctx.runQuery(internal.gmailState.getMailbox, {
			mailboxId,
		});
		more = Boolean(after.pending || after.pageToken || after.resync || m.pending.kind === "resync");
		return !more;
	} catch (error) {
		await ctx.runMutation(internal.gmailState.release, {
			mailboxId,
			lease,
			error:
				error instanceof GmailError && [400, 401].includes(error.status)
					? "Gmail access expired or was revoked. Reconnect the same mailbox"
					: "Gmail sync is interrupted. Saved messages and drafts are retained; retry sync",
			reconnect: error instanceof GmailError && [400, 401].includes(error.status),
		});
		return false;
	} finally {
		await ctx.runMutation(internal.gmailState.release, { mailboxId, lease, more });
	}
}
export const sync = internalAction({
	args: { mailboxId: v.id("gmailMailboxes") },
	handler: (ctx, { mailboxId }): Promise<boolean> => syncMailbox(ctx, mailboxId),
});
export const push = action({
	args: { secret: v.string(), address: v.string(), pubsubId: v.string(), historyId: v.string() },
	handler: async (ctx, a): Promise<boolean> => {
		requireGmailServer(a.secret);
		decimalId(a.historyId);
		providerId(a.pubsubId);
		const m: Doc<"gmailMailboxes"> | null = await ctx.runQuery(internal.gmailState.findMailbox, {
			address: mailboxAddress(a.address),
		});
		if (!m || m.status === "disconnected") return true;
		const notice = { mailboxId: m._id, pubsubId: a.pubsubId, historyId: a.historyId };
		if (await ctx.runMutation(internal.gmailState.acknowledge, notice)) return true;
		await syncMailbox(ctx, m._id);
		// The HTTP adapter sends 204 only after imported data and the complete cursor are durable.
		return ctx.runMutation(internal.gmailState.acknowledge, notice);
	},
});
export const connect = action({
	args: {
		secret: v.string(),
		siteUrl: v.string(),
		code: v.string(),
		verifier: v.string(),
		redirectUri: v.string(),
	},
	handler: async (ctx, a): Promise<null> => {
		requireGmailServer(a.secret);
		if (
			a.redirectUri !== setting("GMAIL_OAUTH_REDIRECT_URI") ||
			a.code.length > 4096 ||
			!/^[a-zA-Z0-9_-]{43,128}$/.test(a.verifier)
		)
			throw new Error("Invalid Gmail connection request");
		let stage: GmailConnectionStage = "exchange";
		try {
			const token = await oauthToken(
				{
					grant_type: "authorization_code",
					code: a.code,
					code_verifier: a.verifier,
					redirect_uri: a.redirectUri,
				},
				setting("GMAIL_OAUTH_CLIENT_ID"),
				setting("GMAIL_OAUTH_CLIENT_SECRET"),
			);
			const scopes = typeof token.scope === "string" ? token.scope.split(" ") : [];
			if (
				!gmailScopes.every((s) => scopes.includes(s)) ||
				!token.refresh_token ||
				!token.access_token
			)
				throw connectionError("missing_permissions", "exchange");
			stage = "profile";
			const gmail = gmailClient(string(token.access_token, 4096)),
				profile = await gmail("/profile");
			const address = mailboxAddress(string(profile.emailAddress));
			try {
				requirePilotAddress("MAILBOXES", address);
			} catch {
				throw connectionError("mailbox_unavailable", "profile");
			}
			const current: Doc<"gmailMailboxes"> | null = await ctx.runQuery(
				internal.gmailState.forSite,
				{
					siteUrl: a.siteUrl,
				},
			);
			if (current && current.address !== address)
				throw connectionError("account_mismatch", "profile");
			if (current?.connectionBusyUntil && current.connectionBusyUntil > Date.now())
				throw connectionError("connection_busy", "profile");
			const other: Doc<"gmailMailboxes"> | null = await ctx.runQuery(
				internal.gmailState.findMailbox,
				{ address },
			);
			if (other && other.siteUrl !== a.siteUrl)
				throw connectionError("mailbox_unavailable", "profile");
			stage = "watch";
			const watch = await gmail("/watch", { topicName: setting("GMAIL_PUBSUB_TOPIC") });
			const expiresAt = Number(watch.expiration);
			if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())
				throw new Error("Invalid Gmail watch expiration");
			stage = "install";
			await ctx.runMutation(internal.gmailState.install, {
				siteUrl: a.siteUrl,
				address,
				encryptedRefreshToken: sealToken(
					string(token.refresh_token, 8192),
					a.siteUrl,
					setting("GMAIL_TOKEN_ENCRYPTION_KEY"),
				),
				historyId: decimalId(profile.historyId),
				watchExpiresAt: expiresAt,
			});
			return null;
		} catch (failure) {
			throw safeConnectionError(failure, stage);
		}
	},
});
export const transport = action({
	args: { secret: v.string(), mailboxId: v.id("gmailMailboxes") },
	handler: async (ctx, a): Promise<{ accessToken: string }> => {
		requireGmailServer(a.secret);
		const m: Doc<"gmailMailboxes"> = await ctx.runQuery(internal.gmailState.getMailbox, {
			mailboxId: a.mailboxId,
		});
		return { accessToken: await access(m) };
	},
});
export const send = internalAction({
	args: { attemptId: v.id("gmailSendAttempts") },
	handler: async (ctx, { attemptId }): Promise<null> => {
		let submitted = false;
		try {
			const data: {
				attempt: Doc<"gmailSendAttempts">;
				mailbox: Doc<"gmailMailboxes">;
				conversation: Doc<"gmailConversations"> | null;
				files: (Doc<"gmailAttachments"> | null)[];
			} = await ctx.runQuery(internal.gmailState.sendData, { attemptId });
			if (data.attempt.status !== "queued") return null;
			if (!(await syncMailbox(ctx, data.mailbox._id))) {
				await ctx.runMutation(internal.gmailState.failSend, {
					attemptId,
					submitted: false,
					uncertain: false,
					problem: "Gmail is not fully synchronized. Sync and review the draft before trying again",
				});
				return null;
			}
			const gmail = gmailClient(await access(data.mailbox));
			const files = await Promise.all(
				data.files.map(async (f) => {
					if (!f?.storageId || f.status !== "ready")
						throw new Error("Selected attachment unavailable");
					const blob = await ctx.storage.get(f.storageId);
					if (!blob) throw new Error("Selected attachment unavailable");
					const bytes = new Uint8Array(await blob.arrayBuffer());
					verifyFile(bytes, f.type, f.size);
					if (createHash("sha256").update(bytes).digest("hex") !== f.sha256)
						throw new Error("Selected file fingerprint changed");
					return { name: f.name, type: f.type, bytes };
				}),
			);
			const raw = composeReply(data.attempt, data.mailbox.address, files);
			if (!(await ctx.runMutation(internal.gmailState.claimSend, { attemptId }))) return null;
			submitted = true;
			const result = await gmail("/messages/send", {
				raw,
				...(data.attempt.threadId ? { threadId: data.attempt.threadId } : {}),
			});
			await ctx.runMutation(internal.gmailState.acceptSend, {
				attemptId,
				providerId: providerId(result.id),
				threadId: providerId(result.threadId),
				date: Date.now(),
			});
			await ctx.scheduler.runAfter(0, internal.gmailNode.sync, { mailboxId: data.mailbox._id });
		} catch (error) {
			const definiteRejection =
				error instanceof GmailError && [400, 401, 403, 404, 413, 429].includes(error.status);
			await ctx.runMutation(internal.gmailState.failSend, {
				attemptId,
				submitted,
				uncertain: submitted && !definiteRejection,
				problem:
					submitted && !definiteRejection
						? "Gmail may have accepted this reply. Check Gmail Sent; do not resend until reconciled"
						: "The reply was not sent. Check the connection and selected files; the draft is retained",
			});
		}
		return null;
	},
});
export const reconcile = internalAction({
	args: { attemptId: v.id("gmailSendAttempts") },
	handler: async (ctx, { attemptId }): Promise<null> => {
		let outcome: "accepted" | "not_found" | "ambiguous" | "mismatch" | "unavailable" = "unavailable";
		try {
			const data: { attempt: Doc<"gmailSendAttempts">; mailbox: Doc<"gmailMailboxes"> } =
				await ctx.runQuery(internal.gmailState.sendData, { attemptId });
			const a = data.attempt;
			if (!["submitting", "uncertain"].includes(a.status)) return null;
			const gmail = gmailClient(await access(data.mailbox));
			const result = await gmail(
				`/messages?${new URLSearchParams({ q: `in:sent rfc822msgid:${a.rfcId.slice(1, -1)}`, maxResults: "2" })}`,
			);
			const rows = array(result.messages ?? [], 2);
			outcome = rows.length === 0 && !result.nextPageToken ? "not_found" : "ambiguous";
			if (rows.length !== 1 || result.nextPageToken) return null;
			outcome = "mismatch";
			const ref = object(rows[0]),
				id = providerId(ref.id),
				threadId = providerId(ref.threadId);
			if (a.threadId && a.threadId !== threadId) return null;
			const message = normalizeMessage(await gmail(`/messages/${id}?format=full`), {
				threadId,
				recipient: a.recipient,
				mailbox: data.mailbox.address,
			});
			if (
				message.providerId !== id ||
				message.rfcId !== a.rfcId ||
				message.subject !== a.subject ||
				!message.sent ||
				message.blocked
			)
				return null;
			await ctx.runMutation(internal.gmailState.acceptSend, {
				attemptId,
				providerId: id,
				threadId,
				date: message.date,
			});
			outcome = "accepted";
		} catch {
			outcome = "unavailable";
			/* Absence, interruption and ambiguous matches never authorize another send. */
		} finally {
			await ctx.runMutation(internal.gmailState.reconciliationEvidence, { attemptId, outcome });
		}
		return null;
	},
});

/** Called only after Better Auth verifies the current linked account and actual granted scopes. */
export const installLinked = internalAction({
	args: {
		siteUrl: v.string(),
		expectedAddress: v.string(),
		accessToken: v.string(),
		refreshToken: v.string(),
	},
	handler: async (ctx, a): Promise<null> => {
		let stage: GmailConnectionStage = "profile";
		try {
			try {
				requirePilotAddress("MAILBOXES", a.expectedAddress);
			} catch {
				throw connectionError("mailbox_unavailable", "profile");
			}
			const gmail = gmailClient(a.accessToken),
				profile = await gmail("/profile");
			const address = mailboxAddress(string(profile.emailAddress));
			if (address !== mailboxAddress(a.expectedAddress))
				throw connectionError("account_mismatch", "profile");
			const current: Doc<"gmailMailboxes"> | null = await ctx.runQuery(
				internal.gmailState.forSite,
				{
					siteUrl: a.siteUrl,
				},
			);
			if (current && current.address !== address)
				throw connectionError("account_mismatch", "profile");
			if (current?.connectionBusyUntil && current.connectionBusyUntil > Date.now())
				throw connectionError("connection_busy", "profile");
			const other: Doc<"gmailMailboxes"> | null = await ctx.runQuery(
				internal.gmailState.findMailbox,
				{ address },
			);
			if (other && other.siteUrl !== a.siteUrl)
				throw connectionError("mailbox_unavailable", "profile");
			stage = "watch";
			const watch = await gmail("/watch", { topicName: setting("GMAIL_PUBSUB_TOPIC") });
			const expiresAt = Number(watch.expiration);
			if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())
				throw new Error("Invalid watch expiration");
			stage = "install";
			await ctx.runMutation(internal.gmailState.install, {
				siteUrl: a.siteUrl,
				address,
				encryptedRefreshToken: sealToken(
					a.refreshToken,
					a.siteUrl,
					setting("GMAIL_TOKEN_ENCRYPTION_KEY"),
				),
				historyId: decimalId(profile.historyId),
				watchExpiresAt: expiresAt,
				credentialSource: "login",
			});
			return null;
		} catch (failure) {
			throw safeConnectionError(failure, stage);
		}
	},
});

export const stopSynchronization = action({
	args: { secret: v.string(), siteUrl: v.string() },
	handler: async (
		ctx,
		a,
	): Promise<{ disconnected: boolean; watchStopped: boolean; providerGrantRevoked: false }> => {
		requireGmailServer(a.secret);
		const m: Doc<"gmailMailboxes"> | null = await ctx.runMutation(api.gmailState.disconnect, a);
		if (!m) return { disconnected: true, watchStopped: true, providerGrantRevoked: false };
		let watchStopped = false;
		try {
			if (m.encryptedRefreshToken) {
				await gmailClient(await access({ ...m, status: "connected" }))("/stop", {});
				watchStopped = true;
			}
		} catch {
			/* Local sync is already stopped. Google grant revocation is a separate operator/user action. */
		} finally {
			await ctx.runMutation(internal.gmailState.finishDisconnect, {
				mailboxId: m._id,
				generation: m.generation + 1,
			});
		}
		return { disconnected: true, watchStopped, providerGrantRevoked: false };
	},
});

const metadataPath = (threadId: string) => `/threads/${encodeURIComponent(providerId(threadId))}?${new URLSearchParams([
	["format", "metadata"], ...["From", "To", "Cc", "Bcc", "Subject", "Message-ID"].map(name => ["metadataHeaders", name]),
])}`;

export const searchThreads = action({
	args: { ...recordArgs, search: v.string() },
	handler: async (ctx, args): Promise<{ threads: { id: string; summary: string }[]; more: boolean; mailbox: string }> => {
		const scope = await ctx.runQuery(api.gmailConversations.linkContext, args.inquiryId ? { inquiryId: args.inquiryId } : { clientId: args.clientId });
		if (args.search.trim().length < 3 || args.search.length > 120 || /[\r\n\0]/.test(args.search)) throw new Error("Use a specific search of 3 to 120 characters");
		const m: Doc<"gmailMailboxes"> = await ctx.runQuery(internal.gmailState.getMailbox, { mailboxId: scope.mailboxId });
		const result = await gmailClient(await access(m))(`/threads?${new URLSearchParams({ q: `(${args.search.trim()}) -in:drafts`, maxResults: "10", includeSpamTrash: "false" })}`);
		return { mailbox: scope.mailbox, more: Boolean(result.nextPageToken), threads: array(result.threads ?? [], 10).map(raw => {
			const row = object(raw);
			return { id: providerId(row.id), summary: typeof row.snippet === "string" ? row.snippet.slice(0, 240) : "Preview this Gmail conversation" };
		}) };
	},
});

export const previewThread = action({
	args: { ...recordArgs, threadId: v.string() },
	handler: async (ctx, args): Promise<{ threadId: string; subject: string; participants: string[]; messageCount: number;
		messages: { id: string; date: number; subject: string; from: string; sent: boolean }[];
		blocked: boolean; mailbox: string; destination: string; recipient: string; token: string | null }> => {
		const scope = await ctx.runQuery(api.gmailConversations.linkContext, args.inquiryId ? { inquiryId: args.inquiryId } : { clientId: args.clientId });
		const m: Doc<"gmailMailboxes"> = await ctx.runQuery(internal.gmailState.getMailbox, { mailboxId: scope.mailboxId });
		const preview = threadPreview(await gmailClient(await access(m))(metadataPath(args.threadId)), {
			threadId: args.threadId, recipient: scope.recipient, mailbox: scope.mailbox,
		});
		const snapshot = { author: scope.author, mailboxId: scope.mailboxId, generation: scope.generation,
			record: args.inquiryId ? `inquiry:${args.inquiryId}` : `client:${args.clientId}`, recipient: scope.recipient,
			threadId: preview.threadId, digest: createHash("sha256").update(JSON.stringify(preview)).digest("hex"), expiresAt: Date.now() + 10 * 60_000 };
		return { threadId: preview.threadId, subject: preview.subject, participants: preview.participants, messageCount: preview.messageCount,
			messages: preview.rows.slice(-10).map(row => ({ id: row.id, date: row.date, subject: row.subject, from: row.from, sent: row.sent })),
			blocked: preview.blocked, mailbox: scope.mailbox, destination: scope.destination, recipient: scope.recipient,
			token: preview.blocked ? null : sealToken(JSON.stringify(snapshot), `link:${scope.siteUrl}`, setting("GMAIL_TOKEN_ENCRYPTION_KEY")) };
	},
});

export const confirmThread = action({
	args: { ...recordArgs, token: v.string() },
	handler: async (ctx, args): Promise<Id<"gmailConversations">> => {
		const record = args.inquiryId ? { inquiryId: args.inquiryId } : { clientId: args.clientId };
		const scope = await ctx.runQuery(api.gmailConversations.linkContext, record);
		if (args.token.length > 8192) throw new Error("Preview expired");
		const snapshot = object(JSON.parse(openToken(args.token, `link:${scope.siteUrl}`, setting("GMAIL_TOKEN_ENCRYPTION_KEY"))));
		if (snapshot.author !== scope.author || snapshot.mailboxId !== scope.mailboxId || snapshot.generation !== scope.generation ||
			snapshot.record !== (args.inquiryId ? `inquiry:${args.inquiryId}` : `client:${args.clientId}`) || snapshot.recipient !== scope.recipient ||
			typeof snapshot.expiresAt !== "number" || snapshot.expiresAt < Date.now()) throw new Error("Preview expired or the record changed. Preview again");
		const m: Doc<"gmailMailboxes"> = await ctx.runQuery(internal.gmailState.getMailbox, { mailboxId: scope.mailboxId });
		const threadId = providerId(snapshot.threadId);
		const preview = threadPreview(await gmailClient(await access(m))(metadataPath(threadId)), { threadId, recipient: scope.recipient, mailbox: scope.mailbox });
		if (preview.blocked || createHash("sha256").update(JSON.stringify(preview)).digest("hex") !== snapshot.digest)
			throw new Error("This thread changed. Preview its participants and scope again before linking");
		return ctx.runMutation(internal.gmailState.registerThread, { ...record, mailboxId: scope.mailboxId, generation: scope.generation,
			author: scope.author, threadId, recipient: scope.recipient, subject: preview.subject });
	},
});
