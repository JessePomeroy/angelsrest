import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Module Mocks ─────────────────────────────────────────────────────────────

const mockConvexMutation = vi.fn();
const mockConvexQuery = vi.fn();

vi.mock("$lib/server/convexClient", () => ({
	getConvex: () => ({
		mutation: mockConvexMutation,
		query: mockConvexQuery,
	}),
}));

vi.mock("$convex/api", () => ({
	api: {
		portal: {
			acceptQuote: "portal.acceptQuote",
			declineQuote: "portal.declineQuote",
			signContract: "portal.signContract",
		},
	},
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(token: string, body?: unknown) {
	return {
		params: { token },
		request: {
			json: async () => body ?? {},
		},
	} as unknown;
}

// ─── Tests ────────────────────────────────────────────────────────────────────
//
// The portal endpoints now delegate all validation + patching to a single
// atomic Convex mutation (acceptQuote / declineQuote / signContract). SvelteKit
// only maps Convex error strings to HTTP statuses.

describe("POST /api/portal/[token]/accept", () => {
	let POST: (event: any) => Promise<Response>;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.resetModules();
		const mod = await import("../accept/+server");
		POST = mod.POST as unknown as typeof POST;
	});

	it("returns 404 when token is invalid", async () => {
		mockConvexMutation.mockRejectedValue(new Error("Invalid token"));
		try {
			await POST(makeReq("bad-token"));
			expect.fail("should have thrown");
		} catch (err: any) {
			expect(err.status).toBe(404);
		}
	});

	it("returns 404 when token is expired", async () => {
		mockConvexMutation.mockRejectedValue(new Error("Token expired"));
		try {
			await POST(makeReq("expired"));
			expect.fail("should have thrown");
		} catch (err: any) {
			expect(err.status).toBe(404);
		}
	});

	it("returns 404 when token has already been used", async () => {
		mockConvexMutation.mockRejectedValue(new Error("Token already used"));
		try {
			await POST(makeReq("used-token"));
			expect.fail("should have thrown");
		} catch (err: any) {
			expect(err.status).toBe(404);
		}
	});

	it("returns 400 when token type is not quote", async () => {
		mockConvexMutation.mockRejectedValue(new Error("Token is not for a quote"));
		try {
			await POST(makeReq("wrong-type"));
			expect.fail("should have thrown");
		} catch (err: any) {
			expect(err.status).toBe(400);
		}
	});

	it("calls acceptQuote mutation on success", async () => {
		mockConvexMutation.mockResolvedValue(null);
		const response = await POST(makeReq("good-token"));
		expect(response.status).toBe(200);
		expect(mockConvexMutation).toHaveBeenCalledWith("portal.acceptQuote", {
			token: "good-token",
		});
	});

	it("returns 500 on unexpected mutation failure", async () => {
		mockConvexMutation.mockRejectedValue(new Error("convex down"));
		try {
			await POST(makeReq("good"));
			expect.fail("should have thrown");
		} catch (err: any) {
			expect(err.status).toBe(500);
		}
	});
});

describe("POST /api/portal/[token]/decline", () => {
	let POST: (event: any) => Promise<Response>;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.resetModules();
		const mod = await import("../decline/+server");
		POST = mod.POST as unknown as typeof POST;
	});

	it("returns 404 when token is invalid", async () => {
		mockConvexMutation.mockRejectedValue(new Error("Invalid token"));
		try {
			await POST(makeReq("bad"));
			expect.fail("should have thrown");
		} catch (err: any) {
			expect(err.status).toBe(404);
		}
	});

	it("returns 400 when token is not a quote token", async () => {
		mockConvexMutation.mockRejectedValue(new Error("Token is not for a quote"));
		try {
			await POST(makeReq("wrong"));
			expect.fail("should have thrown");
		} catch (err: any) {
			expect(err.status).toBe(400);
		}
	});

	it("calls declineQuote on success", async () => {
		mockConvexMutation.mockResolvedValue(null);
		const response = await POST(makeReq("good-token"));
		expect(response.status).toBe(200);
		expect(mockConvexMutation).toHaveBeenCalledWith("portal.declineQuote", {
			token: "good-token",
		});
	});
});

describe("POST /api/portal/[token]/sign", () => {
	let POST: (event: any) => Promise<Response>;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.resetModules();
		const mod = await import("../sign/+server");
		POST = mod.POST as unknown as typeof POST;
	});

	it("returns 400 when signerName is missing or blank", async () => {
		try {
			await POST(makeReq("good", { signerName: "   " }));
			expect.fail("should have thrown");
		} catch (err: any) {
			expect(err.status).toBe(400);
		}
		try {
			await POST(makeReq("good", {}));
			expect.fail("should have thrown");
		} catch (err: any) {
			expect(err.status).toBe(400);
		}
		// Body not a valid JSON object — still 400
		expect(mockConvexMutation).not.toHaveBeenCalled();
	});

	it("returns 404 when token is invalid/expired/used", async () => {
		mockConvexMutation.mockRejectedValue(new Error("Token already used"));
		try {
			await POST(makeReq("bad", { signerName: "Jane" }));
			expect.fail("should have thrown");
		} catch (err: any) {
			expect(err.status).toBe(404);
		}
	});

	it("returns 400 when token is not a contract token", async () => {
		mockConvexMutation.mockRejectedValue(new Error("Token is not for a contract"));
		try {
			await POST(makeReq("wrong", { signerName: "Jane" }));
			expect.fail("should have thrown");
		} catch (err: any) {
			expect(err.status).toBe(400);
		}
	});

	it("calls signContract with signerName/email/signatureData on success", async () => {
		mockConvexMutation.mockResolvedValue(null);
		const response = await POST(
			makeReq("good-token", {
				signerName: "  Jane Doe  ",
				signerEmail: "jane@example.com",
				signatureData: "data:image/png;base64,xyz",
			}),
		);
		expect(response.status).toBe(200);
		expect(mockConvexMutation).toHaveBeenCalledWith("portal.signContract", {
			token: "good-token",
			signerName: "Jane Doe",
			signerEmail: "jane@example.com",
			signatureData: "data:image/png;base64,xyz",
		});
	});

	it("returns 500 on unexpected mutation failure", async () => {
		mockConvexMutation.mockRejectedValue(new Error("convex down"));
		try {
			await POST(makeReq("good", { signerName: "Jane" }));
			expect.fail("should have thrown");
		} catch (err: any) {
			expect(err.status).toBe(500);
		}
	});
});
