/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { gmailUploadType } from "./helpers/gmail/policy";
import schema from "./schema";

const connectorSecret = "synthetic-gmail-server-capability-20261101";
const modules = import.meta.glob("./**/*.ts");
const site = "gmail.example.test",
	otherSite = "other.example.test",
	owner = "owner@example.test";
beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal(
		"fetch",
		vi.fn(() => {
			throw new Error("Live network is forbidden in Gmail tests");
		}),
	);
	process.env.GMAIL_CONNECTOR_SECRET = connectorSecret;
	vi.stubEnv("GMAIL_PILOT_ALLOWED_MAILBOXES", JSON.stringify([owner]));
	vi.stubEnv("GMAIL_PILOT_ALLOWED_RECIPIENTS", JSON.stringify(["guest@example.test", "changed@example.test"]));
});
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	delete process.env.GMAIL_CONNECTOR_SECRET;
	vi.unstubAllEnvs();
});
async function setup() {
	const t = convexTest(schema, modules);
	const ids = await t.run(async (ctx) => {
		for (const [siteUrl, email] of [
			[site, owner],
			[otherSite, "other-owner@example.test"],
		])
			await ctx.db.insert("platformClients", {
				siteUrl,
				name: "Synthetic site",
				email,
				adminEmails: [email],
				tier: "full",
				subscriptionStatus: "active",
				role: "client",
			});
		const mailboxId = await ctx.db.insert("gmailMailboxes", {
			siteUrl: site,
			address: owner,
			encryptedRefreshToken: "synthetic-unused",
			generation: 1,
			status: "connected",
			cursor: "100",
			watchRenewedAt: Date.now(),
			watchExpiresAt: Date.now() + 7 * 86400000,
			lastSyncAt: Date.now(),
		});
		const clientId = await ctx.db.insert("photographyClients", {
			siteUrl: site,
			name: "Synthetic client",
			email: "guest@example.test",
			category: "photography",
			status: "lead",
		});
		const inquiryId = await ctx.db.insert("inquiries", {
			siteUrl: site,
			name: "Synthetic guest",
			email: "guest@example.test",
			subject: "Same subject",
			message: "Synthetic request",
			status: "new",
			clientId,
		});
		return { mailboxId, inquiryId, clientId };
	});
	const admin = t.withIdentity({ subject: "gmail-owner", email: owner, emailVerified: true });
	const outsider = t.withIdentity({
		subject: "other-owner",
		email: "other-owner@example.test",
		emailVerified: true,
	});
	const conversationId = await admin.mutation(api.gmailConversations.create, {
		inquiryId: ids.inquiryId,
	});
	await t.run((ctx) => ctx.db.patch(conversationId, { threadId: "thread1" }));
	return { t, admin, outsider, ...ids, conversationId };
}
const message = (id = "message1") => ({
	providerId: id,
	threadId: "thread1",
	rfcId: `<${id}@example.test>`,
	from: "guest@example.test",
	to: [owner],
	subject: "Same subject",
	text: "Synthetic reply",
	sent: false,
	date: Date.now(),
	attachments: [],
});
async function page(s: Awaited<ReturnType<typeof setup>>, ids: string[], extra = {}) {
	await s.t.mutation(internal.gmailState.acquire, { mailboxId: s.mailboxId, lease: "lease1" });
	await s.t.mutation(internal.gmailState.stagePage, {
		mailboxId: s.mailboxId,
		lease: "lease1",
		kind: "history",
		refs: ids.map((id) => ({ id, threadId: "thread1" })),
		endHistoryId: "90071992547409931234",
		done: true,
		...extra,
	});
}
async function queue(
	s: Awaited<ReturnType<typeof setup>>,
	requestId = "10000000-0000-4000-8000-000000000001",
) {
	const revision = await s.admin.mutation(api.gmailConversations.saveDraft, {
		conversationId: s.conversationId,
		expectedRevision: 0,
		text: "Keep This Capitalization",
		attachmentIds: [],
	});
	return s.admin.mutation(api.gmailConversations.queueSend, {
		conversationId: s.conversationId,
		requestId,
		draftRevision: revision,
		conversationRevision: 0,
	});
}
describe("Gmail record and tenant ownership", () => {
	test("separate records with identical subjects and participants never merge", async () => {
		const s = await setup();
		const second = await s.t.run((ctx) =>
			ctx.db.insert("inquiries", {
				siteUrl: site,
				name: "Second request",
				email: "guest@example.test",
				subject: "Same subject",
				message: "Second record",
				status: "new",
			}),
		);
		const next = await s.admin.mutation(api.gmailConversations.create, { inquiryId: second });
		expect(next).not.toBe(s.conversationId);
		expect(await s.admin.mutation(api.gmailConversations.create, { inquiryId: s.inquiryId })).toBe(
			s.conversationId,
		);
	});
	test("enforces membership on every conversation, draft, and attachment read/write", async () => {
		const s = await setup();
		await expect(
			s.outsider.query(api.gmailConversations.detail, { conversationId: s.conversationId }),
		).rejects.toThrow();
		await expect(
			s.outsider.mutation(api.gmailConversations.saveDraft, {
				conversationId: s.conversationId,
				expectedRevision: 0,
				text: "No access",
				attachmentIds: [],
			}),
		).rejects.toThrow();
		await expect(s.t.query(api.gmailConversations.connection, { siteUrl: site })).rejects.toThrow();
		const attachment = await s.admin.mutation(api.gmailConversations.reserveAttachment, {
			conversationId: s.conversationId,
			name: "synthetic.png",
			type: "image/png",
			size: 68,
			sha256: "a".repeat(64),
			expectedRevision: 0,
		});
		await expect(
			s.t.query(api.gmailState.fileTransport, {
				secret: "wrong",
				attachmentId: attachment.attachmentId,
			}),
		).rejects.toThrow("unavailable");
	});
	test("mailbox reassignment cannot join another tenant or replace the stored account", async () => {
		const s = await setup();
		const args = {
			address: owner,
			encryptedRefreshToken: "synthetic",
			historyId: "5000",
			watchExpiresAt: Date.now() + 10000,
		};
		await expect(
			s.t.mutation(internal.gmailState.install, { ...args, siteUrl: otherSite }),
		).rejects.toThrow("mailbox reassignment");
		await expect(
			s.t.mutation(internal.gmailState.install, {
				...args,
				siteUrl: site,
				address: "different@example.test",
			}),
		).rejects.toThrow("originally connected");
	});
});
describe("Gmail atomic cursor and import recovery", () => {
	test("a failing batch rolls back imported rows and page progress together", async () => {
		const s = await setup();
		await page(s, ["message1", "message2"]);
		await expect(
			s.t.mutation(internal.gmailState.commitBatch, {
				mailboxId: s.mailboxId,
				lease: "lease1",
				consumed: 2,
				messages: [message(), message("outside-batch")],
			}),
		).rejects.toThrow();
		const state = await s.t.run(async (ctx) => ({
			mailbox: await ctx.db.get(s.mailboxId),
			rows: await ctx.db.query("gmailMessages").take(10),
		}));
		expect(state.rows).toHaveLength(0);
		expect(state.mailbox?.cursor).toBe("100");
		expect(state.mailbox?.pending?.offset).toBe(0);
	});
	test("paginates the whole mailbox change range before advancing or acknowledging; replays deduplicate Gmail IDs", async () => {
		const s = await setup();
		await page(s, ["message1", "message2"], { done: false, nextPageToken: "next-page" });
		await s.t.mutation(internal.gmailState.commitBatch, {
			mailboxId: s.mailboxId,
			lease: "lease1",
			consumed: 1,
			messages: [message()],
		});
		const notice = {
			mailboxId: s.mailboxId,
			pubsubId: "1234567",
			historyId: "90071992547409931234",
		};
		expect(await s.t.mutation(internal.gmailState.acknowledge, notice)).toBe(false);
		await s.t.mutation(internal.gmailState.commitBatch, {
			mailboxId: s.mailboxId,
			lease: "lease1",
			consumed: 1,
			messages: [message("message2")],
		});
		expect((await s.t.run((ctx) => ctx.db.get(s.mailboxId)))?.cursor).toBe("100");
		expect(await s.t.mutation(internal.gmailState.acknowledge, notice)).toBe(false);
		await s.t.mutation(internal.gmailState.stagePage, {
			mailboxId: s.mailboxId,
			lease: "lease1",
			kind: "history",
			refs: [{ id: "message1", threadId: "thread1" }],
			endHistoryId: notice.historyId,
			done: true,
		});
		await s.t.mutation(internal.gmailState.commitBatch, {
			mailboxId: s.mailboxId,
			lease: "lease1",
			consumed: 1,
			messages: [message()],
		});
		expect(await s.t.mutation(internal.gmailState.acknowledge, notice)).toBe(true);
		expect(await s.t.mutation(internal.gmailState.acknowledge, notice)).toBe(true);
		const state = await s.t.run(async (ctx) => ({
			mailbox: await ctx.db.get(s.mailboxId),
			rows: await ctx.db.query("gmailMessages").take(10),
			receipts: await ctx.db.query("gmailPushReceipts").take(10),
		}));
		expect(state.mailbox?.cursor).toBe(notice.historyId);
		expect(state.rows).toHaveLength(2);
		expect(state.receipts).toHaveLength(1);
	});
	test("a resumed worker fences stale leases, and expired history never resets the cursor before resync finishes", async () => {
		const s = await setup();
		await page(s, ["message1"]);
		expect(
			await s.t.mutation(internal.gmailState.acquire, { mailboxId: s.mailboxId, lease: "other" }),
		).toBeNull();
		vi.advanceTimersByTime(91000);
		expect(
			await s.t.mutation(internal.gmailState.acquire, { mailboxId: s.mailboxId, lease: "new" }),
		).not.toBeNull();
		await expect(
			s.t.mutation(internal.gmailState.commitBatch, {
				mailboxId: s.mailboxId,
				lease: "lease1",
				consumed: 1,
				messages: [message()],
			}),
		).rejects.toThrow("lease");
		await s.t.mutation(internal.gmailState.startResync, {
			mailboxId: s.mailboxId,
			lease: "new",
			anchor: "900000",
		});
		expect((await s.t.run((ctx) => ctx.db.get(s.mailboxId)))?.cursor).toBe("100");
		await s.t.mutation(internal.gmailState.stagePage, {
			mailboxId: s.mailboxId,
			lease: "new",
			kind: "resync",
			refs: [],
			done: true,
			endHistoryId: "900000",
		});
		await s.t.mutation(internal.gmailState.commitBatch, {
			mailboxId: s.mailboxId,
			lease: "new",
			consumed: 0,
			messages: [],
		});
		const m = await s.t.run((ctx) => ctx.db.get(s.mailboxId));
		expect(m?.cursor).toBe("900000");
		expect(m?.resync).toBeUndefined();
	});
	test("reconnection preserves the committed cursor and invalidates old worker authority", async () => {
		const s = await setup();
		await page(s, ["message1"]);
		await s.t.mutation(internal.gmailState.install, {
			siteUrl: site,
			address: owner,
			encryptedRefreshToken: "new-synthetic",
			historyId: "100000",
			watchExpiresAt: Date.now() + 10000,
		});
		const m = await s.t.run((ctx) => ctx.db.get(s.mailboxId));
		expect(m?.cursor).toBe("100");
		expect(m?.generation).toBe(2);
		await expect(
			s.t.mutation(internal.gmailState.commitBatch, {
				mailboxId: s.mailboxId,
				lease: "lease1",
				consumed: 1,
				messages: [message()],
			}),
		).rejects.toThrow();
	});
});
describe("Gmail send and file durability", () => {
	test("freezes once, blocks uncertain resend, and merges returning Sent without another message/send", async () => {
		const s = await setup(),
			attemptId = await queue(s);
		expect(
			await s.admin.mutation(api.gmailConversations.queueSend, {
				conversationId: s.conversationId,
				requestId: "10000000-0000-4000-8000-000000000001",
				draftRevision: 1,
				conversationRevision: 0,
			}),
		).toBe(attemptId);
		expect(await s.t.mutation(internal.gmailState.claimSend, { attemptId })).toBe(true);
		expect(await s.t.mutation(internal.gmailState.claimSend, { attemptId })).toBe(false);
		await s.t.mutation(internal.gmailState.failSend, {
			attemptId,
			submitted: true,
			uncertain: true,
			problem: "Synthetic timeout after submitting",
		});
		await expect(
			s.admin.mutation(api.gmailConversations.queueSend, {
				conversationId: s.conversationId,
				requestId: "20000000-0000-4000-8000-000000000002",
				draftRevision: 1,
				conversationRevision: 0,
			}),
		).rejects.toThrow("existing send");
		expect(
			(await s.admin.query(api.gmailConversations.detail, { conversationId: s.conversationId }))
				.draft.text,
		).toBe("Keep This Capitalization");
		await s.t.mutation(internal.gmailState.acceptSend, {
			attemptId,
			providerId: "sent1",
			threadId: "thread1",
			date: Date.now(),
		});
		await page(s, ["sent1"]);
		await s.t.mutation(internal.gmailState.commitBatch, {
			mailboxId: s.mailboxId,
			lease: "lease1",
			consumed: 1,
			messages: [{ ...message("sent1"), sent: true, from: owner, to: ["guest@example.test"] }],
		});
		expect(await s.t.run((ctx) => ctx.db.query("gmailMessages").take(10))).toHaveLength(1);
		expect(
			(await s.admin.query(api.gmailConversations.detail, { conversationId: s.conversationId }))
				.draft.text,
		).toBe("");
		expect(fetch).not.toHaveBeenCalled();
	});
	test("new native replies and record email changes invalidate a frozen send before provider submission", async () => {
		const s = await setup(),
			attemptId = await queue(s);
		await page(s, ["message1"]);
		await s.t.mutation(internal.gmailState.commitBatch, {
			mailboxId: s.mailboxId,
			lease: "lease1",
			consumed: 1,
			messages: [message()],
		});
		expect(await s.t.mutation(internal.gmailState.claimSend, { attemptId })).toBe(false);
		expect((await s.t.run((ctx) => ctx.db.get(attemptId)))?.status).toBe("failed");
		expect(
			(await s.admin.query(api.gmailConversations.detail, { conversationId: s.conversationId }))
				.draft.text,
		).toBe("Keep This Capitalization");
	});
	test("a pending or failed file survives reload and blocks sends; a foreign draft cannot attach it", async () => {
		const s = await setup();
		const reserved = await s.admin.mutation(api.gmailConversations.reserveAttachment, {
			conversationId: s.conversationId,
			name: "photo.png",
			type: "image/png",
			size: 68,
			sha256: "a".repeat(64),
			expectedRevision: 0,
		});
		let detail = await s.admin.query(api.gmailConversations.detail, {
			conversationId: s.conversationId,
		});
		expect(detail.draft.attachments[0]).toMatchObject({
			_id: reserved.attachmentId,
			status: "pending",
		});
		await expect(
			s.admin.mutation(api.gmailConversations.queueSend, {
				conversationId: s.conversationId,
				requestId: "30000000-0000-4000-8000-000000000003",
				draftRevision: reserved.revision,
				conversationRevision: 0,
			}),
		).rejects.toThrow("unavailable");
		await s.t.mutation(api.gmailState.failUpload, {
			secret: connectorSecret,
			attachmentId: reserved.attachmentId,
		});
		detail = await s.admin.query(api.gmailConversations.detail, {
			conversationId: s.conversationId,
		});
		expect(detail.draft.attachments[0].status).toBe("blocked");
		await expect(
			s.outsider.query(api.gmailConversations.uploadAccess, {
				attachmentId: reserved.attachmentId,
			}),
		).rejects.toThrow();
		await s.admin.mutation(api.gmailConversations.retryAttachment, {
			attachmentId: reserved.attachmentId,
		});
		expect(
			(await s.admin.query(api.gmailConversations.detail, { conversationId: s.conversationId }))
				.draft.attachments[0].status,
		).toBe("pending");
	});
	test("draft CAS protects another tab's work", async () => {
		const s = await setup();
		await s.admin.mutation(api.gmailConversations.saveDraft, {
			conversationId: s.conversationId,
			text: "First tab",
			attachmentIds: [],
			expectedRevision: 0,
		});
		await expect(
			s.admin.mutation(api.gmailConversations.saveDraft, {
				conversationId: s.conversationId,
				text: "Second tab",
				attachmentIds: [],
				expectedRevision: 0,
			}),
		).rejects.toThrow("another tab");
		expect(
			(await s.admin.query(api.gmailConversations.detail, { conversationId: s.conversationId }))
				.draft.text,
		).toBe("First tab");
	});
	test("OAuth intents are tenant/identity-bound, expiring and single-use", async () => {
		const s = await setup(),
			nonce = "n".repeat(43);
		const id = await s.admin.mutation(api.gmailConversations.beginConnect, {
			siteUrl: site,
			nonce,
		});
		await expect(
			s.outsider.mutation(api.gmailConversations.consumeConnect, { id, nonce }),
		).rejects.toThrow();
		expect(await s.admin.mutation(api.gmailConversations.consumeConnect, { id, nonce })).toBe(site);
		await expect(
			s.admin.mutation(api.gmailConversations.consumeConnect, { id, nonce }),
		).rejects.toThrow("expired");
	});
});

