import type { RequestEvent } from "@sveltejs/kit";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, test, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
	action: vi.fn(),
	query: vi.fn(),
	mutation: vi.fn(),
	authorize: vi.fn(),
	verifyPush: vi.fn(),
	configured: true,
}));
vi.mock("$lib/server/convexClient", () => ({
	getConvex: () => fixtures,
	createAuthenticatedConvexClient: () => fixtures,
}));
vi.mock("$lib/server/siteAdminAuthorization", () => ({
	authorizeSiteAdminRequest: (...a: unknown[]) => fixtures.authorize(...a),
}));
vi.mock("$lib/server/gmail/config", () => ({
	gmailConfigured: () => fixtures.configured,
	gmailConfiguration: () => ({
		secret: "synthetic-server-only-capability-1234",
		cookieKey: Buffer.alloc(32, 7).toString("base64url"),
		clientId: "synthetic-client",
		callback: "https://admin.example.test/api/admin/gmail/callback",
		audience: "https://admin.example.test/api/webhooks/gmail",
		serviceAccount: "push@synthetic-project.iam.gserviceaccount.com",
		subscription: "projects/synthetic-project/subscriptions/updates",
		origin: "https://admin.example.test",
	}),
}));
vi.mock("$lib/server/gmail/security", async (load) => ({
	...(await load<typeof import("../security")>()),
	verifyPush: (...a: unknown[]) => fixtures.verifyPush(...a),
}));

import { sealToken } from "../../../../../packages/crm-api/convex/helpers/gmail/protocol";
import {
	callback,
	completeLinked,
	connect,
	disconnect,
	exportConversation,
	push,
	status,
	threads,
} from "../handlers";

