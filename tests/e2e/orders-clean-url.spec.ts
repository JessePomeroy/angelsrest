import { expect, test } from "@playwright/test";

test("orders page strips legacy email query params in the browser", async ({ page }) => {
	await page.goto("/orders?email=buyer%40example.com&order=ORD-001");

	await expect(page).toHaveURL("/orders?order=ORD-001");
	await expect(page.getByLabel("Order Number")).toHaveValue("ORD-001");
	await expect(page.getByLabel("Email")).toHaveValue("");
});

test("orders page strips duplicated legacy email query params in the browser", async ({ page }) => {
	await page.goto("/orders?email=&email=buyer%40example.com&order=ORD-002");

	await expect(page).toHaveURL("/orders?order=ORD-002");
	await expect(page.getByLabel("Order Number")).toHaveValue("ORD-002");
	await expect(page.getByLabel("Email")).toHaveValue("");
});