test("a second queued worker cannot downgrade another worker's in-flight send", async () => {
	const s = await setup();
	await s.admin.mutation(api.gmailConversations.saveDraft, {
		conversationId: s.conversationId,
		text: "One reply",
		attachmentIds: [],
		expectedRevision: 0,
	});
	const attemptId = await s.admin.mutation(api.gmailConversations.queueSend, {
		conversationId: s.conversationId,
		requestId: "50000000-0000-4000-8000-000000000005",
		draftRevision: 1,
		conversationRevision: 0,
	});
	expect(await s.t.mutation(internal.gmailState.claimSend, { attemptId })).toBe(true);
	await s.t.mutation(internal.gmailState.failSend, {
		attemptId,
		submitted: false,
		uncertain: false,
		problem: "Second worker lost the sync lease",
	});
	expect((await s.t.run((ctx) => ctx.db.get(attemptId)))?.status).toBe("submitting");
	await expect(
		s.admin.mutation(api.gmailConversations.queueSend, {
			conversationId: s.conversationId,
			requestId: "60000000-0000-4000-8000-000000000006",
			draftRevision: 1,
			conversationRevision: 0,
		}),
	).rejects.toThrow("existing send");
});

test("orphan cleanup deletes only old marked, unreferenced Gmail uploads", async () => {
	const s = await setup();
	const reserved = await s.admin.mutation(api.gmailConversations.reserveAttachment, {
		conversationId: s.conversationId,
		name: "reference.pdf",
		type: "application/pdf",
		size: 8,
		sha256: "a".repeat(64),
		expectedRevision: 0,
	});
	const blobs = await s.t.run(async (ctx) => ({
		kept: await ctx.storage.store(
			new Blob(["%PDF-1.7"], { type: gmailUploadType(reserved.attachmentId) }),
		),
		orphan: await ctx.storage.store(
			new Blob(["%PDF-1.7"], { type: gmailUploadType(reserved.attachmentId) }),
		),
		unrelated: await ctx.storage.store(new Blob(["unrelated"], { type: "image/png" })),
	}));
	await s.t.run(async (ctx) => {
		for (const objectId of [blobs.kept, blobs.orphan]) {
			// @ts-expect-error convex-test omits Content-Type metadata from its simulated HTTP storage upload.
			await ctx.db.patch(objectId, { contentType: gmailUploadType(reserved.attachmentId) });
		}
	});
	expect(
		await s.t.mutation(api.gmailState.completeUpload, {
			secret: connectorSecret,
			attachmentId: reserved.attachmentId,
			storageId: blobs.kept,
		}),
	).toBe(true);
	vi.advanceTimersByTime(25 * 60 * 60_000);
	await s.t.mutation(internal.gmailState.cleanUploadOrphans, {});
	await s.t.run(async (ctx) => {
		expect(await ctx.storage.get(blobs.kept)).not.toBeNull();
		expect(await ctx.storage.get(blobs.orphan)).toBeNull();
		expect(await ctx.storage.get(blobs.unrelated)).not.toBeNull();
	});
});

