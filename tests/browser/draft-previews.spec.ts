import { expect, test } from "@playwright/test";

test("private previews preserve the basket and disable contact, booking and purchase effects", async ({ page }, testInfo) => {
	const requests: string[] = [];
	const errors: string[] = [];
	page.on("pageerror", (cause) => errors.push(cause.message));
	page.on("request", (request) => {
		if (request.method() === "POST" || request.url().includes("challenges.cloudflare.com")) requests.push(request.url());
	});
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.addInitScript(() => localStorage.setItem("angelsrest:cart:v3", "existing-basket-sentinel"));
	await page.goto("/?fixture=content&kind=about&draftPreview=synthetic-private-grant");
	await expect(page.getByLabel("name", { exact: true })).toBeDisabled();
	await expect(page.getByRole("button", { name: "send message", exact: true })).toBeDisabled();
	await expect(page.getByRole("button", { name: "Book a session" })).toHaveCount(0);
	await expect(page.getByText("Sending is unavailable in draft previews.")).toBeVisible();
	for (const fixture of ["product-css", "print"]) {
		await page.goto(`/?fixture=${fixture}&draftPreview=synthetic-private-grant`);
		if (fixture === "product-css") await expect(page.locator(".category-badge")).toHaveText("Merchandise");
		const buy = page.getByRole("button", { name: "buy now", exact: true });
		await expect(buy.first()).toBeDisabled();
		for (const button of await page.getByRole("button", { name: "add to cart", exact: true }).all()) await expect(button).toBeDisabled();
		await expect(page.getByLabel("Cart payload")).toHaveText("[]");
	}
	await page.goto("/?fixture=chrome&draftPreview=synthetic-private-grant");
	await expect(page.getByRole("status", { name: "Draft preview" })).toBeInViewport();
	await expect(page.getByRole("link", { name: "Return to editor" })).toHaveAttribute("href", "/admin/editor");
	await page.screenshot({ path: testInfo.outputPath("draft-preview-chrome.png"), fullPage: true });
	expect(await page.evaluate(() => localStorage.getItem("angelsrest:cart:v3"))).toBe("existing-basket-sentinel");
	expect(requests).toEqual([]);
	expect(errors).toEqual([]);
});
