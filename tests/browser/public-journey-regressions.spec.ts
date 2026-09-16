import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
	page.on("pageerror", error => { throw error; });
});

for (const kind of ["product", "set"]) {
	test(`${kind} restores the selected configuration after reload`, async ({ page }) => {
		await page.goto(`/?fixture=print&kind=${kind}`);
		await page.getByLabel("Size", { exact: true }).selectOption("11x14");
		await page.getByLabel("Frame", { exact: true }).selectOption("1.25-oak");
		await expect(page).toHaveURL(/frame=1.25-oak/);
		await page.reload();
		await expect(page.getByLabel("Size", { exact: true })).toHaveValue("11x14");
		await expect(page.getByLabel("Frame", { exact: true })).toHaveValue("1.25-oak");
		await expect(page.getByLabel("Border", { exact: true })).toHaveValue("0.25");
	});

	test(`${kind} normalizes unavailable URL choices before purchase`, async ({ page }) => {
		await page.goto(`/?fixture=print&kind=${kind}&paper=invalid&size=invalid&frame=invalid&border=invalid`);
		await expect(page.getByLabel("Material", { exact: true })).toHaveValue("archival-matte");
		await expect(page.getByLabel("Size", { exact: true })).toHaveValue("8x10");
		await expect(page.getByLabel("Frame", { exact: true })).toHaveValue("none");
		await expect(page.getByLabel("Border", { exact: true })).toHaveValue("none");
	});

	test(`${kind} reports a full cart line without an addition animation or drawer`, async ({ page }) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.goto(`/?fixture=chrome&purchase=true&kind=${kind}`);
		await page.getByRole("button", { name: "add to cart", exact: true }).filter({ visible: true }).click();
		const cart = page.getByRole("dialog", { name: "Shopping cart" });
		await expect(cart).toBeVisible();
		const increase = cart.getByRole("button", { name: "Increase quantity", exact: true });
		for (let count = 1; count < 20; count++) await increase.click();
		await expect(increase).toBeDisabled();
		await expect(cart.getByRole("status")).toHaveText("Limit of 20 per item reached");
		await cart.getByRole("button", { name: "Close cart" }).click();
		await expect(cart).toHaveCount(0);
		await page.getByRole("button", { name: "add to cart", exact: true }).filter({ visible: true }).click();
		await expect(page.getByRole("region", { name: "Notifications" }).getByRole("status")).toContainText("Nothing was added.");
		await expect(cart).toHaveCount(0);
		const payload = JSON.parse(await page.getByLabel("Cart payload").textContent() ?? "[]");
		expect(payload[0].quantity).toBe(20);
	});
}

for (const kind of ["page", "drawer"]) {
	test(`${kind} distinguishes equal-price frames and preserves configuration in review links`, async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem("angelsrest:cart:v3", JSON.stringify({
				updatedAt: new Date().toISOString(),
				items: ["oak", "white"].map((color, index) => ({
					id: `fictional-${color}`, productSlug: "fictional-print", type: "print", title: "Quiet estuary",
					imageUrl: "", paperName: "Archival Matte", paperSlug: "archival-matte", sizeSlug: "8x10",
					paperWidth: 8, paperHeight: 10, borderWidth: 0.25, borderWidthValue: "0.25",
					frameValue: `1.25-${color}`, frameSubcategoryId: 100 + index, quantity: 1, unitPriceCents: 4500,
				})),
			}));
		});
		await page.goto(`/?fixture=cart-css&kind=${kind}`);
		if (kind === "drawer") await page.getByRole("button", { name: "Open cart fixture" }).click();
		const rows = page.locator(".cart-line");
		await expect(rows.nth(0).locator(".print-details")).toContainText('1.25" Oak');
		await expect(rows.nth(1).locator(".print-details")).toContainText('1.25" White');
		for (const [index, color] of ["oak", "white"].entries()) {
			await expect(rows.nth(index).getByRole("link")).toHaveAttribute("href", `/shop/fictional-print?paper=archival-matte&size=8x10&border=0.25&frame=1.25-${color}`);
			const details = await rows.nth(index).locator(".print-details").evaluate(element => ({
				width: element.clientWidth, scrollWidth: element.scrollWidth,
				height: element.clientHeight, scrollHeight: element.scrollHeight,
			}));
			expect(details.scrollWidth).toBeLessThanOrEqual(details.width);
			expect(details.scrollHeight).toBeLessThanOrEqual(details.height);
		}
		const target = await rows.first().getByRole("button", { name: "Increase quantity" }).boundingBox();
		expect(target?.width).toBeGreaterThanOrEqual(44);
		expect(target?.height).toBeGreaterThanOrEqual(44);
	});
}