test("tenant offboarding fences Gmail work and erases its local refresh grant", async () => {
	const s = await setup();
	const clientId = await s.t.run(async (ctx) => {
		await ctx.db.insert("platformClients", {
			siteUrl: "angelsrest.online",
			name: "Creator",
			email: "creator@example.test",
			adminEmails: ["creator@example.test"],
			role: "creator",
			tier: "full",
			subscriptionStatus: "active",
		});
		const tenant = await ctx.db
			.query("platformClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", site))
			.unique();
		if (!tenant) throw new Error("Missing synthetic tenant");
		return tenant._id;
	});
	await s.t
		.withIdentity({ subject: "creator", email: "creator@example.test", emailVerified: true })
		.mutation(api.platformOffboarding.disable, { clientId, confirmSiteUrl: site });
	const mailbox = await s.t.run((ctx) => ctx.db.get(s.mailboxId));
	expect(mailbox?.status).toBe("disconnected");
	expect(mailbox?.encryptedRefreshToken).toBeUndefined();
	expect(mailbox?.generation).toBe(2);
	await expect(
		s.admin.query(api.gmailConversations.detail, { conversationId: s.conversationId }),
	).rejects.toThrow();
});

async function commit(s: Awaited<ReturnType<typeof setup>>, values: ReturnType<typeof message>[]) {
	await page(s, values.map(m => m.providerId));
	await s.t.mutation(internal.gmailState.commitBatch, { mailboxId: s.mailboxId, lease: "lease1", consumed: values.length, messages: values });
	await s.t.mutation(internal.gmailState.release, { mailboxId: s.mailboxId, lease: "lease1" });
}
describe("explicit thread association", () => {
	test("registration is record-authorized, mailbox-bound, replayable, and schedules resumable import", async () => {
		const s = await setup();
		const scope = await s.admin.query(api.gmailConversations.linkContext, { clientId: s.clientId });
		expect(JSON.stringify(scope)).not.toContain("encryptedRefreshToken");
		const args = { clientId: s.clientId, mailboxId: s.mailboxId, generation: scope.generation, author: scope.author, threadId: "selected-thread", recipient: scope.recipient, subject: "Explicitly selected thread" };
		await expect(s.outsider.mutation(internal.gmailState.registerThread, args)).rejects.toThrow();
		await expect(s.admin.mutation(internal.gmailState.registerThread, { ...args, generation: 0 })).rejects.toThrow("changed");
		const conversationId = await s.admin.mutation(internal.gmailState.registerThread, args);
		expect(await s.admin.mutation(internal.gmailState.registerThread, args)).toBe(conversationId);
		await expect(s.admin.mutation(internal.gmailState.registerThread, { ...args, clientId: undefined, inquiryId: s.inquiryId })).rejects.toThrow("different record");
		const state = await s.t.run(async ctx => ({ c: await ctx.db.get(conversationId), m: await ctx.db.get(s.mailboxId) }));
		expect(state.c).toMatchObject({ importPending: true, clientId: s.clientId, threadId: args.threadId });
		expect(state.m).toMatchObject({ resync: { anchor: "100" } });
		expect(state.m?.pending).toBeUndefined();
	});
	test("ownership is rechecked when a fetched sync batch commits", async () => {
		const s = await setup();
		await page(s, ["message1"]);
		await s.t.run(ctx => ctx.db.patch(s.inquiryId, { siteUrl: otherSite }));
		await s.t.mutation(internal.gmailState.commitBatch, { mailboxId: s.mailboxId, lease: "lease1", consumed: 1, messages: [message()] });
		expect(await s.t.run(ctx => ctx.db.query("gmailMessages").take(10))).toEqual([]);
	});
});

