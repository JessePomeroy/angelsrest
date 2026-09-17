import { expect, test } from "@playwright/test";
import { renderCustomerCommerceEmailHtml } from "../../src/lib/server/commerceEmailHtml";

const textureUrl = "https://email.example/receipt-paper.jpg";
const html = renderCustomerCommerceEmailHtml({
	kind: "shipment",
	brand: { siteName: "Test Studio", homeUrl: "https://example.com", receiptTextureUrl: textureUrl },
	orderNumber: "TEST-001",
	trackingNumber: "SYNTHETIC-TRACK-001",
	carrier: "Test carrier",
	statusUrl: "https://example.com/orders?order=TEST-001",
});

test("Gmail's body transformation leaves recolorable paper behind receipt text", async ({ page }) => {
	await page.route(textureUrl, (route) => route.abort());
	await page.setContent(html);
	// Gmail replaces the doctype with <u> and the body with a class-preserving div.
	// This tests that cascade, not Gmail's proprietary iOS color transformation.
	await page.evaluate(() => {
		const wrapper = document.createElement("div");
		wrapper.className = document.body.className;
		wrapper.append(...document.body.childNodes);
		document.body.replaceChildren(document.createElement("u"), wrapper);
	});

	const receipt = page.locator(".receipt-shell");
	await expect(receipt).toHaveCSS("background-image", "none");
	await expect(receipt).toHaveCSS("background-color", "rgb(245, 241, 231)");
	await expect(page.getByRole("heading", { name: "On its way." })).toBeVisible();
	await expect(page.getByRole("link", { name: "Track order", exact: true })).toHaveAttribute(
		"href",
		"https://example.com/orders?order=TEST-001",
	);
});

test("other clients retain the receipt texture and mobile layout", async ({ page }) => {
	await page.route(textureUrl, (route) => route.abort());
	await page.setContent(html);
	await expect(page.locator(".receipt-shell")).toHaveCSS("background-image", `url("${textureUrl}")`);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
		page.viewportSize()?.width ?? 0,
	);
});
