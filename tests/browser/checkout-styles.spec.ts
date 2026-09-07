import { expect, test } from "@playwright/test";

test("shared confirmation keeps verification fields and native POST submission", async ({ page }) => {
	await page.goto("/?fixture=checkout-css&kind=error");
	await expect(page.getByRole("alert")).toHaveText("That email does not match this order.");
	await expect(page.getByText("buyer@example.invalid", { exact: true })).toHaveCount(0);
	const email = page.getByRole("textbox", { name: "email used at checkout" });
	await expect(email).toHaveAttribute("required", "");
	await expect(email).toHaveAttribute("autocomplete", "email");
	await email.fill("not-an-email");
	expect(await email.evaluate((element) => element instanceof HTMLInputElement && element.checkValidity())).toBe(false);
	await email.fill("buyer@example.invalid");
	await page.route("**/*", async (route) => {
		if (route.request().method() === "POST") await route.fulfill({ contentType: "text/html", body: "<p>Fixture received</p>" });
		else await route.continue();
	});
	const submitted = page.waitForRequest((request) => request.method() === "POST");
	await page.getByRole("button", { name: "verify order" }).click();
	const request = await submitted;
	expect(new URL(request.url()).search).toBe("?/verify&session_id=cs_fixture");
	const body = new URLSearchParams(request.postData() ?? "");
	expect(body.get("email")).toBe("buyer@example.invalid");
	expect(body.get("session_id")).toBe("cs_fixture");
});

test("confirmation handles physical, digital and missing details", async ({ page }) => {
	await page.goto("/?fixture=checkout-css&kind=physical");
	await expect(page.getByText("Fixture Buyer", { exact: true })).toBeVisible();
	await expect(page.getByText("Studio 2", { exact: true })).toBeVisible();
	await expect(page.getByText("$75.00", { exact: true })).toBeVisible();
	await expect(page.getByRole("link", { name: "download now" })).toHaveCount(0);
	await page.goto("/?fixture=checkout-css&kind=digital");
	await expect(page.getByText("Fixture Buyer", { exact: true })).toHaveCount(0);
	await expect(page.getByRole("link", { name: "download now" })).toHaveAttribute("href", "/api/download?session_id=cs_fixture&slug=fixture-print&item=0");
	await page.goto("/?fixture=checkout-css&kind=shared-no-session");
	await expect(page.getByRole("link", { name: "/orders" })).toHaveAttribute("href", "/orders");
	await expect(page.getByRole("button", { name: "verify order" })).toHaveCount(0);
	await page.goto("/?fixture=checkout-css&kind=basic");
	await expect(page.getByRole("heading", { name: "Thank you for your order!" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Order Details" })).toHaveCount(0);
});

test("cancel action remains keyboard-accessible in both themes", async ({ page }) => {
	await page.emulateMedia({ colorScheme: "light" });
	await page.goto("/?fixture=checkout-css&kind=cancel");
	const link = page.getByRole("link", { name: "Back to Shop" });
	await expect(link).toHaveAttribute("href", "/shop");
	await page.keyboard.press("Tab");
	await expect(link).toBeFocused();
	await expect(link).toHaveCSS("outline-width", "2px");
	await expect(link).toHaveCSS("outline-offset", "2px");
	const light = await link.evaluate((element) => getComputedStyle(element).outlineColor);
	await page.evaluate(() => document.documentElement.classList.add("dark"));
	await expect.poll(() => link.evaluate((element) => getComputedStyle(element).outlineColor)).not.toBe(light);
	await expect(link).toBeFocused();
});
