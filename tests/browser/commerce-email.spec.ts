import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
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

async function loadReceipt(page: Page, gmail: boolean, inverted: boolean, blockedImage = false) {
	// A deterministic pale image stands in for the public paper texture.
	const paper = await sharp({ create: { width: 1, height: 1, channels: 3, background: "#f5f1e7" } })
		.png()
		.toBuffer();
	await page.route(textureUrl, (route) =>
		blockedImage ? route.abort() : route.fulfill({ contentType: "image/png", body: paper }),
	);
	await page.setContent(html);
	if (!gmail) return;
	await page.evaluate((invert) => {
		const wrapper = document.createElement("div");
		wrapper.className = document.body.className;
		wrapper.append(...document.body.childNodes);
		document.body.replaceChildren(document.createElement("u"), wrapper);
		if (!invert) return;
		// Replay the documented full color inversion while preserving images/gradients.
		// This tests blend compositing, not Gmail's proprietary native implementation.
		for (const style of document.querySelectorAll("style")) {
			style.textContent =
				style.textContent?.replace(/#000|#fff/g, (value) => (value === "#000" ? "#fff" : "#000")) ??
				"";
		}
		for (const element of document.querySelectorAll<HTMLElement>("[style]")) {
			if (element.style.color) element.style.color = "#fff";
			if (element.style.backgroundColor) element.style.backgroundColor = "#262521";
		}
	}, inverted);
}

for (const blockedImage of [false, true]) {
	for (const inverted of [false, true]) {
		test(`Gmail blend ${inverted ? "inverted" : "light"} keeps dark ink on light paper (${blockedImage ? "blocked" : "loaded"} texture)`, async ({
			page,
		}) => {
			await loadReceipt(page, true, inverted, blockedImage);
			await expect(page.locator(".receipt-shell")).toHaveCSS(
				"background-image",
				`url("${textureUrl}"), linear-gradient(rgb(245, 241, 231), rgb(245, 241, 231))`,
			);
			const heading = page.getByRole("heading", { name: "On its way." });
			await expect(heading).toHaveCSS("font-family", /Menlo/);
			const { data, info } = await sharp(await heading.screenshot())
				.removeAlpha()
				.raw()
				.toBuffer({ resolveWithObject: true });
			let dark = 0;
			let paper = 0;
			for (let i = 0; i < data.length; i += info.channels) {
				if (data[i] < 80 && data[i + 1] < 80 && data[i + 2] < 80) dark++;
				if (data[i] > 220 && data[i + 1] > 220 && data[i + 2] > 210) paper++;
			}
			expect(dark, "visible dark heading glyphs").toBeGreaterThan(50);
			expect(paper, "light paper remains behind heading").toBeGreaterThan(500);
			const button = page.getByRole("link", { name: "Track order", exact: true });
			const buttonPixels = await sharp(await button.screenshot())
				.removeAlpha()
				.raw()
				.toBuffer({ resolveWithObject: true });
			let lightButtonInk = 0;
			let darkButtonPaper = 0;
			for (let i = 0; i < buttonPixels.data.length; i += buttonPixels.info.channels) {
				const [r, g, b] = buttonPixels.data.subarray(i, i + 3);
				if (r > 220 && g > 220 && b > 210) lightButtonInk++;
				if (r < 80 && g < 80 && b < 80) darkButtonPaper++;
			}
			expect(lightButtonInk, "visible light button glyphs").toBeGreaterThan(30);
			expect(darkButtonPaper, "dark button background").toBeGreaterThan(500);
			await expect(page.getByRole("link", { name: "Track order", exact: true })).toHaveAttribute(
				"href",
				"https://example.com/orders?order=TEST-001",
			);
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
				page.viewportSize()?.width ?? 0,
			);
		});
	}
}

test("other clients retain the texture, normal text colors, and mobile layout", async ({
	page,
}) => {
	await loadReceipt(page, false, false);
	await expect(page.locator(".receipt-shell")).toHaveCSS(
		"background-image",
		`url("${textureUrl}"), linear-gradient(rgb(245, 241, 231), rgb(245, 241, 231))`,
	);
	await expect(page.getByRole("heading", { name: "On its way." })).toHaveCSS(
		"color",
		"rgb(38, 37, 33)",
	);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
		page.viewportSize()?.width ?? 0,
	);
});

test("every visible customer receipt text node has protection, including links and items", async ({
	page,
}) => {
	const brand = {
		siteName: "Test Studio",
		homeUrl: "https://example.com",
		receiptTextureUrl: textureUrl,
	};
	const commonOrder = {
		kind: "order_confirmation" as const,
		brand,
		customerName: "Synthetic Buyer",
		orderId: "TEST-1",
		total: "$30.00",
		items: [
			{ description: "Synthetic print", quantity: "1", unitPrice: "$30.00", total: "$30.00" },
		],
	};
	const documents = [
		html,
		renderCustomerCommerceEmailHtml({
			...commonOrder,
			delivery: {
				kind: "physical",
				shippingAddress: "Synthetic Buyer\nTest address",
				statusUrl: "https://example.com/orders",
			},
		}),
		renderCustomerCommerceEmailHtml({
			...commonOrder,
			items: [],
			delivery: { kind: "digital", downloadUrl: "https://example.com/download" },
		}),
		renderCustomerCommerceEmailHtml({
			kind: "refund_issued",
			brand,
			orderNumber: "TEST-1",
			refundId: "TEST-REFUND",
			total: "$30.00",
		}),
		renderCustomerCommerceEmailHtml({
			kind: "payment_failed",
			brand,
			reason: "Synthetic failure",
			shopUrl: "https://example.com/shop",
		}),
	];
	await page.route(textureUrl, (route) => route.abort());
	for (const document of documents) {
		await page.setContent(document);
		const unprotected = await page.locator(".receipt-shell").evaluate((shell) => {
			const walker = shell.ownerDocument.createTreeWalker(shell, NodeFilter.SHOW_TEXT);
			const missing: string[] = [];
			while (walker.nextNode()) {
				if (
					walker.currentNode.textContent?.trim() &&
					!walker.currentNode.parentElement?.closest(".ri > .rd, .rl > .rd")
				) {
					missing.push(walker.currentNode.textContent);
				}
			}
			return missing;
		});
		expect(unprotected).toEqual([]);
	}
});
