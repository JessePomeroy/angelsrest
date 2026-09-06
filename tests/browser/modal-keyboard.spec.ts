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

for (const populated of [false, true]) {
	test(`cart keyboard focus stays inside (${populated ? "populated" : "empty"})`, async ({
		page,
	}) => {
		await page.goto(`/?fixture=cart&populated=${populated}`);
		await page.getByRole("button", { name: "Open cart", exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "Shopping cart" });
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole("button", { name: "Close cart", exact: true })).toBeFocused();
		await page.getByRole("link", { name: "Outside link" }).evaluate((element) => element.focus());
		await expect(dialog.getByRole("button", { name: "Close cart", exact: true })).toBeFocused();
		for (const key of [
			"Shift+Tab",
			...Array<string>(12).fill("Tab"),
			...Array<string>(12).fill("Shift+Tab"),
		]) {
			await page.keyboard.press(key);
			await expect
				.poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
				.toBe(true);
		}
	});
}

for (const dismissal of ["Escape", "close button", "backdrop"] as const) {
	test(`cart ${dismissal} closes and returns focus`, async ({ page }) => {
		await page.goto("/?fixture=cart");
		const opener = page.getByRole("button", { name: "Open cart", exact: true });
		await opener.click();
		const dialog = page.getByRole("dialog", { name: "Shopping cart" });
		await expect(dialog).toBeVisible();
		// Start inside, so focus restoration cannot pass by leaving it on the opener.
		await dialog.getByRole("button", { name: "Close cart", exact: true }).focus();
		if (dismissal === "Escape") await page.keyboard.press("Escape");
		else if (dismissal === "close button")
			await dialog.getByRole("button", { name: "Close cart", exact: true }).click();
		else await page.mouse.click(5, 5);
		await expect(dialog).not.toBeVisible();
		await expect(opener).toBeFocused();
		await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");
		// A second open must still work after native dialog teardown.
		await page.keyboard.press("Enter");
		await expect(dialog).toBeVisible();
	});
}

test("delivery lightbox arrows advance once and stop at both edges", async ({ page }) => {
	await page.goto("/?fixture=delivery");
	const opener = page.getByRole("button", { name: "View item 1 of 4", exact: true });
	await opener.click();
	const dialog = page.getByRole("dialog", { name: "Gallery lightbox" });
	await expect(dialog.getByRole("button", { name: "Close lightbox" })).toBeFocused();
	const counter = dialog.locator(".lightbox-counter");
	await page.keyboard.press("ArrowLeft");
	await expect(counter).toHaveText("1 / 4");
	for (const index of [2, 3, 4, 4]) {
		await page.keyboard.press("ArrowRight");
		await expect(counter).toHaveText(`${index} / 4`);
		await expect(dialog.getByRole("img")).toHaveAttribute("alt", `photo-${index}.jpg`);
	}
	for (const index of [3, 2, 1, 1]) {
		await page.keyboard.press("ArrowLeft");
		await expect(counter).toHaveText(`${index} / 4`);
	}
	for (const key of ["Tab", "Shift+Tab", "Shift+Tab", "Tab"]) {
		await page.keyboard.press(key);
		await expect
			.poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
			.toBe(true);
	}
	await page.keyboard.press("Escape");
	await expect(dialog).not.toBeVisible();
	await expect(opener).toBeFocused();
});

for (const edge of ["first", "last"] as const) {
	test(`delivery keyboard remains usable after ${edge} navigation button disappears`, async ({
		page,
	}) => {
		await page.goto("/?fixture=delivery");
		const start = edge === "last" ? 3 : 2;
		const opener = page.getByRole("button", { name: `View item ${start} of 4`, exact: true });
		await opener.click();
		const dialog = page.getByRole("dialog", { name: "Gallery lightbox" });
		const navigation = dialog.getByRole("button", {
			name: edge === "last" ? "Next image" : "Previous image",
		});
		await navigation.focus();
		await page.keyboard.press("Enter");
		await expect(dialog.locator(".lightbox-counter")).toHaveText(
			edge === "last" ? "4 / 4" : "1 / 4",
		);
		await expect(navigation).toHaveCount(0);
		await expect
			.poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
			.toBe(true);
		await page.keyboard.press(edge === "last" ? "ArrowLeft" : "ArrowRight");
		await expect(dialog.locator(".lightbox-counter")).toHaveText(
			edge === "last" ? "3 / 4" : "2 / 4",
		);
		await page.keyboard.press("Escape");
		await expect(dialog).not.toBeVisible();
		await expect(opener).toBeFocused();
	});
}
