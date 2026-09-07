import { expect, test } from "@playwright/test";

for (const kind of ["page", "drawer"]) {
	test(`${kind} keeps long titles contained and quantity totals reactive`, async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(`/?fixture=cart-css&kind=${kind}&state=filled`);
		if (kind === "drawer") await page.getByRole("button", { name: "Open cart fixture" }).click();
		const rows = page.locator(".cart-line");
		await expect(rows).toHaveCount(2);
		await expect(rows.first().getByRole("button", { name: /^Remove/ })).toHaveText("remove");
		await expect(page.locator(".extra-images")).toHaveText("+1");
		const title = rows.first().getByRole("link");
		await expect(title).toHaveCSS("text-overflow", "ellipsis");
		await expect(title).toHaveCSS("overflow", "hidden");
		const widths = await title.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
		expect(widths.scroll).toBeGreaterThan(widths.client);
		await expect(page.locator(".subtotal-value")).toHaveText("$100.00");
		await rows.first().getByRole("button", { name: "Increase quantity" }).click();
		await expect(rows.first().locator(".quantity")).toHaveText("3");
		await expect(page.locator(".subtotal-value")).toHaveText("$125.00");
		await rows.first().getByRole("button", { name: "Decrease quantity" }).click();
		await expect(page.locator(".subtotal-value")).toHaveText("$100.00");
		await rows.last().getByRole("button", { name: /^Remove/ }).click();
		await expect(rows).toHaveCount(1);
		await expect(page.locator(".subtotal-value")).toHaveText("$50.00");
		await rows.first().getByRole("button", { name: /^Remove/ }).click();
		await expect(page.getByText("your cart is empty", { exact: true })).toBeVisible();
		await expect(page.getByRole("link", { name: /browse the shop/ })).toBeVisible();
	});

	test(`${kind} shows pending checkout and recovers from a failed request`, async ({ page }) => {
		let release = () => {};
		const pending = new Promise<void>((resolve) => { release = resolve; });
		let requests = 0;
		await page.route("**/api/cart/checkout", async (route) => {
			requests++;
			await pending;
			await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Fixture checkout failed. Try again." }) });
		});
		await page.goto(`/?fixture=cart-css&kind=${kind}&state=filled`);
		if (kind === "drawer") await page.getByRole("button", { name: "Open cart fixture" }).click();
		const checkout = page.getByRole("button", { name: "checkout", exact: true });
		await checkout.click();
		const processing = page.getByRole("button", { name: "processing...", exact: true });
		try {
			await expect(processing).toBeDisabled();
			await expect(processing).toHaveCSS("opacity", "0.5");
			await expect.poll(() => requests).toBe(1);
		} finally { release(); }
		await expect(checkout).toBeEnabled();
		await expect(page.getByText("Fixture checkout failed. Try again.")).toBeVisible();
		await expect(page.locator(".cart-line")).toHaveCount(2);
	});

	test(`${kind} dismisses an expired-cart notice`, async ({ page }) => {
		await page.addInitScript(() => localStorage.setItem("angelsrest:cart:v3", JSON.stringify({ items: [], updatedAt: "2020-01-01T00:00:00Z" })));
		await page.goto(`/?fixture=cart-css&kind=${kind}`);
		if (kind === "drawer") await page.getByRole("button", { name: "Open cart fixture" }).click();
		await expect(page.getByText(/we cleared your cart from a previous visit/)).toBeVisible();
		await page.getByRole("button", { name: /dismiss/i }).click();
		await expect(page.getByText(/we cleared your cart from a previous visit/)).toHaveCount(0);
		await expect(page.getByText("your cart is empty", { exact: true })).toBeVisible();
	});
}

test("cart page and drawer retain their 768px layout boundary", async ({ page }) => {
	await page.goto("/?fixture=cart-css&kind=page&state=filled");
	await page.setViewportSize({ width: 767, height: 900 });
	await expect(page.locator(".order-summary")).toHaveCSS("position", "static");
	await expect(page.locator(".thumbnail").first()).toHaveCSS("width", "80px");
	await page.setViewportSize({ width: 768, height: 900 });
	await expect(page.locator(".order-summary")).toHaveCSS("position", "sticky");
	await expect(page.locator(".thumbnail").first()).toHaveCSS("width", "96px");
	await page.goto("/?fixture=cart-css&kind=drawer");
	await page.getByRole("button", { name: "Open cart fixture" }).click();
	await expect(page.locator(".cart-sheet")).toHaveCSS("width", "400px");
	await expect(page.locator(".cart-sheet")).toHaveCSS("height", "900px");
	await page.setViewportSize({ width: 767, height: 900 });
	await expect(page.locator(".cart-sheet")).toHaveCSS("max-height", "765px");
	await expect(page.locator(".cart-sheet")).toHaveCSS("width", "767px");
});
