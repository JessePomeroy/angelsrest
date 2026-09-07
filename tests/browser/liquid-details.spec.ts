import { expect, test } from "@playwright/test";

test("cart droplet arrives before the cart opens, and motion changes preserve access", async ({ page, isMobile }) => {
	test.skip(!isMobile);
	test.setTimeout(60_000);
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.goto("/?fixture=liquid-details");
	await expect(page.locator(".sphere")).toBeVisible();
	await page.getByRole("button", { name: "Add print" }).tap();
	await expect(page.locator(".cart-droplet")).toBeAttached();
	await expect(page.getByRole("dialog")).toBeVisible();
	await expect(page.locator(".cart-droplet")).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await page.getByRole("button", { name: "Add print" }).tap();
	await page.emulateMedia({ reducedMotion: "reduce" });
	await expect(page.locator(".jelly-nav")).toHaveCount(0);
	await expect(page.getByRole("dialog")).toBeVisible();
});

test("reduced motion adds without a droplet or delay", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/?fixture=liquid-details");
	await page.getByRole("button", { name: "Add print" }).click();
	await expect(page.getByRole("dialog")).toBeVisible();
	await expect(page.locator(".cart-droplet")).toHaveCount(0);
});

test("resting over a marked photo briefly reveals the lens, and opening clears it", async ({ page, isMobile }) => {
	test.skip(!isMobile);
	test.setTimeout(60_000);
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.goto("/?fixture=liquid-details");
	await expect(page.locator(".photo-lens")).toHaveClass(/visible/, { timeout: 15000 });
	const colored = await page.locator(".photo-lens").evaluate((element) => {
		const canvas = element as HTMLCanvasElement;
		return canvas.getContext("2d")?.getImageData(80, 80, 1, 1).data[3];
	});
	expect(colored).toBe(255);
	await page.locator(".sphere").tap();
	await expect(page.locator(".photo-lens")).not.toHaveClass(/visible/);
});

test("the real print-set add button delivers to the sphere before opening its cart", async ({ page, isMobile }) => {
	test.skip(!isMobile);
	test.setTimeout(60_000);
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.goto("/?fixture=liquid-shop");
	await expect(page.locator(".sphere")).toBeVisible();
	await page.getByRole("button", { name: /add to cart/i }).first().click();
	await expect(page.locator(".cart-droplet")).toBeAttached();
	await expect(page.getByRole("dialog")).toBeVisible();
	await expect(page.locator(".cart-count")).toHaveText("1");
});