describe("correspondence attention workflow", () => {
	test("incoming means review; an explicit needs-reply choice and follow-up clear on a newer native Sent reply", async () => {
		const s = await setup();
		await commit(s, [message()]);
		let detail = await s.admin.query(api.gmailConversations.detail, { conversationId: s.conversationId });
		expect(detail.conversation.workflowState).toBe("review");
		await s.admin.mutation(api.gmailConversations.setWorkflow, { conversationId: s.conversationId, state: "needs_reply", followUpAt: Date.now() + 86400000, expectedRevision: detail.conversation.revision });
		const queued = await s.admin.query(api.gmailConversations.queue, { siteUrl: site, state: "needs_reply", paginationOpts: { cursor: null, numItems: 25 } });
		expect(queued.page).toHaveLength(1);
		expect(queued.page[0].incoming?.text).toBe("Synthetic reply");
		vi.setSystemTime(Date.now() + 1000);
		await commit(s, [{ ...message("native-sent"), sent: true, from: owner, to: ["guest@example.test"] }]);
		detail = await s.admin.query(api.gmailConversations.detail, { conversationId: s.conversationId });
		expect(detail.conversation.workflowState).toBe("waiting");
		expect(detail.conversation.followUpAt).toBeUndefined();
		expect(detail.conversation.lastIncomingId).toBeDefined();
	});
	test("duplicate and older mail do not reopen manual done; newer incoming does, without assuming a response", async () => {
		const s = await setup();
		const first = message();
		await commit(s, [first]);
		const detail = await s.admin.query(api.gmailConversations.detail, { conversationId: s.conversationId });
		await s.admin.mutation(api.gmailConversations.setWorkflow, { conversationId: s.conversationId, state: "done", followUpAt: null, expectedRevision: detail.conversation.revision });
		await commit(s, [first, { ...message("older"), date: first.date - 1000 }]);
		expect((await s.t.run(ctx => ctx.db.get(s.conversationId)))?.workflowState).toBe("done");
		vi.setSystemTime(Date.now() + 1000);
		await commit(s, [message("newer")]);
		expect((await s.t.run(ctx => ctx.db.get(s.conversationId)))?.workflowState).toBe("review");
	});
	test("queue and edits enforce membership, feature access, valid dates and message revisions", async () => {
		const s = await setup();
		await expect(s.outsider.query(api.gmailConversations.queue, { siteUrl: site, paginationOpts: { cursor: null, numItems: 25 } })).rejects.toThrow();
		await expect(s.admin.mutation(api.gmailConversations.setWorkflow, { conversationId: s.conversationId, state: "needs_reply", followUpAt: Infinity, expectedRevision: 0 })).rejects.toThrow("valid follow-up");
		await commit(s, [message()]);
		await expect(s.admin.mutation(api.gmailConversations.setWorkflow, { conversationId: s.conversationId, state: "done", followUpAt: null, expectedRevision: 0 })).rejects.toThrow("changed");
		await s.t.run(ctx => ctx.db.patch(s.inquiryId, { siteUrl: otherSite }));
		expect((await s.admin.query(api.gmailConversations.queue, { siteUrl: site, paginationOpts: { cursor: null, numItems: 25 } })).page).toEqual([]);
	});
});

