import { expect, test } from "@playwright/test";

test("gallery fetches a new metadata page only when requested and retries without duplicates", async ({ page }) => {
	await page.goto("/?fixture=delivery-downloads&count=110&paged&fail-page-once");
	await expect(page.locator(".grid-cell")).toHaveCount(48);
	expect(await page.evaluate(() => Reflect.get(window, "galleryPageRequests").length)).toBe(0);
	await page.getByRole("button", { name: "Show more", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("Couldn't load more");
	await page.getByRole("button", { name: "Show more", exact: true }).click();
	await expect(page.locator(".grid-cell")).toHaveCount(96);
	await expect(page.getByRole("button", { name: "View item 49 of 110", exact: true })).toBeFocused();
	await page.getByRole("button", { name: "Show more", exact: true }).click();
	await expect(page.locator(".grid-cell")).toHaveCount(110);
	await expect(page.getByRole("button", { name: "Show more", exact: true })).toHaveCount(0);
});

test("lightbox crosses page boundaries and a late response does not reopen a closed lightbox", async ({ page }) => {
	await page.goto("/?fixture=delivery-downloads&count=110&paged&slow-pages");
	await page.getByRole("button", { name: "View item 48 of 110", exact: true }).click();
	await page.getByRole("button", { name: "Next image", exact: true }).click();
	await expect(page.locator(".lightbox-counter")).toHaveText("49 / 110");
	await page.getByRole("button", { name: "Close lightbox", exact: true }).click();
	await page.reload();
	await page.getByRole("button", { name: "View item 48 of 110", exact: true }).click();
	await page.getByRole("button", { name: "Next image", exact: true }).click();
	await page.getByRole("button", { name: "Close lightbox", exact: true }).click();
	await page.waitForTimeout(600);
	await expect(page.locator(".lightbox")).toHaveCount(0);
});

test("select all resolves unloaded records and exclusions on the server", async ({ page }) => {
	await page.goto("/?fixture=delivery-downloads&count=110&paged");
	await page.getByRole("button", { name: "select all", exact: true }).click();
	await expect(page.getByRole("button", { name: "download selected (110)", exact: true })).toBeVisible();
	await page.locator(".grid-cell .select-photo").first().click();
	// Intercept the final browser ZIP form; no file/provider traffic leaves the fixture.
	await page.evaluate(() => { HTMLFormElement.prototype.submit = function() {}; });
	await page.getByRole("button", { name: "download selected (109)", exact: true }).click();
	await expect.poll(() => page.evaluate(() => Reflect.get(window, "galleryPageRequests").length)).toBe(3);
	const selections = await page.evaluate(() => Reflect.get(window, "galleryPageRequests").map((request: { selection: unknown }) => request.selection));
	expect(selections).toEqual(Array.from({ length: 3 }, () => ({ kind: "all", excludedIds: ["fixture-image-0"] })));
	await expect(page.locator(".grid-cell")).toHaveCount(48);
});