function event(request: Request, value?: string) {
	// Only the SvelteKit surface used by these adapters is supplied.
	return {
		request,
		url: new URL(request.url),
		params: {},
		cookies: { get: () => value, set: vi.fn(), delete: vi.fn() },
		setHeaders: vi.fn(),
	} as unknown as RequestEvent;
}
function consentEvent(linked = true, search = "") {
	const saved = sealToken(
		JSON.stringify({
			stateId: "syntheticstate123456",
			nonce: "n".repeat(43),
			verifier: "v".repeat(43),
			destination: "/admin/crm",
			expiresAt: Date.now() + 60_000,
		}),
		`${linked ? "linked-oauth" : "oauth"}:https://admin.example.test`,
		Buffer.alloc(32, 7).toString("base64url"),
	);
	return event(
		new Request(
			`https://admin.example.test/api/admin/gmail/${linked ? "complete-linked" : "callback"}${search}`,
			linked ? { method: "POST", headers: { origin: "https://admin.example.test" } } : {},
		),
		saved,
	);
}
beforeEach(() => {
	vi.clearAllMocks();
	fixtures.authorize.mockResolvedValue({ convexToken: "synthetic-session" });
	fixtures.verifyPush.mockResolvedValue(undefined);
	fixtures.configured = true;
});
function notice() {
	return event(
		new Request("https://admin.example.test/api/webhooks/gmail", {
			method: "POST",
			headers: { authorization: "Bearer synthetic-verified-only-in-this-unit-test" },
			body: JSON.stringify({
				subscription: "projects/synthetic-project/subscriptions/updates",
				message: {
					messageId: "12345",
					data: Buffer.from(
						'{"emailAddress":"owner@example.test","historyId":90071992547409931234}',
					).toString("base64"),
				},
			}),
		}),
	);
}
describe("Gmail push acknowledgment", () => {
	test("sends no acknowledgment until the backend confirms durable imports and cursor progress", async () => {
		fixtures.action.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
		expect((await push(notice())).status).toBe(503);
		expect((await push(notice())).status).toBe(204);
		expect(fixtures.action.mock.calls[0][1]).toMatchObject({
			address: "owner@example.test",
			historyId: "90071992547409931234",
			pubsubId: "12345",
		});
	});
	test("invalid JWT, wrong subscription and storage failure never return success or fetch an arbitrary mailbox", async () => {
		fixtures.verifyPush.mockRejectedValueOnce(new Error("Untrusted identity"));
		expect((await push(notice())).status).toBe(503);
		expect(fixtures.action).not.toHaveBeenCalled();
		fixtures.action.mockRejectedValueOnce(new Error("Synthetic database unavailable"));
		expect((await push(notice())).status).toBe(503);
	});
});
describe("Google connection UX authority", () => {
	test("server failure gives an operator reference without suggesting declined consent or logging credentials", async () => {
		fixtures.mutation.mockResolvedValueOnce("angelsrest.online");
		fixtures.action.mockRejectedValueOnce(
			new Error("synthetic-access-secret synthetic-refresh-secret"),
		);
		const log = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const response = await completeLinked(consentEvent());
			const body = await response.json();
			expect(response.status).toBe(503);
			expect(body).toMatchObject({
				connected: false,
				code: "server_failure",
				returnTo: "/admin/crm",
			});
			expect(body.reference).toMatch(/^[a-f0-9-]{36}$/);
			expect(log).toHaveBeenCalledWith("Gmail connection failed", {
				reference: body.reference,
				code: "server_failure",
				stage: "refresh",
			});
			expect(JSON.stringify([body, log.mock.calls])).not.toMatch(
				/synthetic-(access|refresh)-secret/,
			);
		} finally {
			log.mockRestore();
		}
	});
	test("known backend account mismatch survives transport without exposing arbitrary error data", async () => {
		fixtures.mutation.mockResolvedValueOnce("angelsrest.online");
		fixtures.action.mockRejectedValueOnce(
			new ConvexError({
				code: "account_mismatch",
				stage: "profile",
				refreshToken: "synthetic-refresh-secret",
			}),
		);
		const log = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const response = await completeLinked(consentEvent());
			const body = await response.json();
			expect(response.status).toBe(400);
			expect(body.code).toBe("account_mismatch");
			expect(JSON.stringify([body, log.mock.calls])).not.toContain("synthetic-refresh-secret");
		} finally {
			log.mockRestore();
		}
	});
	test("business consent cancellation uses the result page and never exchanges a code", async () => {
		fixtures.mutation.mockResolvedValueOnce("angelsrest.online");
		const log = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			await expect(
				callback(
					consentEvent(
						false,
						`?state=${"n".repeat(43)}&error=access_denied&error_description=synthetic-private-detail`,
					),
				),
			).rejects.toMatchObject({
				status: 303,
				location: expect.stringContaining("/admin/google-connection?gmail_error=consent_declined"),
			});
			expect(fixtures.action).not.toHaveBeenCalled();
			expect(JSON.stringify(log.mock.calls)).not.toContain("synthetic-private-detail");
		} finally {
			log.mockRestore();
		}
	});
	test("Gmail unavailable is a separate status and does not call or alter login", async () => {
		fixtures.configured = false;
		const response = await status(
			event(new Request("https://admin.example.test/api/admin/gmail/status")),
		);
		expect(await response.json()).toEqual({ configured: false, mailbox: null });
		expect(fixtures.action).not.toHaveBeenCalled();
	});
	test("the business-mailbox path creates PKCE consent without linking a sign-in account", async () => {
		fixtures.mutation.mockResolvedValue("syntheticstate123456");
		const e = event(
			new Request("https://admin.example.test/api/admin/gmail/connect", {
				method: "POST",
				headers: { origin: "https://admin.example.test" },
				body: new URLSearchParams({ returnTo: "/admin/inquiries" }),
			}),
		);
		try {
			await connect(e);
			throw new Error("Missing redirect");
		} catch (redirect) {
			expect(redirect).toMatchObject({ status: 303 });
			if (!redirect || typeof redirect !== "object" || !("location" in redirect)) throw redirect;
			const target = new URL(String(redirect.location));
			expect(target.hostname).toBe("accounts.google.com");
			expect(target.searchParams.get("scope")).toContain("gmail.readonly");
			expect(target.searchParams.get("code_challenge_method")).toBe("S256");
		}
		expect(fixtures.action).not.toHaveBeenCalled();
		expect(e.cookies.set).toHaveBeenCalled();
	});
	test("partial Gmail consent leaves sign-in intact and never claims a connected mailbox", async () => {
		fixtures.mutation.mockResolvedValue("angelsrest.online");
		fixtures.action.mockResolvedValue({ connected: false });
		const saved = sealToken(
			JSON.stringify({
				stateId: "syntheticstate123456",
				nonce: "n".repeat(43),
				destination: "/admin/inquiries",
				expiresAt: Date.now() + 10000,
			}),
			"linked-oauth:https://admin.example.test",
			Buffer.alloc(32, 7).toString("base64url"),
		);
		const result = await completeLinked(
			event(
				new Request("https://admin.example.test/api/admin/gmail/complete-linked", {
					method: "POST",
					headers: { origin: "https://admin.example.test" },
				}),
				saved,
			),
		);
		expect(await result.json()).toMatchObject({
			connected: false,
			code: "missing_permissions",
			returnTo: "/admin/inquiries",
		});
	});
	test("expired or missing consent intent cannot install a Gmail connection", async () => {
		const result = await completeLinked(
			event(
				new Request("https://admin.example.test/api/admin/gmail/complete-linked", {
					method: "POST",
					headers: { origin: "https://admin.example.test" },
				}),
			),
		);
		expect(result.status).toBe(400);
		expect(await result.json()).toMatchObject({ code: "intent_expired" });
		expect(fixtures.action).not.toHaveBeenCalled();
	});
});