describe("pilot retention, erasure and export", () => {
	test("unresolved sends hold both immediate and 30-day erasure without losing frozen evidence", async () => {
		const s = await setup(), attemptId = await queue(s);
		await s.t.mutation(internal.gmailState.claimSend, { attemptId });
		await s.t.mutation(internal.gmailState.failSend, { attemptId, submitted: true, uncertain: true, problem: "Lost provider response" });
		await expect(s.admin.mutation(api.gmailConversations.requestDeletion, { conversationId: s.conversationId, confirm: "delete imported conversation" })).rejects.toThrow("on hold");
		vi.setSystemTime(Date.now() + 31 * 86400000);
		await s.t.mutation(internal.gmailState.retain, {});
		const c = await s.t.run(ctx => ctx.db.get(s.conversationId));
		expect(c?.retentionHoldAt).toBeDefined();
		expect(c?.deletingAt).toBeUndefined();
		expect(await s.t.run(ctx => ctx.db.get(attemptId))).toMatchObject({ status: "uncertain", text: "Keep This Capitalization" });
		await expect(s.admin.mutation(api.gmailConversations.queueSend, { conversationId: s.conversationId, requestId: "20000000-0000-4000-8000-000000000001", draftRevision: 1, conversationRevision: 0 })).rejects.toThrow();
		await s.t.mutation(internal.gmailState.acceptSend, { attemptId, providerId: "accepted-after-review", threadId: "thread1", date: Date.now() });
		await s.t.mutation(internal.gmailState.retain, {});
		for (let i = 0; i < 5; i++) await s.t.mutation(internal.gmailState.eraseConversation, { conversationId: s.conversationId });
		expect(await s.t.run(ctx => ctx.db.get(s.conversationId))).toBeNull();
		expect(await s.t.run(ctx => ctx.db.get(attemptId))).toBeNull();
	});
	test("deletion removes cached bytes and draft data in resumable stages; a fetched late batch cannot resurrect them", async () => {
		const s = await setup();
		const reservation = await s.admin.mutation(api.gmailConversations.reserveAttachment, { conversationId: s.conversationId, name: "photo.png", type: "image/png", size: 4, sha256: "a".repeat(64), expectedRevision: 0 });
		const storageId = await s.t.run(async ctx => { const id = await ctx.storage.store(new Blob(["test"])); await ctx.db.patch(reservation.attachmentId, { storageId: id, status: "ready" }); return id; });
		await page(s, ["message1"]);
		await s.admin.mutation(api.gmailConversations.requestDeletion, { conversationId: s.conversationId, confirm: "delete imported conversation" });
		await expect(s.admin.mutation(api.gmailConversations.saveDraft, { conversationId: s.conversationId, expectedRevision: 1, attachmentIds: [], text: "late draft" })).rejects.toThrow();
		await s.t.mutation(internal.gmailState.commitBatch, { mailboxId: s.mailboxId, lease: "lease1", consumed: 1, messages: [message()] });
		await s.t.mutation(internal.gmailState.eraseConversation, { conversationId: s.conversationId });
		expect(await s.t.run(ctx => ctx.storage.get(storageId))).toBeNull();
		for (let i = 0; i < 4; i++) await s.t.mutation(internal.gmailState.eraseConversation, { conversationId: s.conversationId });
		expect(await s.t.run(ctx => ctx.db.query("gmailMessages").take(10))).toEqual([]);
		expect(await s.t.run(ctx => ctx.db.query("gmailDrafts").take(10))).toEqual([]);
		expect(await s.t.run(ctx => ctx.db.get(s.inquiryId))).not.toBeNull();
	});
	test("mailbox erasure requires stopped sync, exact confirmation and no unresolved attempt; it preserves the ownership registry", async () => {
		const s = await setup();
		await expect(s.outsider.mutation(api.gmailConversations.deleteMailboxData, { siteUrl: site, confirmAddress: owner })).rejects.toThrow();
		await expect(s.admin.mutation(api.gmailConversations.deleteMailboxData, { siteUrl: site, confirmAddress: owner })).rejects.toThrow("Stop synchronization");
		await s.t.mutation(api.gmailState.disconnect, { secret: connectorSecret, siteUrl: site });
		await s.t.mutation(internal.gmailState.finishDisconnect, { mailboxId: s.mailboxId, generation: 2 });
		await expect(s.admin.mutation(api.gmailConversations.deleteMailboxData, { siteUrl: site, confirmAddress: "wrong@example.test" })).rejects.toThrow("exact");
		await s.admin.mutation(api.gmailConversations.deleteMailboxData, { siteUrl: site, confirmAddress: owner });
		await s.t.mutation(internal.gmailState.eraseMailboxData, { mailboxId: s.mailboxId });
		await s.t.mutation(internal.gmailState.eraseConversation, { conversationId: s.conversationId });
		await s.t.mutation(internal.gmailState.eraseMailboxData, { mailboxId: s.mailboxId });
		const m = await s.t.run(ctx => ctx.db.get(s.mailboxId));
		expect(m).toMatchObject({ siteUrl: site, address: owner, status: "disconnected" });
		expect(m?.lastDataDeletionAt).toBeDefined();
		expect(m?.encryptedRefreshToken).toBeUndefined();
	});
	test("exports reauthorize every page and exclude credentials, storage links, and another administrator's private draft", async () => {
		const s = await setup();
		await s.admin.mutation(api.gmailConversations.saveDraft, { conversationId: s.conversationId, expectedRevision: 0, text: "My private draft", attachmentIds: [] });
		await s.t.run(ctx => ctx.db.insert("gmailDrafts", { conversationId: s.conversationId, author: "another-administrator", text: "Not shared", attachmentIds: [], revision: 1 }));
		const context = await s.admin.query(api.gmailConversations.exportContext, { conversationId: s.conversationId });
		expect(context.draft?.text).toBe("My private draft");
		expect(JSON.stringify(context)).not.toContain("encryptedRefreshToken");
		await expect(s.outsider.query(api.gmailConversations.exportPage, { conversationId: s.conversationId, section: "messages", paginationOpts: { cursor: null, numItems: 25 } })).rejects.toThrow();
	});
	test("record deletion cannot orphan conversation authorization or send evidence", async () => {
		const s = await setup();
		await expect(s.admin.mutation(api.inquiries.remove, { id: s.inquiryId })).rejects.toThrow("Gmail");
		await expect(s.admin.mutation(api.crm.deleteClient, { clientId: s.clientId, siteUrl: site })).rejects.toThrow("Gmail");
	});
});

