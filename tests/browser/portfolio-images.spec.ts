import { expect, test } from "@playwright/test";

test("portfolio grid and lightbox select responsive sources with intrinsic dimensions", async ({ page }) => {
	await page.route("**/portfolio-candidates/*.svg", async (route) => {
		const width = Number(/-(\d+)\.svg/.exec(route.request().url())?.[1]);
		await route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${Math.round(width * 4 / 3)}"><rect width="100%" height="100%" fill="#789abc"/></svg>` });
	});
	await page.goto("/?fixture=content&kind=portfolio-page&responsive=1");
	const grid = page.locator(".image-grid img");
	await expect(grid.first()).toHaveAttribute("width", "768");
	await expect(grid.first()).toHaveAttribute("height", "1024");
	await expect(grid.first()).toHaveAttribute("loading", "eager");
	await expect(grid.nth(1)).toHaveAttribute("loading", "lazy");
	await grid.first().evaluate((image) => (image as HTMLImageElement).decode());
	expect(await grid.first().evaluate((image) => (image as HTMLImageElement).currentSrc)).toMatch(/-(320|768)\.svg$/);
	await page.locator(".image-grid button").first().click();
	const lightbox = page.locator(".lightbox img");
	await expect(lightbox).toHaveAttribute("width", "2048");
	await expect(lightbox).toHaveAttribute("height", "2731");
	await lightbox.evaluate((image) => (image as HTMLImageElement).decode());
	expect(await lightbox.evaluate((image) => (image as HTMLImageElement).currentSrc)).toMatch(/-(320|768|1280)\.svg$/);
	const bounds = await lightbox.boundingBox();
	expect(bounds).not.toBeNull();
	expect(bounds!.width / bounds!.height).toBeCloseTo(0.75, 2);
	await page.getByRole("button", { name: "Next image" }).click();
	await expect(lightbox).toHaveAttribute("src", "/portfolio-candidates/2-2048.svg");
});

test("portfolio collections reserve the preview aspect ratio", async ({ page }) => {
	await page.goto("/?fixture=content&kind=portfolio-index");
	const first = page.locator(".gallery-entry img").first();
	await expect(first).toHaveAttribute("width", "600");
	await expect(first).toHaveAttribute("height", "400");
	await first.evaluate((image) => (image as HTMLImageElement).decode());
	const bounds = await first.boundingBox();
	expect(bounds).not.toBeNull();
	expect(bounds!.width / bounds!.height).toBeCloseTo(1.5, 2);
});
