import { expect, test } from "@playwright/test";
import { publicAssets } from "../../src/lib/config/publicAssets";

test("public HTML cache is applied through the server hook, not to query or private responses", async ({
	request,
}) => {
	for (const path of ["/", "/gallery", "/blog"]) {
		const response = await request.get(path);
		expect(response.status()).toBe(200);
		expect(response.headers()["vercel-cdn-cache-control"]).toBe("public, s-maxage=60");
	}
	for (const path of ["/?preview=true", "/shop", "/orders"]) {
		const response = await request.get(path);
		expect(response.headers()["vercel-cdn-cache-control"]).toBeUndefined();
	}
	const cookieResponse = await request.get("/", { headers: { cookie: "fixture=1" } });
	expect(cookieResponse.headers()["vercel-cdn-cache-control"]).toBeUndefined();
});

test("public image references use the media host and the old social URL redirects without a body", async ({
	page,
	request,
}) => {
	await page.goto("/");
	await expect(page.locator(".hero-image img")).toHaveAttribute("src", publicAssets.hero);
	await expect(
		page.locator(`meta[property="og:image"][content="${publicAssets.openGraph}"]`),
	).toHaveCount(1);
	for (const url of await page
		.locator('meta[property="og:image"]')
		.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("content")))) {
		expect(url).toMatch(/^https:\/\/media\.angelsrest\.online\//);
	}
	await expect
		.poll(() =>
			page.locator(".hero-image img").evaluate((img: HTMLImageElement) => img.naturalWidth),
		)
		.toBeGreaterThan(0);
	const response = await request.get("/og-image.png", { maxRedirects: 0 });
	expect(response.status()).toBe(307);
	expect(response.headers().location).toBe(publicAssets.openGraph);
	expect((await response.body()).length).toBe(0);
});