test("Gmail's observed Sent timestamp, not local acceptance timing, determines whether attention clears", async () => {
	const s = await setup();
	const attemptId = await queue(s);
	await s.t.mutation(internal.gmailState.claimSend, { attemptId });
	vi.setSystemTime(Date.now() + 1000);
	await commit(s, [message("arrived-during-send")]);
	const incomingAt = Date.now();
	vi.setSystemTime(Date.now() + 1000);
	await s.t.mutation(internal.gmailState.acceptSend, { attemptId, providerId: "accepted-message", threadId: "thread1", date: Date.now() });
	expect((await s.t.run(ctx => ctx.db.get(s.conversationId)))?.workflowState).toBe("review");
	await commit(s, [{ ...message("accepted-message"), sent: true, from: owner, to: ["guest@example.test"], date: incomingAt - 500 }]);
	expect((await s.t.run(ctx => ctx.db.get(s.conversationId)))?.workflowState).toBe("review");
	await commit(s, [{ ...message("truly-newer-sent"), sent: true, from: owner, to: ["guest@example.test"] }]);
	expect((await s.t.run(ctx => ctx.db.get(s.conversationId)))?.workflowState).toBe("waiting");
});

test("pilot allowlists fail closed and are rechecked at the final provider submission claim", async () => {
	const s = await setup(), attemptId = await queue(s);
	vi.stubEnv("GMAIL_PILOT_ALLOWED_RECIPIENTS", "[]");
	await expect(s.admin.mutation(api.gmailConversations.create, { clientId: s.clientId })).rejects.toThrow("allowlist");
	expect(await s.t.mutation(internal.gmailState.claimSend, { attemptId })).toBe(false);
	expect(await s.t.run(ctx => ctx.db.get(attemptId))).toMatchObject({ status: "failed" });
	vi.stubEnv("GMAIL_PILOT_ALLOWED_RECIPIENTS", "malformed");
	await expect(s.admin.query(api.gmailConversations.linkContext, { inquiryId: s.inquiryId })).rejects.toThrow("allowlist");
});

