/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { gmailScopes } from "./helpers/gmail/policy";
import { sealToken } from "./helpers/gmail/protocol";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const siteUrl = "gmail-sync.example.test",
	mailbox = "owner@example.test",
	recipient = "guest@example.test",
	key = Buffer.alloc(32, 9).toString("base64url");
const response = (value: unknown, status = 200) => Response.json(value, { status });
const settings = {
	GMAIL_PILOT_ALLOWED_MAILBOXES: JSON.stringify([mailbox, "business@example.test"]),
	GMAIL_PILOT_ALLOWED_RECIPIENTS: JSON.stringify([recipient]),
	GMAIL_CONNECTOR_SECRET: "synthetic-only-gmail-server-credential",
	GMAIL_TOKEN_ENCRYPTION_KEY: key,
	GMAIL_OAUTH_CLIENT_ID: "synthetic-only-client",
	GMAIL_OAUTH_CLIENT_SECRET: "synthetic-only-secret",
	GMAIL_PUBSUB_TOPIC: "projects/synthetic-only/topics/gmail",
};
beforeEach(() => {
	vi.useFakeTimers();
	for (const [key, value] of Object.entries(settings)) vi.stubEnv(key, value);
});
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});
async function setup() {
	const t = convexTest(schema, modules);
	const ids = await t.run(async (ctx) => {
		await ctx.db.insert("platformClients", {
			siteUrl,
			name: "Synthetic tenant",
			email: mailbox,
			adminEmails: [mailbox],
			tier: "full",
			subscriptionStatus: "active",
			role: "client",
		});
		const mailboxId = await ctx.db.insert("gmailMailboxes", {
			siteUrl,
			address: mailbox,
			status: "connected",
			generation: 1,
			encryptedRefreshToken: sealToken("synthetic-only-refresh", siteUrl, key),
			cursor: "100",
			watchExpiresAt: Date.now() + 7 * 86400000,
			watchRenewedAt: Date.now() - 2 * 86400000,
			lastSyncAt: Date.now(),
		});
		const inquiryId = await ctx.db.insert("inquiries", {
			siteUrl,
			name: "Synthetic guest",
			email: recipient,
			subject: "Synthetic conversation",
			message: "Synthetic inquiry",
			status: "new",
		});
		const conversationId = await ctx.db.insert("gmailConversations", {
			siteUrl,
			mailboxId,
			inquiryId,
			recipient,
			subject: "Synthetic conversation",
			threadId: "thread1",
			lastRfcId: "<parent@example.test>",
			revision: 0,
		});
		return { mailboxId, conversationId, inquiryId };
	});
	return {
		t,
		...ids,
		admin: t.withIdentity({ subject: "sync-owner", email: mailbox, emailVerified: true }),
	};
}
test("linked mailbox mismatch is a safe domain error and never creates a watch", async () => {
	const s = await setup();
	const fetcher = vi.fn(async () =>
		response({ emailAddress: "wrong@example.test", historyId: "100" }),
	);
	vi.stubGlobal("fetch", fetcher);
	const failure = await s.t
		.action(internal.gmailNode.installLinked, {
			siteUrl,
			expectedAddress: mailbox,
			accessToken: "synthetic-access-secret",
			refreshToken: "synthetic-refresh-secret",
		})
		.catch((error: unknown) => error);
	expect(failure).toMatchObject({ data: { code: "account_mismatch", stage: "profile" } });
	expect(fetcher).toHaveBeenCalledOnce();
	expect(String(failure)).not.toContain("synthetic-");
});
test("watch failure is sanitized before leaving the token-bearing action", async () => {
	const s = await setup();
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request) => {
			const url = new URL(
				typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
			);
			if (url.pathname.endsWith("/profile"))
				return response({ emailAddress: mailbox, historyId: "100" });
			throw new Error("synthetic-access-secret synthetic-refresh-secret");
		}),
	);
	const failure = await s.t
		.action(internal.gmailNode.installLinked, {
			siteUrl,
			expectedAddress: mailbox,
			accessToken: "synthetic-access-secret",
			refreshToken: "synthetic-refresh-secret",
		})
		.catch((error: unknown) => error);
	expect(failure).toMatchObject({ data: { code: "server_failure", stage: "watch" } });
	expect(String(failure)).not.toContain("synthetic-");
	expect((await s.t.run((ctx) => ctx.db.get(s.mailboxId)))?.generation).toBe(1);
});
test("business consent missing offline access stops before profile/watch creation", async () => {
	const s = await setup();
	vi.stubEnv("GMAIL_OAUTH_REDIRECT_URI", "https://admin.example.test/api/admin/gmail/callback");
	const fetcher = vi.fn(async () =>
		response({ access_token: "synthetic-access-secret", scope: gmailScopes.join(" ") }),
	);
	vi.stubGlobal("fetch", fetcher);
	const failure = await s.t
		.action(api.gmailNode.connect, {
			secret: settings.GMAIL_CONNECTOR_SECRET,
			siteUrl,
			code: "synthetic-code",
			verifier: "v".repeat(43),
			redirectUri: "https://admin.example.test/api/admin/gmail/callback",
		})
		.catch((error: unknown) => error);
	expect(failure).toMatchObject({ data: { code: "missing_permissions", stage: "exchange" } });
	expect(fetcher).toHaveBeenCalledOnce();
	expect(String(failure)).not.toContain("synthetic-");
});
function full(id: string, sent = false, rfc = `<${id}@example.test>`) {
	return {
		id,
		threadId: "thread1",
		labelIds: [sent ? "SENT" : "INBOX"],
		internalDate: String(Date.now()),
		payload: {
			mimeType: "text/plain",
			headers: [
				{ name: "From", value: sent ? mailbox : recipient },
				{ name: "To", value: sent ? recipient : mailbox },
				{ name: "Subject", value: "Synthetic conversation" },
				{ name: "Message-ID", value: rfc },
			],
			body: {
				data: Buffer.from(sent ? "Native Gmail reply" : "Incoming guest reply").toString(
					"base64url",
				),
			},
		},
	};
}
function mockGmail(route: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
	const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
		if (url.origin === "https://oauth2.googleapis.com" && url.pathname === "/token")
			return response({ access_token: "synthetic-only-access", scope: gmailScopes.join(" ") });
		if (url.pathname.endsWith("/watch")) {
			expect(JSON.parse(String(init?.body))).toEqual({ topicName: settings.GMAIL_PUBSUB_TOPIC });
			return response({ historyId: "99999999", expiration: String(Date.now() + 7 * 86400000) });
		}
		return route(url, init);
	});
	vi.stubGlobal("fetch", fetcher);
	return fetcher;
}
describe("real connector orchestration with isolated provider responses", () => {
	test("push follows every history page, captures native Sent and incoming once, and never fetches unrelated bodies or sends on import", async () => {
		const s = await setup();
		const fetcher = mockGmail((url) => {
			if (url.pathname.endsWith("/history")) {
				expect(url.searchParams.get("startHistoryId")).toBe("100");
				return url.searchParams.has("pageToken")
					? response({
							historyId: "90071992547409931234",
							history: [{ messagesAdded: [{ message: { id: "incoming1", threadId: "thread1" } }] }],
						})
					: response({
							historyId: "90071992547409931234",
							nextPageToken: "page2",
							history: [
								{
									labelsAdded: [{ message: { id: "native1", threadId: "thread1" } }],
									messagesAdded: [{ message: { id: "unrelated1", threadId: "personal-thread" } }],
								},
							],
						});
			}
			if (url.pathname.endsWith("/messages/native1")) return response(full("native1", true));
			if (url.pathname.endsWith("/messages/incoming1")) return response(full("incoming1"));
			throw new Error("Unapproved synthetic provider request");
		});
		const notice = {
			secret: settings.GMAIL_CONNECTOR_SECRET,
			address: mailbox,
			pubsubId: "1234",
			historyId: "90071992547409931234",
		};
		expect(await s.t.action(api.gmailNode.push, notice)).toBe(false);
		expect((await s.t.run((ctx) => ctx.db.get(s.mailboxId)))?.cursor).toBe("100");
		expect(await s.t.action(api.gmailNode.push, notice)).toBe(true);
		const calls = fetcher.mock.calls.length;
		expect(await s.t.action(api.gmailNode.push, notice)).toBe(true);
		expect(fetcher).toHaveBeenCalledTimes(calls);
		const rows = await s.t.run((ctx) => ctx.db.query("gmailMessages").take(10));
		expect(rows).toHaveLength(2);
		expect(rows.some((r) => r.sent)).toBe(true);
		expect(fetcher.mock.calls.some(([u]) => String(u).includes("/messages/unrelated1"))).toBe(
			false,
		);
		expect(fetcher.mock.calls.some(([u]) => String(u).includes("/messages/send"))).toBe(false);
	});
	test("expired mailbox history recovers only registered threads before committing a fresh anchor", async () => {
		const s = await setup();
		const fetcher = mockGmail((url) => {
			if (url.pathname.endsWith("/history")) return response({}, 404);
			if (url.pathname.endsWith("/profile"))
				return response({ emailAddress: mailbox, historyId: "500000" });
			if (url.pathname.endsWith("/threads/thread1")) {
				expect(url.searchParams.get("format")).toBe("minimal");
				return response({ id: "thread1", messages: [{ id: "recovered1" }] });
			}
			if (url.pathname.endsWith("/messages/recovered1")) return response(full("recovered1", true));
			throw new Error("Resync tried to read outside the registered conversation");
		});
		await s.t.action(internal.gmailNode.sync, { mailboxId: s.mailboxId });
		expect((await s.t.run((ctx) => ctx.db.get(s.mailboxId)))?.cursor).toBe("100");
		for (let i = 0; i < 3; i++) {
			const m = await s.t.run((ctx) => ctx.db.get(s.mailboxId));
			if (!m?.resync) break;
			await s.t.action(internal.gmailNode.sync, { mailboxId: s.mailboxId });
		}
		const m = await s.t.run((ctx) => ctx.db.get(s.mailboxId));
		expect(m?.cursor).toBe("500000");
		expect(m?.resync).toBeUndefined();
		expect(await s.t.run((ctx) => ctx.db.query("gmailMessages").take(10))).toHaveLength(1);
		expect(
			fetcher.mock.calls.some(([u]) => new URL(String(u)).pathname.endsWith("/messages")),
		).toBe(false);
	});
	test("a lost outgoing response remains uncertain until an exact Sent match; no second POST is attempted", async () => {
		const s = await setup(),
			requestId = "10000000-0000-4000-8000-000000000001";
		const fetcher = mockGmail((url, init) => {
			if (url.pathname.endsWith("/history")) return response({ historyId: "100", history: [] });
			if (url.pathname.endsWith("/messages/send")) {
				expect(init?.method).toBe("POST");
				throw new Error("Simulated response loss after a provider may accept");
			}
			if (url.pathname.endsWith("/messages")) {
				expect(url.searchParams.get("q")).toContain(requestId);
				return response({ messages: [{ id: "sent1", threadId: "thread1" }] });
			}
			if (url.pathname.endsWith("/messages/sent1"))
				return response(full("sent1", true, `<${requestId}@gmail.angelsrest.invalid>`));
			throw new Error("Unexpected synthetic request");
		});
		await s.admin.mutation(api.gmailConversations.saveDraft, {
			conversationId: s.conversationId,
			text: "A deliberate reply",
			attachmentIds: [],
			expectedRevision: 0,
		});
		const attemptId = await s.admin.mutation(api.gmailConversations.queueSend, {
			conversationId: s.conversationId,
			requestId,
			draftRevision: 1,
			conversationRevision: 0,
		});
		await s.t.action(internal.gmailNode.send, { attemptId });
		expect((await s.t.run((ctx) => ctx.db.get(attemptId)))?.status).toBe("uncertain");
		await s.t.action(internal.gmailNode.send, { attemptId });
		expect(fetcher.mock.calls.filter(([u]) => String(u).includes("/messages/send"))).toHaveLength(
			1,
		);
		await s.t.action(internal.gmailNode.reconcile, { attemptId });
		expect((await s.t.run((ctx) => ctx.db.get(attemptId)))?.status).toBe("accepted");
		expect(await s.t.run((ctx) => ctx.db.query("gmailMessages").take(10))).toHaveLength(1);
	});
	test("revoked refresh access produces reconnect health and preserves the cursor", async () => {
		const s = await setup();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => response({}, 400)),
		);
		await s.t.action(internal.gmailNode.sync, { mailboxId: s.mailboxId });
		const m = await s.t.run((ctx) => ctx.db.get(s.mailboxId));
		expect(m?.status).toBe("reconnect");
		expect(m?.cursor).toBe("100");
		expect(m?.syncError).toContain("Reconnect");
	});
});

