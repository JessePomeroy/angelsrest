import { expect, test } from "@playwright/test";

// These checks exercise delivery/fallback, not optional GPU animation performance.
test.use({ contextOptions: { reducedMotion: "reduce" } });

test("all existing font faces load without the Fontshare API stylesheet", async ({ page }) => {
	const apiRequests: string[] = [];
	await page.route("https://api.fontshare.com/**", (route) => {
		apiRequests.push(route.request().url());
		return route.abort();
	});
	await page.goto("/");
	expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
	const faces = await page.evaluate(async () => {
		const requested = [
			{ family: "Chillax", weight: 400 },
			{ family: "Chillax", weight: 600 },
			{ family: "Synonym", weight: 400 },
			{ family: "Synonym", weight: 500 },
		];
		return Promise.all(
			requested.map(async ({ family, weight }) => {
				const loaded = await document.fonts.load(
					`${weight} 16px "${family}"`,
					"Angel’s Rest — Café, naïve, Łódź, €123",
				);
				return { family, weight, states: loaded.map((face) => face.status) };
			}),
		);
	});
	expect(faces).toEqual([
		{ family: "Chillax", weight: 400, states: ["loaded"] },
		{ family: "Chillax", weight: 600, states: ["loaded"] },
		{ family: "Synonym", weight: 400, states: ["loaded"] },
		{ family: "Synonym", weight: 500, states: ["loaded"] },
	]);
	expect(apiRequests).toEqual([]);
	await expect(page.locator(".hero-tagline")).toBeVisible();
});

test("font-server failure leaves readable text and working gallery navigation", async ({ page }) => {
	await page.route("https://cdn.fontshare.com/**", (route) => route.abort());
	await page.goto("/");
	await expect(page.locator(".hero-tagline")).toHaveText("artist in residence[midwest]");
	await expect(page.locator(".hero-tagline")).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
	await page.getByRole("link", { name: "view gallery", exact: true }).click();
	await expect(page).toHaveURL(/\/gallery$/);
	await expect(page.locator("main")).toBeVisible();
});
