import { setServerConfig } from "@jessepomeroy/admin/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminServerConfig } from "$lib/config/admin.server";
import * as completeRoute from "../../routes/api/admin/catalog-private-assets/editor-uploads/complete/+server";
import * as prepareRoute from "../../routes/api/admin/catalog-private-assets/editor-uploads/prepare/+server";

const { verifySiteAdminRequest } = vi.hoisted(() => ({
	verifySiteAdminRequest: vi.fn(),
}));

vi.mock("$env/dynamic/private", () => ({
	env: {
		CATALOG_PRIVATE_EDITOR_UPLOAD_HOST_JOURNAL_SECRET: "h".repeat(32),
		CATALOG_PRIVATE_EDITOR_UPLOAD_STORAGE_CALLER_SECRET: "s".repeat(32),
	},
}));

vi.mock("$env/dynamic/public", () => ({
	env: { PUBLIC_CONVEX_URL: "https://loyal-swan-967.convex.cloud" },
}));

vi.mock("$lib/config/admin", () => ({
	adminConfig: { siteUrl: "angelsrest.online" },
}));

vi.mock("$lib/server/adminAuth", () => ({
	adminAuth: { getTokenFromRequest: vi.fn() },
	requireAuth: vi.fn(),
}));

vi.mock("$lib/server/galleryWorkerUrl", () => ({
	getGalleryWorkerUrl: () => "https://gallery-worker.thinkingofview.workers.dev",
}));

vi.mock("$lib/server/siteAdminAuthorization", () => ({ verifySiteAdminRequest }));

const uploadHandle = "123e4567-e89b-42d3-a456-426614174000";
const prepareBody = JSON.stringify({
	uploadHandle,
	productKind: "print",
	originalFilename: "source.jpg",
	contentType: "image/jpeg",
	sizeBytes: 1,
	sha256: "0".repeat(64),
	widthPixels: 1,
	heightPixels: 1,
});
const completeBody = JSON.stringify({ uploadHandle });

function sameOriginRequest(path: string, body: string) {
	return new Request(`https://www.angelsrest.online${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Origin: "https://www.angelsrest.online",
			"Sec-Fetch-Site": "same-origin",
			"Sec-Fetch-Mode": "cors",
			"Sec-Fetch-Dest": "empty",
		},
		body,
	});
}

const routeVectors = [
	{
		name: "prepare",
		post: prepareRoute.POST,
		path: "/api/admin/catalog-private-assets/editor-uploads/prepare",
		body: prepareBody,
	},
	{
		name: "complete",
		post: completeRoute.POST,
		path: "/api/admin/catalog-private-assets/editor-uploads/complete",
		body: completeBody,
	},
];

describe("catalog private Editor upload routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		verifySiteAdminRequest.mockResolvedValue(false);
		vi.stubGlobal(
			"fetch",
			vi.fn(() => Promise.reject(new Error("unexpected external fetch"))),
		);
		setServerConfig(adminServerConfig);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		setServerConfig(adminServerConfig);
	});

	it("mounts only POST handlers with the documented Vercel durations", () => {
		expect(Object.keys(prepareRoute).sort()).toEqual(["POST", "config"]);
		expect(Object.keys(completeRoute).sort()).toEqual(["POST", "config"]);
		expect(prepareRoute.config).toEqual({ maxDuration: 30 });
		expect(completeRoute.config).toEqual({ runtime: "nodejs24.x", maxDuration: 60 });
		expect(prepareRoute.POST).toBeTypeOf("function");
		expect(completeRoute.POST).toBeTypeOf("function");
	});

	it.each(
		routeVectors,
	)("delegates $name authorization to the real shared handler and existing stored-membership verifier for the matching deployment", async ({
		post,
		path,
		body,
	}) => {
		expect(adminServerConfig.catalogPrivateEditorUpload).toBeDefined();
		const response = await post({ request: sameOriginRequest(path, body) } as never);

		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toEqual({ status: "unauthorized" });
		expect(verifySiteAdminRequest).toHaveBeenCalledOnce();
		expect(fetch).not.toHaveBeenCalled();
	});
});