test.each([
	"rewritten", "new-thread", "missing", "duplicate", "paginated", "wrong-participant",
	"wrong-subject", "wrong-thread", "changed-marker", "duplicate-header", "not-sent",
])("reconciles a rewritten Gmail Message-ID conservatively: %s", async (scenario) => {
	const s = await setup();
	if (scenario === "new-thread")
		await s.t.run(ctx => ctx.db.patch(s.conversationId, { threadId: undefined, lastRfcId: undefined }));
	await s.admin.mutation(api.gmailConversations.saveDraft, {
		conversationId: s.conversationId, text: "A deliberate reply", attachmentIds: [], expectedRevision: 0,
	});
	const attemptId = await s.admin.mutation(api.gmailConversations.queueSend, {
		conversationId: s.conversationId, requestId: "20000000-0000-4000-8000-000000000001",
		draftRevision: 1, conversationRevision: 0,
	});
	const fetcher = mockGmail((url, init) => {
		if (url.pathname.endsWith("/history")) return response({ historyId: "100", history: [] });
		if (url.pathname.endsWith("/messages/send")) {
			const submitted = JSON.parse(String(init?.body));
			expect(Buffer.from(submitted.raw, "base64url").toString()).toContain(`X-Angels-Rest-Send-ID: ${attemptId}\r\n`);
			throw new Error("Lost response after Gmail accepted and rewrote Message-ID");
		}
		if (url.pathname.endsWith("/messages")) {
			if (url.searchParams.get("q")?.includes("rfc822msgid:")) return response({ messages: [] });
			expect(url.searchParams.get("q")).toMatch(/^in:sent after:\d+ before:\d+$/);
			expect(url.searchParams.get("maxResults")).toBe("100");
			return response({ messages: [
				{ id: "unrelated", threadId: "elsewhere" },
				{ id: "sent1", threadId: scenario === "wrong-thread" ? "wrong" : "thread1" },
				...(scenario === "duplicate" ? [{ id: "sent2", threadId: "thread1" }] : []),
			], ...(scenario === "paginated" ? { nextPageToken: "more" } : {}) });
		}
		const id = url.pathname.split("/").at(-1) ?? "";
		if (["sent1", "sent2", "unrelated"].includes(id)) {
			const marker = { name: "X-Angels-Rest-Send-ID", value: id === "unrelated" || scenario === "missing" ? "different-attempt" : attemptId };
			if (url.searchParams.get("format") === "metadata") {
				expect(url.searchParams.get("metadataHeaders")).toBe("X-Angels-Rest-Send-ID");
				expect(url.searchParams.get("fields")).toBe("id,payload/headers");
				return response({ id, payload: { headers: [marker, ...(scenario === "duplicate-header" ? [marker] : [])] } });
			}
			expect(id).toBe("sent1");
			const m = full(id, true, "<provider-rewritten@mail.gmail.com>");
			m.payload.headers.push(scenario === "changed-marker" ? { ...marker, value: "different-attempt" } : marker);
			if (scenario === "wrong-participant") m.payload.headers[0].value = "stranger@example.test";
			if (scenario === "wrong-subject") m.payload.headers[2].value = "Another conversation";
			if (scenario === "not-sent") m.labelIds = ["INBOX"];
			return response(m);
		}
		throw new Error("Unexpected request");
	});
	await s.t.action(internal.gmailNode.send, { attemptId });
	expect((await s.t.run(ctx => ctx.db.get(attemptId)))?.status).toBe("uncertain");
	await s.t.action(internal.gmailNode.reconcile, { attemptId });
	const recovered = ["rewritten", "new-thread"].includes(scenario);
	expect((await s.t.run(ctx => ctx.db.get(attemptId)))?.status).toBe(recovered ? "accepted" : "uncertain");
	if (recovered) {
		expect((await s.t.run(ctx => ctx.db.get(s.conversationId)))?.lastRfcId).toBe("<provider-rewritten@mail.gmail.com>");
		expect(await s.t.run(ctx => ctx.db.query("gmailMessages").take(10))).toHaveLength(1);
	}
	await s.t.action(internal.gmailNode.send, { attemptId });
	expect(fetcher.mock.calls.filter(([u]) => String(u).includes("/messages/send"))).toHaveLength(1);
	// Unrelated Sent mail never has its body fetched or imported.
	expect(fetcher.mock.calls.filter(([u]) => String(u).includes("/messages/unrelated?format=full"))).toHaveLength(0);
});

