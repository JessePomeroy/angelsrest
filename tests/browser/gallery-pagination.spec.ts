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


test("stale Show more cannot reveal or focus a replacement gallery", async ({ page }) => {
 await page.goto("/?fixture=delivery-downloads&count=110&paged&hold-pages");
 await page.locator(".grid-cell .select-photo").first().click();
 await page.getByRole("button", { name: "Show more", exact: true }).click();
 await expect.poll(() => page.evaluate(() => Reflect.get(window, "galleryFixture").heldPages)).toBe(1);
 await page.evaluate(() => Reflect.get(window, "galleryFixture").replace("b"));
 await expect(page.locator(".grid-cell")).toHaveCount(48);
 const selectAll = page.getByRole("button", { name: "select all", exact: true });
 await selectAll.focus();
 await page.evaluate(() => Reflect.get(window, "galleryFixture").releasePage());
 await expect(page.locator(".grid-cell")).toHaveCount(48);
 await expect(selectAll).toBeFocused();
 await expect(page.getByRole("button", { name: "download selected (0)", exact: true })).toBeDisabled();
 await expect(page.getByRole("alert")).toHaveCount(0);
});

test("stale lightbox Next cannot move a replacement at the same index", async ({ page }) => {
 await page.goto("/?fixture=delivery-downloads&count=110&paged&hold-pages");
 await page.getByRole("button", { name: "View item 48 of 110", exact: true }).click();
 await page.getByRole("button", { name: "Next image", exact: true }).click();
 await expect.poll(() => page.evaluate(() => Reflect.get(window, "galleryFixture").heldPages)).toBe(1);
 await page.evaluate(() => Reflect.get(window, "galleryFixture").replace("b"));
 await page.getByRole("button", { name: "View item 48 of 60", exact: true }).click();
 await page.evaluate(() => Reflect.get(window, "galleryFixture").releasePage());
 await expect(page.locator(".lightbox-counter")).toHaveText("48 / 60");
});

for (const fail of [false, true]) {
 test(`A to B to A isolates old page ${fail ? "failure" : "success"} from a new request`, async ({ page }) => {
  await page.goto("/?fixture=delivery-downloads&count=110&paged&hold-pages");
  await page.getByRole("button", { name: "Show more", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "galleryFixture").heldPages)).toBe(1);
  await page.evaluate(() => Reflect.get(window, "galleryFixture").replace("b"));
  await page.evaluate(() => Reflect.get(window, "galleryFixture").replace("a"));
  await page.getByRole("button", { name: "Show more", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "galleryFixture").heldPages)).toBe(2);
  const selectAll = page.getByRole("button", { name: "select all", exact: true });
  await selectAll.focus();
  await page.evaluate((fail) => Reflect.get(window, "galleryFixture").releasePage(fail), fail);
  await expect(page.locator(".grid-cell")).toHaveCount(48);
  await expect(page.getByRole("button", { name: "Loading...", exact: true })).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(selectAll).toBeFocused();
  await page.evaluate(() => Reflect.get(window, "galleryFixture").releasePage());
  await expect(page.locator(".grid-cell")).toHaveCount(96);
  await expect(page.getByRole("button", { name: "View item 49 of 110", exact: true })).toBeFocused();
 });
}

test("a same-capability snapshot resets collection state and ignores old page work", async ({ page }) => {
 await page.goto("/?fixture=delivery-downloads&count=110&paged&hold-pages");
 await page.getByRole("button", { name: "Show more", exact: true }).click();
 await expect.poll(() => page.evaluate(() => Reflect.get(window, "galleryFixture").heldPages)).toBe(1);
 await page.evaluate(() => Reflect.get(window, "galleryFixture").refresh());
 const selectAll = page.getByRole("button", { name: "select all", exact: true });
 await selectAll.click();
 await page.evaluate(() => Reflect.get(window, "galleryFixture").releasePage(true));
 await expect(page.locator(".grid-cell")).toHaveCount(48);
 await expect(page.getByRole("alert")).toHaveCount(0);
 await expect(page.getByRole("button", { name: "download selected (110)", exact: true })).toBeEnabled();
 await expect(page.getByRole("button", { name: "Show more", exact: true })).toBeEnabled();
 await page.evaluate(() => Reflect.get(window, "galleryFixture").refresh());
 await expect(page.getByRole("button", { name: "download selected (0)", exact: true })).toBeDisabled();
});

test("a late Next cannot advance a lightbox closed and reopened at the same image", async ({ page }) => {
 await page.goto("/?fixture=delivery-downloads&count=110&paged&hold-pages");
 await page.getByRole("button", { name: "View item 48 of 110", exact: true }).click();
 await page.getByRole("button", { name: "Next image", exact: true }).click();
 await expect.poll(() => page.evaluate(() => Reflect.get(window, "galleryFixture").heldPages)).toBe(1);
 await page.getByRole("button", { name: "Close lightbox", exact: true }).click();
 await page.getByRole("button", { name: "View item 48 of 110", exact: true }).click();
 await page.evaluate(() => Reflect.get(window, "galleryFixture").releasePage());
 await expect(page.locator(".lightbox-counter")).toHaveText("48 / 110");
 await expect(page.getByRole("button", { name: "Close lightbox", exact: true })).toBeFocused();
});

for (const fail of [false, true]) {
 test(`A to B to A isolates old favorite ${fail ? "failure" : "success"} from a new mutation`, async ({ page }) => {
  await page.goto("/?fixture=delivery-downloads&hold-favorites");
  const favorite = page.locator(".grid-cell .fav-btn").first();
  await favorite.click();
  await expect(favorite).toBeDisabled();
  await page.evaluate(() => Reflect.get(window, "galleryFixture").replace("b"));
  await page.evaluate(() => Reflect.get(window, "galleryFixture").replace("a"));
  await favorite.click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "galleryFixture").heldFavorites)).toBe(2);
  await page.evaluate((fail) => Reflect.get(window, "galleryFixture").releaseFavorite(fail), fail);
  await expect(favorite).toBeDisabled();
  await expect(favorite).toHaveAttribute("aria-label", "Add to favorites");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.evaluate(() => Reflect.get(window, "galleryFixture").releaseFavorite());
  await expect(favorite).toBeEnabled();
  await expect(favorite).toHaveAttribute("aria-label", "Add to favorites");
 });
}

test("repeated Next while loading keeps the requested navigation", async ({ page }) => {
 await page.goto("/?fixture=delivery-downloads&count=110&paged&hold-pages");
 await page.getByRole("button", { name: "View item 48 of 110", exact: true }).click();
 const next = page.getByRole("button", { name: "Next image", exact: true });
 await next.click();
 await expect.poll(() => page.evaluate(() => Reflect.get(window, "galleryFixture").heldPages)).toBe(1);
 await next.click();
 await page.evaluate(() => Reflect.get(window, "galleryFixture").releasePage());
 await expect(page.locator(".lightbox-counter")).toHaveText("49 / 110");
});
