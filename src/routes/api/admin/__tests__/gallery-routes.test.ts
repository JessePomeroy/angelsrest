import { beforeEach, describe, expect, it, vi } from "vitest";

const mockBulkDeleteHandler = vi.fn();
const mockCreateGalleryBulkDeleteHandler = vi.fn(() => mockBulkDeleteHandler);
const mockSetServerConfig = vi.fn();
const mockAdminServerConfig = { siteUrl: "https://tenant.example" };
const mockRequireAuth = vi.fn();

vi.mock("@jessepomeroy/admin/server", () => ({
	setServerConfig: mockSetServerConfig,
	createGalleryBulkDeleteHandler: mockCreateGalleryBulkDeleteHandler,
}));

vi.mock("$lib/config/admin.server", () => ({
	adminServerConfig: mockAdminServerConfig,
}));

vi.mock("$lib/server/adminAuth", () => ({
	requireAuth: mockRequireAuth,
}));

function makeEvent() {
	return {
		cookies: {
			get: vi.fn(),
			getAll: vi.fn(),
			set: vi.fn(),
		} as unknown as import("@sveltejs/kit").Cookies,
		request: new Request("http://localhost/api/admin/galleries/bulk-delete", {
			method: "POST",
			body: JSON.stringify({ keys: ["site/gallery/original/photo.jpg"] }),
		}),
	};
}

async function loadHandler(path: string) {
	vi.resetModules();
	const mod = await import(path);
	return mod.POST as (event: unknown) => Promise<Response>;
}

describe("POST /api/admin/galleries/bulk-delete", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("delegates to the shared package handler", async () => {
		mockBulkDeleteHandler.mockResolvedValue(Response.json({ success: true }));

		const POST = await loadHandler("../galleries/bulk-delete/+server");
		const event = makeEvent();
		const response = await POST(event);

		expect(mockSetServerConfig).toHaveBeenCalledWith(mockAdminServerConfig);
		expect(mockCreateGalleryBulkDeleteHandler).toHaveBeenCalledTimes(1);
		expect(mockBulkDeleteHandler).toHaveBeenCalledTimes(1);
		expect(mockBulkDeleteHandler).toHaveBeenCalledWith(event);
		await expect(response.json()).resolves.toEqual({ success: true });
	});

	it("propagates errors thrown by the shared package handler", async () => {
		mockBulkDeleteHandler.mockRejectedValue(new Error("worker failed"));

		const POST = await loadHandler("../galleries/bulk-delete/+server");

		await expect(POST(makeEvent())).rejects.toThrow("worker failed");
	});
});