test("a separately consented business mailbox never creates a login or site membership", async () => {
	const s = await setup();
	// This tenant has no mailbox yet; ordinary admin identity remains the existing owner.
	await s.t.run((ctx) => ctx.db.delete(s.mailboxId));
	vi.stubEnv("GMAIL_OAUTH_REDIRECT_URI", "https://admin.example.test/api/admin/gmail/callback");
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request) => {
			const url = new URL(String(input));
			if (url.origin === "https://oauth2.googleapis.com")
				return response({
					access_token: "synthetic-business-access",
					refresh_token: "synthetic-business-refresh",
					scope: gmailScopes.join(" "),
				});
			if (url.pathname.endsWith("/profile"))
				return response({
					emailAddress: "business@example.test",
					historyId: "90071992547409931234",
				});
			if (url.pathname.endsWith("/watch"))
				return response({
					historyId: "90071992547409931234",
					expiration: String(Date.now() + 86400000),
				});
			throw new Error("Unapproved request");
		}),
	);
	const before = await s.t.run((ctx) => ctx.db.query("platformClients").collect());
	await s.t.action(api.gmailNode.connect, {
		secret: settings.GMAIL_CONNECTOR_SECRET,
		siteUrl,
		code: "synthetic-code",
		verifier: "v".repeat(43),
		redirectUri: "https://admin.example.test/api/admin/gmail/callback",
	});
	expect(
		(await s.admin.query(api.gmailConversations.connection, { siteUrl })).mailbox?.address,
	).toBe("business@example.test");
	expect(await s.t.run((ctx) => ctx.db.query("platformClients").collect())).toEqual(before);
	await expect(
		s.t
			.withIdentity({
				subject: "business-mailbox",
				email: "business@example.test",
				emailVerified: true,
			})
			.query(api.gmailConversations.connection, { siteUrl }),
	).rejects.toThrow();
});

