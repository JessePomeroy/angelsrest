import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
	await page.addInitScript(() => {
		Object.defineProperty(window, "turnstile", { value: { render: () => "fixture", reset() {}, remove() {} } });
		Object.defineProperty(window, "Cal", { writable: true, value: Object.assign(() => {}, { ns: { photosession: Object.assign(() => {}, { instance: {} }) } }) });
	});
});

test("about keeps portrait, biography and contact arranged across three breakpoints", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/?fixture=content&kind=about");
	for (const width of [760, 900, 1200]) {
		await page.setViewportSize({ width, height: 900 });
		const portrait = await page.locator(".portrait-frame").boundingBox();
		const biography = await page.locator(".biography").boundingBox();
		const contact = await page.locator(".contact-section").boundingBox();
		if (!portrait || !biography || !contact) throw new Error("Content layout missing");
		if (width === 760) {
			expect(biography.y).toBeGreaterThan(portrait.y);
			expect(contact.y).toBeGreaterThan(biography.y);
		} else if (width === 900) {
			expect(biography.x).toBeGreaterThan(portrait.x);
			expect(contact.x).toBe(portrait.x);
			expect(contact.y).toBeGreaterThan(biography.y);
		} else {
			expect(biography.x).toBeGreaterThan(portrait.x);
			expect(contact.x).toBeGreaterThan(biography.x);
			expect(contact.y).toBe(biography.y);
		}
	}
	await expect(page.getByRole("button", { name: "Book a session" })).toBeEnabled();
	await expect(page.getByLabel("email", { exact: true })).toBeVisible();
	await expect(page.locator("form")).toHaveCSS("display", "flex");
	await expect(page.getByLabel("email", { exact: true })).toHaveCSS("border-top-width", "1px");
	expect(errors).toEqual([]);
});

test("portfolio lightbox keeps focus, keyboard navigation and close restoration", async ({ page }) => {
	await page.goto("/?fixture=content&kind=gallery");
	const opener = page.getByRole("button", { name: "Open portfolio lightbox" });
	await opener.click();
	const dialog = page.getByRole("dialog");
	const close = page.getByRole("button", { name: "Close lightbox" });
	await expect(close).toBeFocused();
	await expect(dialog.getByAltText("First portfolio image")).toBeVisible();
	await page.keyboard.press("ArrowRight");
	await expect(dialog.getByAltText("Second portfolio image")).toBeVisible();
	await page.keyboard.press("Shift+Tab");
	await expect(page.getByRole("button", { name: "Next image", exact: true })).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(dialog).toHaveCount(0);
	await expect(opener).toBeFocused();
});
