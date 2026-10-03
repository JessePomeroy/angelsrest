import { expect, test } from "@playwright/test";

// Only fixture assets may load. A stray provider request fails the test.
test.beforeEach(async ({ page }) => {
	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (url.origin === "http://127.0.0.1:5196") await route.continue();
		else {
			await route.abort();
			throw new Error(`Unexpected external request: ${url.origin}`);
		}
	});
});

for (const dismissal of ["Escape", "close button", "backdrop"] as const) {
	test(`delivery lightbox ${dismissal} locks background scrolling and restores its opener`, async ({ page, browserName, isMobile }) => {
		await page.goto("/?fixture=delivery-downloads&count=60");
		await page.evaluate(() => { document.body.style.overflow = "auto"; });
		const opener = page.getByRole("button", { name: "View item 12 of 60", exact: true });
		await opener.scrollIntoViewIfNeeded();
		await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
		const before = await page.evaluate(() => scrollY);
		await opener.click();
		const dialog = page.getByRole("dialog", { name: "Gallery lightbox" });
		const close = dialog.getByRole("button", { name: "Close lightbox" });
		await expect(close).toBeFocused();
		// Mobile WebKit rejects wheel injection; use its supported keyboard scroll input.
		const supportsWheel = browserName !== "webkit" || !isMobile;
		if (supportsWheel) {
			await page.mouse.move(5, 5);
			await page.mouse.wheel(0, 600);
		} else await page.keyboard.press("PageDown");
		await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
		expect(await page.evaluate(() => scrollY)).toBe(before);
		await expect(dialog).toHaveJSProperty("open", true);
		await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");
		await opener.evaluate((element) => element.focus());
		await expect(close).toBeFocused();
		for (const key of ["Tab", "Shift+Tab", "Shift+Tab", "Tab"]) {
			await page.keyboard.press(key);
			await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
		}
		if (dismissal === "Escape") await page.keyboard.press("Escape");
		else if (dismissal === "close button") await close.click();
		else await page.mouse.click(5, 5);
		await expect(dialog).toHaveCount(0);
		await expect(opener).toBeFocused();
		await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("auto");
		expect(await page.evaluate(() => scrollY)).toBe(before);
		if (supportsWheel) await page.mouse.wheel(0, 300);
		else await page.keyboard.press("PageDown");
		await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before);
		await page.keyboard.press("Enter");
		await expect(dialog).toBeVisible();
		await page.keyboard.press("Escape");
	});
}

test("delivery lightbox unmount releases its scroll lock before another gallery opens", async ({ page }) => {
	await page.goto("/?fixture=delivery-downloads");
	await page.evaluate(() => { document.body.style.overflow = "clip"; });
	const opener = page.getByRole("button", { name: "View item 1 of 4", exact: true });
	await opener.click();
	const dialog = page.getByRole("dialog", { name: "Gallery lightbox" });
	await expect(dialog).toBeVisible();
	await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");
	// Simulate route teardown; this is not a user click through inert content.
	await page.getByRole("button", { name: "Unmount gallery", includeHidden: true }).dispatchEvent("click");
	await expect(dialog).toHaveCount(0);
	await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("clip");
	await page.getByRole("button", { name: "Mount gallery", exact: true }).click();
	await opener.click();
	await expect(dialog).toBeVisible();
	await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");
	await page.keyboard.press("Escape");
	await expect(opener).toBeFocused();
	await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("clip");
});