test("stopping sync erases local refresh access without revoking Google or changing membership", async () => {
	const s = await setup();
	const before = await s.t.run((ctx) => ctx.db.query("platformClients").collect());
	const fetcher = mockGmail((url) => {
		if (url.pathname.endsWith("/stop")) return new Response(null, { status: 204 });
		throw new Error("Unapproved request");
	});
	expect(
		await s.t.action(api.gmailNode.stopSynchronization, {
			secret: settings.GMAIL_CONNECTOR_SECRET,
			siteUrl,
		}),
	).toEqual({ disconnected: true, watchStopped: true, providerGrantRevoked: false });
	const m = await s.t.run((ctx) => ctx.db.get(s.mailboxId));
	expect(m?.status).toBe("disconnected");
	expect(m?.encryptedRefreshToken).toBeUndefined();
	expect(m?.generation).toBe(2);
	expect(m?.cursor).toBe("100");
	expect(await s.t.run((ctx) => ctx.db.query("platformClients").collect())).toEqual(before);
	expect(fetcher.mock.calls.some(([url]) => String(url).includes("revoke"))).toBe(false);
});

test("native Gmail drafts are not imported or mistaken for unexpected incoming participants", async () => {
	const s = await setup();
	let sent = false;
	mockGmail((url) => {
		if (url.pathname.endsWith("/history"))
			return response({
				historyId: sent ? "300" : "200",
				history: [{ messagesAdded: [{ message: { id: "native-draft", threadId: "thread1" } }] }],
			});
		if (url.pathname.endsWith("/messages/native-draft"))
			return response({ ...full("native-draft", true), labelIds: [sent ? "SENT" : "DRAFT"] });
		throw new Error("Unapproved request");
	});
	await s.t.action(api.gmailNode.push, {
		secret: settings.GMAIL_CONNECTOR_SECRET,
		address: mailbox,
		pubsubId: "draft-notice",
		historyId: "200",
	});
	expect(await s.t.run((ctx) => ctx.db.query("gmailMessages").collect())).toHaveLength(0);
	expect((await s.t.run((ctx) => ctx.db.get(s.conversationId)))?.problem).toBeUndefined();
	sent = true;
	await s.t.action(api.gmailNode.push, {
		secret: settings.GMAIL_CONNECTOR_SECRET,
		address: mailbox,
		pubsubId: "sent-notice",
		historyId: "300",
	});
	const rows = await s.t.run((ctx) => ctx.db.query("gmailMessages").collect());
	expect(rows).toHaveLength(1);
	expect(rows[0].sent).toBe(true);
});

