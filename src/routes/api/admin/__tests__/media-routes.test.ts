import { beforeEach, describe, expect, it, vi } from "vitest";

const capabilityHandler = vi.fn();
const deleteHandler = vi.fn();
const processHandler = vi.fn();
const createCapabilityHandler = vi.fn(() => capabilityHandler);
const createDeleteHandler = vi.fn(() => deleteHandler);
const createProcessHandler = vi.fn(() => processHandler);
const setServerConfig = vi.fn();
const adminServerConfig = { siteUrl: "angelsrest.online" };

vi.mock("@jessepomeroy/admin/server", () => ({
	setServerConfig,
	createCmsMediaCapabilityHandler: createCapabilityHandler,
	createCmsMediaDeleteHandler: createDeleteHandler,
	createCmsMediaProcessHandler: createProcessHandler,
}));

vi.mock("$lib/config/admin.server", () => ({ adminServerConfig }));
vi.mock("$lib/server/adminAuth", () => ({ requireAuth: vi.fn() }));

async function loadHandler(path: string) {
	vi.resetModules();
	const mod = await import(path);
	return mod.POST as (event: unknown) => Promise<Response>;
}

function event(path: string, body: Record<string, unknown> = { filename: "portfolio.jpg" }) {
	return {
		request: new Request(`https://angelsrest.online${path}`, {
			method: "POST",
			body: JSON.stringify(body),
		}),
	};
}

describe("CMS media host routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		capabilityHandler.mockResolvedValue(Response.json({ uploadToken: "token" }));
		deleteHandler.mockResolvedValue(Response.json({ deleted: true, id: "media-1" }));
		processHandler.mockResolvedValue(Response.json({ asset: { _id: "media-1" } }));
	});

	it("delegates deletion to the shared authenticated saga", async () => {
		const POST = await loadHandler("../media/delete/+server");
		const input = event("/api/admin/media/delete", { id: "media-1" });
		const response = await POST(input);

		expect(setServerConfig).toHaveBeenCalledWith(adminServerConfig);
		expect(createDeleteHandler).toHaveBeenCalledOnce();
		expect(deleteHandler).toHaveBeenCalledWith(input);
		await expect(response.json()).resolves.toEqual({ deleted: true, id: "media-1" });
	});

	it("delegates capability issuance to the shared authenticated boundary", async () => {
		const POST = await loadHandler("../media/capability/+server");
		const input = event("/api/admin/media/capability");
		const response = await POST(input);

		expect(setServerConfig).toHaveBeenCalledWith(adminServerConfig);
		expect(createCapabilityHandler).toHaveBeenCalledOnce();
		expect(capabilityHandler).toHaveBeenCalledWith(input);
		await expect(response.json()).resolves.toEqual({ uploadToken: "token" });
	});

	it("delegates finalization and registration to the shared boundary", async () => {
		const POST = await loadHandler("../media/process/+server");
		const input = event("/api/admin/media/process");
		const response = await POST(input);

		expect(setServerConfig).toHaveBeenCalledWith(adminServerConfig);
		expect(createProcessHandler).toHaveBeenCalledOnce();
		expect(processHandler).toHaveBeenCalledWith(input);
		await expect(response.json()).resolves.toEqual({ asset: { _id: "media-1" } });
	});
});
