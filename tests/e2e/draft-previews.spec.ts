import { expect, test } from "@playwright/test";

test("anonymous preview pages and grant requests fail closed with private response headers", async ({ request }) => {
	const page = await request.get("/about?draftPreview=invalid");
	const origin = new URL(page.url()).origin;
	const grant = await request.post("/api/admin/draft-preview/about", {
		headers: { origin }, data: {},
	});
	for (const response of [page, grant]) {
		expect(response.status()).toBe(401);
		expect(response.headers()["cache-control"]).toContain("no-store");
		expect(response.headers()["x-robots-tag"]).toContain("noindex");
		expect(response.headers()["referrer-policy"]).toBe("no-referrer");
		expect(response.headers()["vercel-cdn-cache-control"]).toBeUndefined();
	}
});
