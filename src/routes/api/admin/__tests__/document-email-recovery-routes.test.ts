import { beforeEach, describe, expect, it, vi } from "vitest";

const { exactGet, openGet, resolvePost } = vi.hoisted(() => ({
	exactGet: vi.fn(),
	openGet: vi.fn(),
	resolvePost: vi.fn(),
}));

vi.mock("$lib/server/adminHandler", () => ({}));

vi.mock("@jessepomeroy/admin/server", () => ({
	createDocumentEmailRecoveryGetHandler: () => exactGet,
	createOpenDocumentEmailRecoveryGetHandler: () => openGet,
	createDocumentEmailRecoveryResolveHandler: () => resolvePost,
}));

describe("document-email recovery route adoption", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetModules();
	});

	it("mounts the static open-attempt discovery GET", async () => {
		const route = await import("../document-email-attempts/open/+server");
		expect(route.GET).toBe(openGet);
	});

	it("mounts the exact-attempt recovery GET", async () => {
		const route = await import("../document-email-attempts/[attemptId]/+server");
		expect(route.GET).toBe(exactGet);
	});

	it("mounts the exact-attempt operator resolution POST", async () => {
		const route = await import("../document-email-attempts/[attemptId]/resolve/+server");
		expect(route.POST).toBe(resolvePost);
	});
});
