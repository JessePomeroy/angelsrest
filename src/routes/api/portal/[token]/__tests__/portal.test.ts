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
			getByToken: "portal.getByToken",
			markUsed: "portal.markUsed",
		},
		quotes: {
			markAccepted: "quotes.markAccepted",
			markDeclined: "quotes.markDeclined",
		},
		contracts: {
			markSigned: "contracts.markSigned",
		},
	},
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTokenRecord(overrides: {
	type: "quote" | "contract" | "invoice";
	documentId?: string;
	siteUrl?: string;
	expired?: boolean;
}) {
	return {
		expired: overrides.expired ?? false,
		token: {
			type: overrides.type,
			documentId: overrides.documentId ?? "doc-123",
			siteUrl: overrides.siteUrl ?? "angelsrest.online",
		},
	};
}

function makeReq(token: string, body?: unknown) {
	return {
		params: { token },
		request: {
			json: async () => body ?? {},
		},
	} as any;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/portal/[token]/accept", () => {
	let POST: (event: any) => Promise<Response>;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.resetModules();
		const mod = await import("../accept/+server");
		POST = mod.POST as unknown as typeof POST;
	});

	it("returns 404 when token is not found", async () => {
		mockConvexQuery.mockResolvedValue(null);

		try {
			await POST(makeReq("bad-token"));
			expect.fail("should have thrown");
		} catch (err: any) {
			expect(err.status).toBe(404);
		}
	});

	it("returns 404 when token is expired", async () => {
		mockConvexQuery.mockResolvedValue(makeTokenRecord({ type: "quote", expired: true }));

		try {
			await POST(makeReq("expired-token"));
			expect.fail("should have thrown");
		} catch (err: any) {
			expect(err.status).toBe(404);
		}
	});

	it("returns 400 when token type is not quote", async () => {
		mockConvexQuery.mockResolvedValue(makeTokenRecord({ type: "contract" }));

		try {
			await POST(makeReq("wrong-type"));
			expect.fail("should have thrown");
		} catch (err: any) {
			expect(err.status).toBe(400);
		}
	});

	it("marks quote accepted and burns the token on success", async () => {
		mockConvexQuery.mockResolvedValue(
			makeTokenRecord({
				type: "quote",
				documentId: "quote-1",
				siteUrl: "angelsrest.online",
			}),
		);
		mockConvexMutation.mockResolvedValue(null);

		const response = await POST(makeReq("good-token"));
		expect(response.status).toBe(200);

		expect(mockConvexMutation).toHaveBeenCalledWith("quotes.markAccepted", {
			quoteId: "quote-1",
			siteUrl: "angelsrest.online",
		});
		expect(mockConvexMutation).toHaveBeenCalledWith("portal.markUsed", {
			token: "good-token",
		});
	});

	it("returns 500 when mark-accepted mutation fails", async () => {
		mockConvexQuery.mockResolvedValue(makeTokenRecord({ type: "quote" }));
		mockConvexMutation.mockRejectedValue(new Error("convex down"));

		try {
			await POST(makeReq("good-token"));
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

	it("returns 404 when token is missing or expired", async () => {
		mockConvexQuery.mockResolvedValue(null);
		try {
			await POST(makeReq("bad"));
			expect.fail("should have thrown");
		} catch (err: any) {
			expect(err.status).toBe(404);
		}
	});

	it("returns 400 when token is not a quote token", async () => {
		mockConvexQuery.mockResolvedValue(makeTokenRecord({ type: "contract" }));
		try {
			await POST(makeReq("wrong"));
			expect.fail("should have thrown");
		} catch (err: any) {
			expect(err.status).toBe(400);
		}
	});

	it("marks quote declined and burns the token on success", async () => {
		mockConvexQuery.mockResolvedValue(
			makeTokenRecord({
				type: "quote",
				documentId: "quote-2",
				siteUrl: "angelsrest.online",
			}),
		);
		mockConvexMutation.mockResolvedValue(null);

		const response = await POST(makeReq("good-token"));
		expect(response.status).toBe(200);

		expect(mockConvexMutation).toHaveBeenCalledWith("quotes.markDeclined", {
			quoteId: "quote-2",
			siteUrl: "angelsrest.online",
		});
		expect(mockConvexMutation).toHaveBeenCalledWith("portal.markUsed", {
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

	it("returns 404 when token is missing or expired", async () => {
		mockConvexQuery.mockResolvedValue(null);
		try {
			await POST(makeReq("bad", { signerName: "Jane" }));
			expect.fail("should have thrown");
		} catch (err: any) {
			expect(err.status).toBe(404);
		}
	});

	it("returns 400 when token is not a contract token", async () => {
		mockConvexQuery.mockResolvedValue(makeTokenRecord({ type: "quote" }));
		try {
			await POST(makeReq("wrong", { signerName: "Jane" }));
			expect.fail("should have thrown");
		} catch (err: any) {
			expect(err.status).toBe(400);
		}
	});

	it("returns 400 when signerName is missing or blank", async () => {
		mockConvexQuery.mockResolvedValue(makeTokenRecord({ type: "contract" }));

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
	});

	it("marks contract signed and burns the token on success", async () => {
		mockConvexQuery.mockResolvedValue(
			makeTokenRecord({
				type: "contract",
				documentId: "contract-1",
				siteUrl: "angelsrest.online",
			}),
		);
		mockConvexMutation.mockResolvedValue(null);

		const response = await POST(makeReq("good-token", { signerName: "Jane Doe" }));
		expect(response.status).toBe(200);

		expect(mockConvexMutation).toHaveBeenCalledWith("contracts.markSigned", {
			contractId: "contract-1",
			siteUrl: "angelsrest.online",
		});
		expect(mockConvexMutation).toHaveBeenCalledWith("portal.markUsed", {
			token: "good-token",
		});
	});

	it("returns 500 when mark-signed mutation fails", async () => {
		mockConvexQuery.mockResolvedValue(makeTokenRecord({ type: "contract" }));
		mockConvexMutation.mockRejectedValue(new Error("convex down"));

		try {
			await POST(makeReq("good", { signerName: "Jane" }));
			expect.fail("should have thrown");
		} catch (err: any) {
			expect(err.status).toBe(500);
		}
	});
});