test("offboarding fences access and cannot enter irreversible erasure while Gmail evidence needs reconciliation", async () => {
	const s = await setup(), attemptId = await queue(s);
	await s.t.mutation(internal.gmailState.claimSend, { attemptId });
	await s.t.mutation(internal.gmailState.failSend, { attemptId, submitted: true, uncertain: true, problem: "Provider result unknown" });
	await s.t.run(ctx => ctx.db.insert("platformClients", { siteUrl: "angelsrest.online", name: "Synthetic operator", email: "operator@example.test", adminEmails: ["operator@example.test"], tier: "full", subscriptionStatus: "active", role: "creator" }));
	const operator = s.t.withIdentity({ subject: "operator", email: "operator@example.test", emailVerified: true });
	const tenant = await s.t.run(ctx => ctx.db.query("platformClients").withIndex("by_siteUrl", q => q.eq("siteUrl", site)).unique());
	await operator.mutation(api.platformOffboarding.disable, { clientId: tenant!._id, confirmSiteUrl: site });
	await expect(s.admin.query(api.gmailConversations.detail, { conversationId: s.conversationId })).rejects.toThrow();
	await expect(operator.mutation(api.platformOffboarding.requestErasure, { clientId: tenant!._id, confirmSiteUrl: site, eraseImmediately: true })).rejects.toThrow("Gmail send evidence");
	await expect(operator.mutation(api.gmailConversations.deleteMailboxData, { siteUrl: site, confirmAddress: owner })).rejects.toThrow("unresolved send");
	expect(await s.t.run(ctx => ctx.db.get(s.mailboxId))).toMatchObject({ status: "disconnected", generation: 2 });
	expect((await s.t.run(ctx => ctx.db.get(s.mailboxId)))?.encryptedRefreshToken).toBeUndefined();
	await operator.mutation(api.platformOffboarding.restoreAccess, { clientId: tenant!._id, confirmSiteUrl: site });
	expect((await s.t.run(ctx => ctx.db.get(tenant!._id)))?.offboarding).toBeUndefined();
	expect(await s.t.run(ctx => ctx.db.get(attemptId))).toMatchObject({ status: "uncertain", text: "Keep This Capitalization" });
});

test("removing a record's contact email does not hide retained correspondence or block authorized export and deletion", async () => {
	const s = await setup();
	await s.t.run(ctx => ctx.db.patch(s.inquiryId, { email: "" }));
	const detail = await s.admin.query(api.gmailConversations.detail, { conversationId: s.conversationId });
	expect(detail.recipientChanged).toBe(true);
	expect((await s.admin.query(api.gmailConversations.exportContext, { conversationId: s.conversationId })).conversation.recipient).toBe("guest@example.test");
	await expect(s.admin.mutation(api.gmailConversations.create, { inquiryId: s.inquiryId })).rejects.toThrow("allowlist");
	await s.admin.mutation(api.gmailConversations.requestDeletion, { conversationId: s.conversationId, confirm: "delete imported conversation" });
	expect((await s.t.run(ctx => ctx.db.get(s.conversationId)))?.deletingAt).toBeDefined();
});
