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
		await expect(dialog.getByRole("button", { name: "Close lightbox" })).toBeFocused();
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

for (const count of [0, 1, 2]) {
	test(`public lightbox keeps background inert and focus contained (${count} images)`, async ({ page }) => {
		await page.goto(`/?fixture=content&kind=gallery&images=${count}`);
		await page.getByRole("button", { name: "Open portfolio lightbox" }).click();
		const dialog = page.getByRole("dialog", { name: /Image lightbox/ });
		const close = dialog.getByRole("button", { name: "Close lightbox" });
		await expect(close).toBeFocused();
		await expect(dialog).toHaveJSProperty("open", true);
		await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");
		await page.locator('a[href="#outside"]').evaluate(element => element.focus());
		await expect(close).toBeFocused();
		for (const key of ["Shift+Tab", ...Array<string>(6).fill("Tab")]) {
			await page.keyboard.press(key);
			await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
		}
		await expect(dialog.getByRole("img")).toHaveCount(count ? 1 : 0);
		if (!count) await expect(dialog.getByText("No images available.")).toBeVisible();
	});
}

for (const dismissal of ["Escape", "close button", "backdrop", "unmount"] as const) {
	test(`public lightbox ${dismissal} restores prior scroll and opener`, async ({ page }) => {
		await page.goto("/?fixture=content&kind=gallery");
		await page.evaluate(() => { document.body.style.overflow = "clip"; });
		const opener = page.getByRole("button", { name: "Open portfolio lightbox" });
		await opener.click();
		const dialog = page.getByRole("dialog", { name: /Image lightbox/ });
		await expect(dialog).toBeVisible();
		if (dismissal === "Escape") await page.keyboard.press("Escape");
		else if (dismissal === "close button") await dialog.getByRole("button", { name: "Close lightbox" }).click();
		else if (dismissal === "backdrop") await page.mouse.click(5, 5);
		else await page.getByRole("button", { name: "Remove lightbox host", includeHidden: true }).dispatchEvent("click");
		await expect(dialog).toHaveCount(0);
		await expect(opener).toBeFocused();
		await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("clip");
		if (dismissal !== "unmount") {
			await page.keyboard.press("Enter");
			await expect(dialog).toBeVisible();
		}
	});
}

test("public portfolio page arrows and swipes wrap once and reopening selects the clicked image", async ({ page }) => {
	await page.goto("/?fixture=content&kind=portfolio-page");
	const opener = page.getByRole("button", { name: "View image 2", exact: true });
	await opener.click();
	const dialog = page.getByRole("dialog", { name: /Image lightbox/ });
	const count = dialog.locator(".image-count");
	await expect(count).toHaveText("2/2");
	await expect.poll(() => count.evaluate(element => {
		const rect = element.getBoundingClientRect();
		return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === element;
	})).toBe(true);
	await page.keyboard.press("ArrowRight");
	await expect(count).toHaveText("1/2");
	await page.keyboard.press("ArrowLeft");
	await expect(count).toHaveText("2/2");
	const image = dialog.getByRole("img");
	await image.click();
	await expect(dialog).toBeVisible();
	const target = await image.elementHandle();
	await image.dispatchEvent("touchstart", { touches: [{ identifier: 0, target, clientX: 200 }] });
	await image.dispatchEvent("touchmove", { touches: [{ identifier: 0, target, clientX: 100 }] });
	await image.dispatchEvent("touchend");
	await expect(count).toHaveText("1/2");
	await image.dispatchEvent("touchstart", { touches: [{ identifier: 0, target, clientX: 100 }] });
	await image.dispatchEvent("touchmove", { touches: [{ identifier: 0, target, clientX: 200 }] });
	await image.dispatchEvent("touchend");
	await expect(count).toHaveText("2/2");
	await page.keyboard.press("Escape");
	await expect(opener).toBeFocused();
	await page.getByRole("button", { name: "View image 1", exact: true }).click();
	await expect(count).toHaveText("1/2");
});

for (const removeFirst of [false, true]) {
	test(`overlapping public dialogs retain scroll lock (${removeFirst ? "remove lower first" : "close upper first"})`, async ({ page }) => {
		await page.goto("/?fixture=content&kind=gallery");
		await page.evaluate(() => { document.body.style.overflow = "clip"; });
		await page.getByRole("button", { name: "Open portfolio lightbox" }).click();
		const lightbox = page.locator("dialog.lightbox");
		// Simulate a second owner opening during an already active modal lifetime.
		await page.getByRole("button", { name: "Open overlapping cart", includeHidden: true }).dispatchEvent("click");
		const cart = page.getByRole("dialog", { name: "Shopping cart" });
		await expect(cart).toBeVisible();
		await page.keyboard.press("ArrowRight");
		await expect(lightbox.locator(".image-count")).toHaveText("1/2");
		if (removeFirst) {
			await page.getByRole("button", { name: "Remove lightbox host", includeHidden: true }).dispatchEvent("click");
			await expect(lightbox).toHaveCount(0);
			await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");
		}
		await page.keyboard.press("Escape");
		await expect(cart).toHaveCount(0);
		if (!removeFirst) {
			await expect(lightbox).toBeVisible();
			await expect(lightbox.getByRole("button", { name: "Close lightbox" })).toBeFocused();
			await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");
			await page.keyboard.press("Escape");
			await expect(lightbox).toHaveCount(0);
		}
		await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("clip");
	});
}
