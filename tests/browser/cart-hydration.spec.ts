import { expect, test } from "@playwright/test";

const storageKey = "angelsrest:cart:v3";
const savedItem = {
	id: "saved-print",
	productSlug: "saved-print",
	type: "print",
	title: "Saved print",
	imageUrl: "",
	quantity: 2,
	unitPriceCents: 2500,
};

for (const kind of ["page", "drawer"]) {
	test(`${kind} resets malformed persisted entries without a rendering error`, async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.addInitScript(({ key }) => {
			localStorage.setItem(key, JSON.stringify({ items: [null], updatedAt: new Date().toISOString() }));
		}, { key: storageKey });
		await page.goto(`/?fixture=cart-css&kind=${kind}`);
		if (kind === "drawer") await page.getByRole("button", { name: "Open cart fixture" }).click();
		await expect(page.getByText("your cart is empty", { exact: true })).toBeVisible();
		await expect(page.locator(".expiry-notice")).toHaveCount(0);
		expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).items, storageKey)).toEqual([]);
		expect(errors).toEqual([]);
	});

	test(`${kind} hydrates valid saved items and persists later quantity changes`, async ({ page }) => {
		await page.addInitScript(({ key, item }) => {
			localStorage.setItem(key, JSON.stringify({ items: [item], updatedAt: new Date().toISOString() }));
		}, { key: storageKey, item: savedItem });
		await page.goto(`/?fixture=cart-css&kind=${kind}`);
		if (kind === "drawer") await page.getByRole("button", { name: "Open cart fixture" }).click();
		await expect(page.getByRole("link", { name: "Saved print" })).toBeVisible();
		await expect(page.locator(".subtotal-value")).toHaveText("$50.00");
		await page.getByRole("button", { name: "Increase quantity" }).click();
		await expect(page.locator(".subtotal-value")).toHaveText("$75.00");
		expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).items[0].quantity, storageKey)).toBe(3);
	});
}

test("resets invalid timestamps and duplicate IDs before keyed rendering", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	for (const state of [
		{ items: [savedItem], updatedAt: "invalid" },
		{ items: [savedItem, savedItem], updatedAt: new Date().toISOString() },
	]) {
		await page.goto("/?fixture=cart-css&kind=page");
		await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: storageKey, value: state });
		await page.reload();
		await expect(page.getByText("your cart is empty", { exact: true })).toBeVisible();
	}
	expect(errors).toEqual([]);
});

test("keeps cart mutations working in memory when storage access is denied", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.addInitScript((key) => {
		const getItem = Storage.prototype.getItem;
		const setItem = Storage.prototype.setItem;
		Storage.prototype.getItem = function (name) {
			if (name === key) throw new DOMException("Storage denied", "SecurityError");
			return getItem.call(this, name);
		};
		Storage.prototype.setItem = function (name, value) {
			if (name === key) throw new DOMException("Storage denied", "SecurityError");
			return setItem.call(this, name, value);
		};
	}, storageKey);
	await page.goto("/?fixture=cart-css&kind=page&state=filled");
	await expect(page.locator(".cart-line")).toHaveCount(2);
	await expect(page.locator(".subtotal-value")).toHaveText("$100.00");
	await page.getByRole("button", { name: "Increase quantity" }).first().click();
	await expect(page.locator(".subtotal-value")).toHaveText("$125.00");
	await page.getByRole("button", { name: /^Remove/ }).last().click();
	await expect(page.locator(".cart-line")).toHaveCount(1);
	expect(errors).toEqual([]);
});
