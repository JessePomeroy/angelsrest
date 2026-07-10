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

test("orders page preserves non-sensitive query params while stripping legacy email params", async ({
	page
}) => {
	await page.goto("/orders?source=receipt&email=buyer%40example.com&order=ORD-003&view=print");

	await expect(page).toHaveURL("/orders?source=receipt&order=ORD-003&view=print");
	await expect(page.getByLabel("Order Number")).toHaveValue("ORD-003");
	await expect(page.getByLabel("Email")).toHaveValue("");
});

test("orders page preserves duplicated and encoded non-sensitive query params", async ({ page }) => {
	await page.goto(
		"/orders?source=gift%20receipt&email=buyer%40example.com&tag=alpha&order=ORD-004&tag=beta&return=%2Fshop%2Fprints%3Fsort%3Dnew",
	);

	await expect(page).toHaveURL((url) => {
		expect(url.pathname).toBe("/orders");
		expect(url.searchParams.has("email")).toBe(false);
		expect(url.searchParams.get("source")).toBe("gift receipt");
		expect(url.searchParams.get("order")).toBe("ORD-004");
		expect(url.searchParams.getAll("tag")).toEqual(["alpha", "beta"]);
		expect(url.searchParams.get("return")).toBe("/shop/prints?sort=new");
		return true;
	});
	await expect(page.getByLabel("Order Number")).toHaveValue("ORD-004");
	await expect(page.getByLabel("Email")).toHaveValue("");
});
