import { beforeEach, describe, expect, it, vi } from "vitest";
import { load as loadDashboard } from "../+page.server";
import { load as loadInquiries } from "../inquiries/+page.server";

const { mockGetToken, mockCreateAuthenticatedClient, mockQuery } = vi.hoisted(() => ({
	mockGetToken: vi.fn(),
	mockCreateAuthenticatedClient: vi.fn(),
	mockQuery: vi.fn(),
}));

vi.mock("@mmailaender/convex-better-auth-svelte/sveltekit", () => ({
	getToken: mockGetToken,
}));

vi.mock("$lib/server/convexClient", () => ({
	createAuthenticatedConvexClient: mockCreateAuthenticatedClient,
}));

vi.mock("$convex/api", () => ({
	api: {
		inquiries: {
			countNew: "inquiries.countNew",
			list: "inquiries.list",
		},
	},
}));

vi.mock("$lib/config/site", () => ({
	SITE_DOMAIN: "angelsrest.online",
}));

function eventWithStatus(status: "authorized" | "unauthorized") {
	return {
		parent: async () => ({
			adminSession:
				status === "authorized"
					? { status, email: "creator@example.com", tier: "full", isCreator: true }
					: { status, email: "other@example.com" },
		}),
		cookies: {},
	};
}

describe("authenticated admin page loaders", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCreateAuthenticatedClient.mockReturnValue({ query: mockQuery });
	});

	it("does not create a Convex client for an unauthorized dashboard request", async () => {
		await expect(loadDashboard(eventWithStatus("unauthorized") as never)).resolves.toEqual({
			newInquiryCount: 0,
		});
		expect(mockCreateAuthenticatedClient).not.toHaveBeenCalled();
	});

	it("creates a request-scoped authenticated client for dashboard data", async () => {
		mockGetToken.mockReturnValue("dashboard-token");
		mockQuery.mockResolvedValue(4);

		await expect(loadDashboard(eventWithStatus("authorized") as never)).resolves.toEqual({
			newInquiryCount: 4,
		});
		expect(mockCreateAuthenticatedClient).toHaveBeenCalledWith("dashboard-token");
		expect(mockQuery).toHaveBeenCalledWith("inquiries.countNew", {
			siteUrl: "angelsrest.online",
		});
	});

	it("creates a request-scoped client and maps authorized inquiry data", async () => {
		mockGetToken.mockReturnValue("inquiries-token");
		mockQuery.mockResolvedValue([
			{
				_id: "inquiry-1",
				_creationTime: 1_700_000_000_000,
				name: "Example",
				email: "person@example.com",
				phone: null,
				subject: "Question",
				message: "Hello",
				status: "new",
			},
		]);

		const result = await loadInquiries(eventWithStatus("authorized") as never);

		expect(mockCreateAuthenticatedClient).toHaveBeenCalledWith("inquiries-token");
		expect(mockQuery).toHaveBeenCalledWith("inquiries.list", {
			siteUrl: "angelsrest.online",
		});
		expect(result.inquiries).toEqual([
			{
				_id: "inquiry-1",
				name: "Example",
				email: "person@example.com",
				phone: null,
				subject: "Question",
				message: "Hello",
				status: "new",
				submittedAt: new Date(1_700_000_000_000).toISOString(),
			},
		]);
	});
});
