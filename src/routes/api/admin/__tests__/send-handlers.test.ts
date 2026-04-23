import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * These routes are thin wrappers around handler factories from
 * @jessepomeroy/admin. The angelsrest-side responsibility is:
 *   1. Call requireAuth() before delegating.
 *   2. Delegate to the package handler and return its response.
 *
 * Deeper logic (template fallback, Resend, activity logging) is tested
 * inside the admin-dashboard package — see audit item #5.
 */

// ─── Module Mocks ─────────────────────────────────────────────────────────────

const mockInvoiceHandler = vi.fn();
const mockQuoteHandler = vi.fn();
const mockContractHandler = vi.fn();
const mockSetServerConfig = vi.fn();

vi.mock("@jessepomeroy/admin", () => ({
	setServerConfig: mockSetServerConfig,
	createInvoiceSendHandler: () => mockInvoiceHandler,
	createQuoteSendHandler: () => mockQuoteHandler,
	createContractSendHandler: () => mockContractHandler,
}));

vi.mock("$lib/config/admin.server", () => ({
	adminServerConfig: { stub: true },
}));

const mockGetToken = vi.fn();
vi.mock("@mmailaender/convex-better-auth-svelte/sveltekit", () => ({
	getToken: mockGetToken,
}));

const mockConvexQuery = vi.fn();
const mockConvexSetAuth = vi.fn();
vi.mock("convex/browser", () => ({
	ConvexHttpClient: class MockConvexHttpClient {
		setAuth = mockConvexSetAuth;
		query = mockConvexQuery;
	},
}));
vi.mock("$convex/api", () => ({
	api: { adminAuth: { whoami: "adminAuth.whoami" } },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent() {
	return {
		cookies: {
			get: vi.fn(),
			getAll: vi.fn(),
			set: vi.fn(),
		} as unknown as import("@sveltejs/kit").Cookies,
		params: { id: "doc-1" },
		request: new Request("http://localhost/api/admin/x/doc-1/send", {
			method: "POST",
			body: JSON.stringify({ subject: "hi", body: "<p>hi</p>" }),
		}),
	};
}

async function loadHandler(path: string) {
	vi.resetModules();
	const mod = await import(path);
	return mod.POST as (event: any) => Promise<Response>;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe.each([
	{
		name: "invoice",
		path: "../invoicing/[id]/send/+server",
		mockHandler: mockInvoiceHandler,
	},
	{
		name: "quote",
		path: "../quotes/[id]/send/+server",
		mockHandler: mockQuoteHandler,
	},
	{
		name: "contract",
		path: "../contracts/[id]/send/+server",
		mockHandler: mockContractHandler,
	},
])("POST /api/admin/$name send handler", ({ path, mockHandler }) => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockConvexQuery.mockReset();
	});

	it("returns 401 when no session token is present", async () => {
		mockGetToken.mockReturnValue(null);
		const POST = await loadHandler(path);

		try {
			await POST(makeEvent());
			expect.fail("should have thrown");
		} catch (err: any) {
			expect(err.status).toBe(401);
		}
		expect(mockHandler).not.toHaveBeenCalled();
	});

	it("returns 401 when Convex rejects the session", async () => {
		mockGetToken.mockReturnValue("stale-token");
		mockConvexQuery.mockResolvedValue(null);
		const POST = await loadHandler(path);

		try {
			await POST(makeEvent());
			expect.fail("should have thrown");
		} catch (err: any) {
			expect(err.status).toBe(401);
		}
		expect(mockHandler).not.toHaveBeenCalled();
	});

	it("delegates to the package handler when auth passes", async () => {
		mockGetToken.mockReturnValue("valid-session-token");
		mockConvexQuery.mockResolvedValue({
			email: "admin@example.com",
			name: "Admin",
			subject: "user-1",
		});
		mockHandler.mockResolvedValue(new Response(JSON.stringify({ sent: true }), { status: 200 }));

		const POST = await loadHandler(path);
		const event = makeEvent();
		const response = await POST(event);

		expect(mockHandler).toHaveBeenCalledTimes(1);
		expect(mockHandler).toHaveBeenCalledWith(event);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.sent).toBe(true);
	});

	it("propagates errors thrown by the package handler", async () => {
		mockGetToken.mockReturnValue("valid-session-token");
		mockConvexQuery.mockResolvedValue({
			email: "admin@example.com",
			name: "Admin",
			subject: "user-1",
		});
		mockHandler.mockRejectedValue(new Error("resend exploded"));

		const POST = await loadHandler(path);

		await expect(POST(makeEvent())).rejects.toThrow("resend exploded");
	});
});
