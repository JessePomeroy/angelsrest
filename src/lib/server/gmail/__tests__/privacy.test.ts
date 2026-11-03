import type { Handle } from "@sveltejs/kit";
import { expect, test, vi } from "vitest";

vi.mock("$lib/server/runtimeConfig", () => ({ isStagingEnvironment: () => false }));
vi.mock("$lib/server/publicPageCache", () => ({ applyPublicPageCache: vi.fn() }));

import { handle } from "../../../../hooks.server";

test.each([
	200, 404,
])("global response hooks preserve private attachment isolation for status %s", async (status) => {
	const url = new URL(
		"https://admin.example.test/api/admin/gmail/attachments/synthetic-private-file",
	);
	const input = {
		event: {
			url,
			request: new Request(url),
			route: { id: "/api/admin/gmail/attachments/[attachmentId]" },
		},
		resolve: async () =>
			new Response("synthetic", {
				status,
				headers: { "content-security-policy": "default-src 'none'; sandbox" },
			}),
	} as unknown as Parameters<Handle>[0];
	const response = await handle(input);
	expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
	expect(response.headers.get("cache-control")).toBe("private, no-store");
	expect(response.headers.get("referrer-policy")).toBe("no-referrer");
	expect(response.headers.get("x-content-type-options")).toBe("nosniff");
});
