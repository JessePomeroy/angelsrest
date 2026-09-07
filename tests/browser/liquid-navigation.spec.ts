import { expect, test } from "@playwright/test";

test("reduced motion keeps the original nav and cart without loading liquid modules", async ({ page, isMobile }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	const liquidRequests: string[] = [];
	page.on("request", (request) => {
		if (/JellyNav|jelly-nav|three/.test(request.url())) liquidRequests.push(request.url());
	});
	await page.goto("/?fixture=liquid-navigation&populated=true");
	const nav = page.getByRole("navigation", { name: "Mobile navigation" });
	if (isMobile) {
		await expect(nav).toBeVisible();
		await expect(nav.getByRole("link")).toHaveCount(5);
		await page.getByRole("button", { name: /cart/i }).click();
		await expect(page.getByRole("dialog")).toBeVisible();
	}
	await expect(page.locator(".jelly-nav")).toHaveCount(0);
	expect(liquidRequests).toEqual([]);
});

test("liquid navigation opens destinations and cart, and responds to motion preference changes", async ({ page, isMobile }) => {
	test.skip(!isMobile);
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.goto("/?fixture=liquid-navigation");
	const sphere = page.locator(".sphere");
	await expect(sphere).toBeVisible();
	await expect(page.locator(".jelly-nav")).toHaveClass(/rendered/);
	await sphere.tap();
	await expect(sphere).toHaveAttribute("aria-expanded", "true");
	const nav = page.getByRole("navigation", { name: "Mobile navigation" });
	await expect(nav.getByRole("link")).toHaveCount(5);
	await page.getByRole("button", { name: "Open cart, 0 items" }).click();
	await expect(page.getByRole("dialog")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(sphere).toBeFocused();
	await page.emulateMedia({ reducedMotion: "reduce" });
	await expect(sphere).toHaveCount(0);
	await expect(nav.getByRole("link")).toHaveCount(5);
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await expect(sphere).toBeVisible();
	await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toHaveCount(1);
});

test("touch drag flings the sphere without opening navigation or selecting page text", async ({ page, isMobile }) => {
	test.skip(!isMobile);
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.goto("/?fixture=liquid-navigation");
	const sphere = page.locator(".sphere");
	await expect(sphere).toBeVisible();
	const box = await sphere.boundingBox();
	if (!box) throw new Error("Missing sphere bounds");
	const session = await page.context().newCDPSession(page);
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
	for (let step = 1; step <= 8; step++) {
		await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - step * 12, y: y - step * 20 }] });
	}
	await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
	await expect(sphere).toHaveAttribute("aria-expanded", "false");
	await expect(page.locator(".jelly-nav")).toHaveClass(/flying/);
	await expect.poll(async () => (await sphere.boundingBox())?.y).toBeLessThan(box.y - 100);
	expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
	await session.detach();
});
