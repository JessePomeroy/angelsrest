import { expect, test } from "@playwright/test";

const longName = "2026-09-08_family_portraits_at_the_botanical_gardens_001";
const cases = [
	{ name: "long RAW", filename: `${longName}.raf`, raw: true, downloads: true, favorites: true },
	{ name: "long image", filename: `${longName}.jpg`, raw: false, downloads: true, favorites: true },
	{ name: "portrait image", filename: `${longName}.jpg`, raw: false, downloads: true, favorites: true, portrait: true },
	{ name: "ordinary image", filename: "photo-1.jpg", raw: false, downloads: true, favorites: true },
	{ name: "download only", filename: `${longName}.raf`, raw: true, downloads: true, favorites: false },
	{ name: "favorite only", filename: `${longName}.raf`, raw: true, downloads: false, favorites: true },
	{ name: "no actions", filename: `${longName}.raf`, raw: true, downloads: false, favorites: false },
];

test.beforeEach(async ({ page }) => {
	await page.route("**/*", async (route) => {
		if (new URL(route.request().url()).origin === "http://127.0.0.1:5196") return route.continue();
		await route.abort();
		throw new Error("Unexpected external request in delivery lightbox fixture");
	});
});

for (const scenario of cases) {
	test(`delivery lightbox controls fit before interaction: ${scenario.name}`, async ({ page }, testInfo) => {
		const params = new URLSearchParams({
			fixture: "delivery-downloads", filename: scenario.filename,
			downloads: String(scenario.downloads), favorites: String(scenario.favorites),
		});
		if (scenario.raw) params.set("raw", "");
		if (scenario.portrait) params.set("portrait", "");
		for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 852 }, { width: 1280, height: 900 }]) {
			await page.setViewportSize(viewport);
			await page.goto(`/?${params}`);
			const opener = page.getByRole("button", { name: "View item 1 of 4", exact: true });
			await opener.click();
			const dialog = page.getByRole("dialog", { name: "Gallery lightbox" });
			await expect(dialog.locator(".lightbox-counter")).toHaveText("1 / 4");
			await expect(dialog.locator(".lightbox-filename")).toHaveText(scenario.filename);
			const preview = dialog.getByRole("img");
			await expect(preview).toHaveCount(scenario.raw ? 0 : 1);
			if (!scenario.raw) {
				await expect.poll(() => preview.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
			}
			const download = dialog.getByRole("link", { name: "Download original file" });
			const favorite = dialog.getByRole("button", { name: "Remove from favorites" });
			await expect(download).toHaveCount(Number(scenario.downloads));
			await expect(favorite).toHaveCount(Number(scenario.favorites));

			// Measure every control before focus/trial-click helpers can scroll it into view.
			const geometry = await dialog.locator(".lightbox-counter, .lightbox-filename, button, a").evaluateAll((elements) =>
				elements.map((element) => {
					const rect = element.getBoundingClientRect();
					const interactive = element.matches("button, a");
					return {
						name: element.getAttribute("aria-label") ?? element.className,
						fits: rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
						hit: !interactive || element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
					};
				}),
			);
			expect(geometry.filter((item) => !item.fits || !item.hit)).toEqual([]);
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
			if (scenario.downloads) {
				await expect(download).toHaveAttribute("href", "/fixture-download/0");
				await download.click({ trial: true });
			}
			if (scenario.favorites) await favorite.click({ trial: true });
			const close = dialog.getByRole("button", { name: "Close lightbox" });
			await close.focus();
			await page.keyboard.press("Tab");
			await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
			await page.keyboard.press("Shift+Tab");
			await expect(close).toBeFocused();
			if (scenario.name === "long RAW" || scenario.name === "long image" || scenario.portrait) {
				await page.screenshot({ path: testInfo.outputPath(`lightbox-${viewport.width}.png`) });
			}
			await page.keyboard.press("Escape");
			await expect(dialog).toHaveCount(0);
			await expect(opener).toBeFocused();
		}
	});
}