describe("reviewed existing-thread selection", () => {
	test("search is bounded and explicit; preview excludes drafts and confirmation reuses registered-thread recovery", async () => {
		const s = await setup();
		const committed = { ...full("existing1"), threadId: "existing-thread" };
		const draft = { ...full("native-draft"), threadId: "existing-thread", labelIds: ["DRAFT"] };
		const fetcher = mockGmail(url => {
			if (url.pathname.endsWith("/threads")) {
				expect(url.searchParams.get("maxResults")).toBe("10");
				expect(url.searchParams.get("q")).toBe("(Synthetic) -in:drafts");
				return response({ threads: [{ id: "existing-thread", snippet: "Synthetic conversation" }], nextPageToken: "more" });
			}
			if (url.pathname.endsWith("/threads/existing-thread")) {
				expect(url.searchParams.get("format")).toBe("metadata");
				return response({ id: "existing-thread", messages: [committed, draft] });
			}
			throw new Error("Unexpected provider call");
		});
		await expect(s.t.action(api.gmailNode.searchThreads, { inquiryId: s.inquiryId, search: "Synthetic" })).rejects.toThrow();
		expect(fetcher).not.toHaveBeenCalled();
		await expect(s.admin.action(api.gmailNode.searchThreads, { inquiryId: s.inquiryId, search: " " })).rejects.toThrow();
		const search = await s.admin.action(api.gmailNode.searchThreads, { inquiryId: s.inquiryId, search: "Synthetic" });
		expect(search).toMatchObject({ more: true, threads: [{ id: "existing-thread" }] });
		const preview = await s.admin.action(api.gmailNode.previewThread, { inquiryId: s.inquiryId, threadId: "existing-thread" });
		expect(preview.messageCount).toBe(1);
		expect(preview.participants).toEqual([recipient, mailbox].sort());
		expect(preview.destination).toContain("Inquiry:");
		expect(preview.token).toBeTruthy();
		expect(await s.t.run(ctx => ctx.db.query("gmailMessages").take(10))).toHaveLength(0);
		const id = await s.admin.action(api.gmailNode.confirmThread, { inquiryId: s.inquiryId, token: preview.token! });
		expect(await s.admin.action(api.gmailNode.confirmThread, { inquiryId: s.inquiryId, token: preview.token! })).toBe(id);
		expect(await s.t.run(ctx => ctx.db.get(id))).toMatchObject({ importPending: true, threadId: "existing-thread" });
		expect(fetcher.mock.calls.some(([url]) => String(url).includes("/messages/"))).toBe(false);
	});
	test("unexpected participants, stale previews, tampering, and changed mailbox generations cannot import", async () => {
		const s = await setup();
		let extraParticipant = false;
		mockGmail(() => {
			const m = { ...full("existing1"), threadId: "existing-thread" };
			if (extraParticipant) m.payload.headers.push({ name: "Cc", value: "unexpected@example.test" });
			return response({ id: "existing-thread", messages: [m] });
		});
		const preview = await s.admin.action(api.gmailNode.previewThread, { inquiryId: s.inquiryId, threadId: "existing-thread" });
		extraParticipant = true;
		const blocked = await s.admin.action(api.gmailNode.previewThread, { inquiryId: s.inquiryId, threadId: "existing-thread" });
		expect(blocked).toMatchObject({ blocked: true, token: null });
		expect(blocked.participants).toContain("unexpected@example.test");
		await expect(s.admin.action(api.gmailNode.confirmThread, { inquiryId: s.inquiryId, token: preview.token! })).rejects.toThrow("changed");
		extraParticipant = false;
		await expect(s.admin.action(api.gmailNode.confirmThread, { inquiryId: s.inquiryId, token: `${preview.token}tampered` })).rejects.toThrow();
		await s.t.run(ctx => ctx.db.patch(s.mailboxId, { generation: 2 }));
		await expect(s.admin.action(api.gmailNode.confirmThread, { inquiryId: s.inquiryId, token: preview.token! })).rejects.toThrow("Preview expired");
		expect(await s.t.run(ctx => ctx.db.query("gmailConversations").take(10))).toHaveLength(1);
	});
	test("partial import resumes at its checkpoint without duplicates and native Sent updates workflow", async () => {
		const s = await setup();
		await s.t.run(async ctx => {
			await ctx.db.patch(s.conversationId, { importPending: true });
			await ctx.db.patch(s.mailboxId, { resync: { anchor: "100" } });
		});
		let interrupted = true;
		mockGmail(url => {
			if (url.pathname.endsWith("/threads/thread1")) return response({ id: "thread1", messages: Array.from({ length: 22 }, (_, n) => ({ id: `import${n}` })) });
			const match = url.pathname.match(/\/messages\/import(\d+)$/);
			if (match) {
				if (interrupted && match[1] === "21") return response({}, 503);
				return response(full(`import${match[1]}`, match[1] === "21"));
			}
			if (url.pathname.endsWith("/history")) return response({ historyId: "200" });
			throw new Error("Unexpected request");
		});
		expect(await s.t.action(internal.gmailNode.sync, { mailboxId: s.mailboxId })).toBe(false);
		expect((await s.t.run(ctx => ctx.db.get(s.mailboxId)))?.pending?.offset).toBe(20);
		expect(await s.t.action(internal.gmailNode.sync, { mailboxId: s.mailboxId })).toBe(false);
		expect(await s.t.run(ctx => ctx.db.query("gmailMessages").take(30))).toHaveLength(20);
		interrupted = false;
		await s.t.action(internal.gmailNode.sync, { mailboxId: s.mailboxId });
		await s.t.action(internal.gmailNode.sync, { mailboxId: s.mailboxId });
		expect(await s.t.run(ctx => ctx.db.query("gmailMessages").take(30))).toHaveLength(22);
		const c = await s.t.run(ctx => ctx.db.get(s.conversationId));
		expect(c?.importPending).toBeUndefined();
		expect(c?.workflowState).toBe("waiting");
	});
	test("manual recovery takes a fresh provider anchor and retains the existing cursor until registered history completes", async () => {
		const s = await setup();
		mockGmail(url => {
			if (url.pathname.endsWith("/profile")) return response({ emailAddress: mailbox, historyId: "700" });
			throw new Error("Unexpected request");
		});
		await s.admin.mutation(api.gmailConversations.restartRecovery, { siteUrl });
		await s.t.action(internal.gmailNode.sync, { mailboxId: s.mailboxId });
		const m = await s.t.run(ctx => ctx.db.get(s.mailboxId));
		expect(m).toMatchObject({ cursor: "100", resync: { anchor: "700" } });
		expect(m?.forceRecovery).toBeUndefined();
	});
});

test("missing pilot mailbox approval never crosses the provider boundary", async () => {
	const s = await setup();
	vi.stubEnv("GMAIL_PILOT_ALLOWED_MAILBOXES", "[]");
	const fetcher = mockGmail(() => { throw new Error("Provider must not be contacted"); });
	expect(await s.t.action(internal.gmailNode.sync, { mailboxId: s.mailboxId })).toBe(false);
	expect(fetcher).not.toHaveBeenCalled();
});
test("a partially revoked refresh grant requires reconnect before any Gmail API operation", async () => {
	const s = await setup();
	const fetcher = vi.fn(async () => response({ access_token: "synthetic-read-only", scope: gmailScopes[0] }));
	vi.stubGlobal("fetch", fetcher);
	expect(await s.t.action(internal.gmailNode.sync, { mailboxId: s.mailboxId })).toBe(false);
	expect(fetcher).toHaveBeenCalledTimes(1);
	expect(await s.t.run(ctx => ctx.db.get(s.mailboxId))).toMatchObject({ status: "reconnect" });
});
