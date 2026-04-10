import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetToken = vi.fn();

vi.mock("@mmailaender/convex-better-auth-svelte/sveltekit", () => ({
	getToken: mockGetToken,
}));

// Mock @sveltejs/kit error() to throw like it does at runtime
vi.mock("@sveltejs/kit", () => ({
	error: (status: number, message: string) => {
		const err = new Error(message) as Error & { status: number };
		err.status = status;
		throw err;
	},
}));

describe("requireAuth", () => {
	let requireAuth: typeof import("../adminAuth").requireAuth;

	beforeEach(async () => {
		vi.clearAllMocks();
		const mod = await import("../adminAuth");
		requireAuth = mod.requireAuth;
	});

	it("returns the token when a valid session exists", () => {
		mockGetToken.mockReturnValue("valid-session-token-123");

		const mockCookies = {} as any;
		const result = requireAuth(mockCookies);

		expect(result).toBe("valid-session-token-123");
		expect(mockGetToken).toHaveBeenCalledWith(mockCookies);
	});

	it("throws 401 when no session token is present", () => {
		mockGetToken.mockReturnValue(null);

		const mockCookies = {} as any;

		try {
			requireAuth(mockCookies);
			expect.fail("should have thrown");
		} catch (err: any) {
			expect(err.status).toBe(401);
			expect(err.message).toBe("Unauthorized");
		}
	});

	it("throws 401 when getToken returns undefined", () => {
		mockGetToken.mockReturnValue(undefined);

		const mockCookies = {} as any;

		try {
			requireAuth(mockCookies);
			expect.fail("should have thrown");
		} catch (err: any) {
			expect(err.status).toBe(401);
		}
	});

	it("throws 401 when getToken returns empty string", () => {
		mockGetToken.mockReturnValue("");

		const mockCookies = {} as any;

		try {
			requireAuth(mockCookies);
			expect.fail("should have thrown");
		} catch (err: any) {
			expect(err.status).toBe(401);
		}
	});
});