test("desktop navigation exposes the current section", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.goto("/?fixture=chrome&purchase=true");
	await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Shop", exact: true })).toHaveAttribute("aria-current", "page");
});

test("slow navigation announces progress and clears it when finished", async ({ page }) => {
	await page.goto("/?fixture=chrome");
	await expect(page.locator(".navigation-status")).toBeEmpty();
	await page.getByRole("button", { name: "Start pending navigation" }).click();
	await expect(page.getByRole("main")).toHaveAttribute("aria-busy", "true");
	await expect(page.locator(".navigation-status")).toHaveText("Loading page…");
	await page.getByRole("button", { name: "Finish pending navigation" }).click();
	await expect(page.locator(".navigation-status")).toBeEmpty();
	await expect(page.getByRole("main")).toHaveAttribute("aria-busy", "false");
	await page.getByRole("button", { name: "Start pending navigation" }).click();
	await page.getByRole("button", { name: "Finish pending navigation" }).click();
	await page.waitForTimeout(350);
	await expect(page.locator(".navigation-status")).toBeEmpty();
});

test("portfolio controls include descriptions and lightbox arrows have 44px targets", async ({ page }) => {
	await page.goto("/?fixture=content&kind=portfolio-page");
	await page.getByRole("button", { name: "View image 1: First portfolio image", exact: true }).click();
	const lightbox = page.getByRole("dialog");
	await expect(lightbox.getByRole("img")).toHaveAttribute("alt", "First portfolio image");
	for (const name of ["Previous image", "Next image"]) {
		const target = await lightbox.getByRole("button", { name }).boundingBox();
		expect(target?.width).toBeGreaterThanOrEqual(44);
		expect(target?.height).toBeGreaterThanOrEqual(44);
	}
	await lightbox.getByRole("button", { name: "Next image" }).click();
	await expect(lightbox.getByRole("img")).toHaveAttribute("alt", "Second portfolio image");
});

test("closing mobile navigation by its backdrop restores the trigger", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.goto("/?fixture=chrome");
	const trigger = page.locator(".sphere");
	await trigger.focus();
	await trigger.press("Enter");
	await expect(trigger).toHaveAttribute("aria-expanded", "true");
	await page.locator(".dismiss").click({ position: { x: 15, y: 15 } });
	await expect(trigger).toHaveAttribute("aria-expanded", "false");
	await page.waitForTimeout(500);
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	await expect(trigger).toBeFocused();
});

test("removing the last mobile cart item keeps focus usable inside and after the drawer", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/?fixture=chrome&populated=true");
	const opener = page.locator(".cart-pill");
	await opener.focus();
	await opener.press("Enter");
	const cart = page.getByRole("dialog", { name: "Shopping cart" });
	await cart.getByRole("button", { name: "Remove Fixture print" }).click();
	await expect(cart.getByRole("link", { name: "browse the shop" })).toBeFocused();
	await expect(opener).toHaveCount(0);
	await cart.getByRole("button", { name: "Close cart" }).click();
	await expect(cart).toHaveCount(0);
	await page.waitForTimeout(500);
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	await expect(page.getByRole("main")).toBeFocused();
});