test("stopping synchronization does not unlink login or revoke a combined provider grant", async () => {
	fixtures.query.mockResolvedValue({ mailbox: { address: "owner@example.test" } });
	fixtures.action.mockResolvedValue({
		disconnected: true,
		watchStopped: true,
		providerGrantRevoked: false,
	});
	const response = await disconnect(
		event(
			new Request("https://admin.example.test/api/admin/gmail/disconnect", {
				method: "POST",
				headers: { origin: "https://admin.example.test" },
			}),
		),
	);
	expect(await response.json()).toMatchObject({ disconnected: true, providerGrantRevoked: false });
	expect(fixtures.action).toHaveBeenCalledOnce();
});

describe("reviewed Gmail selection transport", () => {
	function selection(body: Record<string, unknown>, origin = "https://admin.example.test") {
		return event(
			new Request("https://admin.example.test/api/admin/gmail/threads", {
				method: "POST",
				headers: { origin, "content-type": "application/json" },
				body: JSON.stringify(body),
			}),
		);
	}
	test("denies unauthenticated and cross-origin selection before any provider action", async () => {
		fixtures.authorize.mockResolvedValueOnce(null);
		await expect(
			threads(
				selection({ operation: "search", inquiryId: "inquiry1234567890", search: "portrait" }),
			),
		).rejects.toMatchObject({ status: 403 });
		await expect(
			threads(
				selection(
					{ operation: "search", inquiryId: "inquiry1234567890", search: "portrait" },
					"https://foreign.example.test",
				),
			),
		).rejects.toMatchObject({ status: 403 });
		expect(fixtures.action).not.toHaveBeenCalled();
	});
	test("passes only the selected stored record and search, never browser tenant or mailbox authority", async () => {
		fixtures.action.mockResolvedValueOnce({
			threads: [],
			more: false,
			mailbox: "synthetic@example.test",
		});
		const result = await threads(
			selection({
				operation: "search",
				inquiryId: "inquiry1234567890",
				search: "portrait",
				siteUrl: "foreign.example.test",
				mailbox: "private@example.test",
				secret: "attacker-controlled",
			}),
		);
		expect(result.status).toBe(200);
		expect(result.headers.get("cache-control")).toBe("private, no-store");
		expect(fixtures.action.mock.calls[0][1]).toEqual({
			inquiryId: "inquiry1234567890",
			search: "portrait",
		});
	});
	test("requires one destination and reports association conflicts without leaking provider exceptions", async () => {
		expect(
			(
				await threads(
					selection({
						operation: "preview",
						inquiryId: "inquiry1234567890",
						clientId: "client12345678900",
						threadId: "selected",
					}),
				)
			).status,
		).toBe(400);
		expect(fixtures.action).not.toHaveBeenCalled();
		fixtures.action.mockRejectedValueOnce(
			new Error(
				"This Gmail thread is already linked to a different record: private internal detail",
			),
		);
		const result = await threads(
			selection({
				operation: "confirm",
				inquiryId: "inquiry1234567890",
				token: "synthetic-bound-token",
			}),
		);
		expect(await result.json()).toEqual({
			error: "This thread is already linked to another record. Its association was not changed.",
		});
	});
});
describe("bounded private Gmail export", () => {
	const context = {
		conversation: { _id: "conversation12345678", revision: 4, subject: "Synthetic" },
		draft: { text: "Saved draft", revision: 2, attachmentIds: [] },
		expiresAt: 2000000000000,
	};
	function requestExport() {
		const e = event(
			new Request("https://admin.example.test/api/admin/gmail/export/conversation12345678"),
		);
		e.params.conversationId = "conversation12345678";
		return e;
	}
	test("reads all pages, checks the final revision, and explicitly describes excluded bytes and credentials", async () => {
		fixtures.query
			.mockResolvedValueOnce(context)
			.mockResolvedValueOnce({ page: [{ text: "first" }], isDone: false, continueCursor: "next" })
			.mockResolvedValueOnce({ page: [{ text: "second" }], isDone: true, continueCursor: "" })
			.mockResolvedValueOnce({ page: [{ name: "photo.jpg" }], isDone: true, continueCursor: "" })
			.mockResolvedValueOnce({ page: [{ status: "accepted" }], isDone: true, continueCursor: "" })
			.mockResolvedValueOnce(context);
		const response = await exportConversation(requestExport());
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("private, no-store");
		expect(response.headers.get("content-disposition")).toContain("attachment;");
		const data = await response.json();
		expect(data.messages).toHaveLength(2);
		expect(data.scope).toContain("bytes and credentials are not included");
		expect(fixtures.query.mock.calls[2][1]).toMatchObject({
			conversationId: context.conversation._id,
			paginationOpts: { cursor: "next" },
		});
	});
	test("denies export without current membership and produces no partial export after a revision change", async () => {
		fixtures.authorize.mockResolvedValueOnce(null);
		await expect(exportConversation(requestExport())).rejects.toMatchObject({ status: 403 });
		fixtures.query.mockResolvedValueOnce(context);
		for (let i = 0; i < 3; i++)
			fixtures.query.mockResolvedValueOnce({ page: [], isDone: true, continueCursor: "" });
		fixtures.query.mockResolvedValueOnce({
			...context,
			conversation: { ...context.conversation, revision: 5 },
		});
		const response = await exportConversation(requestExport());
		expect(response.status).toBe(409);
		expect(await response.text()).not.toContain("Saved draft");
	});
	test("fails visibly before exceeding the host response budget", async () => {
		fixtures.query.mockResolvedValueOnce(context).mockResolvedValueOnce({
			page: [{ text: "a".repeat(4 * 1024 * 1024) }],
			isDone: true,
			continueCursor: "",
		});
		const response = await exportConversation(requestExport());
		expect(response.status).toBe(409);
		expect((await response.text()).length).toBeLessThan(500);
	});
});
