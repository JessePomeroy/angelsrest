import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
	await page.route("**/*", async route => {
		if (new URL(route.request().url()).origin === "http://127.0.0.1:5196") return route.continue();
		await route.abort();
		throw new Error("Unexpected external request in print fixture");
	});
});

for (const kind of ["product", "set"]) {
	test(`${kind} shows the same resolved price and finish summary in both purchase presentations`, async ({ page }) => {
		await page.goto(`/?fixture=print&kind=${kind}`);
		const summaries = page.locator(".desktop-selection, .mobile-selection");
		await expect(summaries).toHaveText(["Archival Matte · 8×10", "Archival Matte · 8×10"]);
		await page.getByLabel("Frame", { exact: true }).selectOption("0.875-black");
		const framed = 'Archival Matte · 8×10 · 0.25" border · 0.875" Black frame';
		await expect(summaries).toHaveText([framed, framed]);
		await expect(page.locator(".desktop-price")).toContainText("$45.08");
		await expect(page.locator(".mobile-price")).toHaveText("$45.08");
		await page.getByLabel("Material", { exact: true }).selectOption("canvas-black-0.75");
		const canvas = 'Canvas Black — 0.75" stretch · 16×20';
		await expect(summaries).toHaveText([canvas, canvas]);
		await expect(page.locator(".desktop-price")).toContainText("$80");
		await expect(page.locator(".mobile-price")).toHaveText("$80");
		await page.getByRole("button", { name: "empty", exact: true }).click();
		await expect(summaries).toHaveCount(0);
		await expect(page.getByText("Select paper & size", { exact: true })).toHaveCount(2);
	});

	test(`${kind} disables both checkout presentations while pending and recovers after failure`, async ({ page }) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		let release = () => {};
		const pending = new Promise<void>(resolve => { release = resolve; });
		let requests = 0;
		await page.route("**/api/checkout", async route => {
			requests++;
			await pending;
			await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Fixture checkout unavailable" }) });
		});
		await page.goto(`/?fixture=chrome&purchase=true&kind=${kind}`);
		await page.getByRole("button", { name: "buy now", exact: true }).filter({ visible: true }).click();
		await expect(page.locator(".desktop-buy-button")).toBeDisabled();
		await expect(page.locator(".desktop-buy-button")).toHaveText("processing...");
		await expect(page.locator(".mobile-buy-button")).toBeDisabled();
		await expect(page.locator(".mobile-buy-button")).toHaveText("...");
		await expect.poll(() => requests).toBe(1);
		release();
		await expect(page.getByRole("region", { name: "Notifications" }).getByRole("status")).toContainText("Fixture checkout unavailable");
		await expect(page.locator(".desktop-buy-button")).toBeEnabled();
		await expect(page.locator(".mobile-buy-button")).toBeEnabled();
		await expect(page.getByRole("button", { name: "buy now", exact: true }).filter({ visible: true })).toHaveCount(1);
		await expect(page.getByLabel("Cart payload")).toHaveText("[]");
		await page.getByRole("button", { name: "Dismiss notification" }).click();
		await page.getByRole("button", { name: "buy now", exact: true }).filter({ visible: true }).click();
		await expect.poll(() => requests).toBe(2);
		await expect(page.getByRole("region", { name: "Notifications" }).getByRole("status")).toContainText("Fixture checkout unavailable");
	});

	test(`${kind} normalizes finishes, canvas, unavailable sizes, and reused page data`, async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", error => errors.push(error.message));
		await page.goto(`/?fixture=print&kind=${kind}`);
		const material = page.getByLabel("Material", { exact: true });
		const size = page.getByLabel("Size", { exact: true });
		const border = page.getByLabel("Border", { exact: true });
		const frame = page.getByLabel("Frame", { exact: true });
		await expect(material).toHaveValue("archival-matte");
		await expect(size).toHaveValue("8x10");
		await border.selectOption("1");
		await frame.selectOption("0.875-black");
		await expect(border).toHaveValue("0.25");
		await expect(border).toBeDisabled();
		await size.selectOption("40x60");
		await expect(frame).toHaveValue("none");
		await expect(border).toBeEnabled();
		await size.selectOption("8x10");
		await frame.selectOption("0.875-black");
		await material.selectOption("canvas-black-0.75");
		await expect(size).toHaveValue("16x20");
		await expect(border).toHaveCount(0);
		await expect(frame).toHaveCount(0);
		await material.selectOption("archival-matte");
		await expect(frame).toHaveValue("none");
		await expect(border).toHaveValue("none");
		await frame.selectOption("0.875-black");
		await page.getByRole("button", { name: "no-frames", exact: true }).click();
		await expect(frame).toHaveCount(0);
		await expect(border).toBeEnabled();
		await page.getByRole("button", { name: "no-finishes", exact: true }).click();
		await expect(border).toHaveCount(0);
		await expect(frame).toHaveCount(0);
		await expect(page.getByRole("button", { name: "buy now", exact: true }).filter({ visible: true })).toBeEnabled();
		await page.getByRole("button", { name: "other", exact: true }).click();
		await expect(material).toHaveValue("glossy");
		await expect(size).toHaveValue("5x7");
		await page.getByRole("button", { name: "empty", exact: true }).click();
		await expect(material.locator("option")).toHaveCount(0);
		await expect(size.locator("option")).toHaveCount(0);
		await expect(page.getByRole("button", { name: "buy now", exact: true })).toHaveCount(0);
		await page.getByRole("button", { name: "original", exact: true }).click();
		await expect(material).toHaveValue("archival-matte");
		await expect(size).toHaveValue("8x10");
		await expect(border).toHaveValue("none");
		await page.getByRole("button", { name: "sold-out", exact: true }).click();
		await expect(page.getByRole("button", { name: "out of stock", exact: true }).filter({ visible: true })).toBeDisabled();
		await expect(page.getByRole("button", { name: "add to cart", exact: true })).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test(`${kind} retains page-specific cart and checkout selectors`, async ({ page }) => {
		let checkout: Record<string, unknown> | undefined;
		await page.route("**/api/checkout", async route => {
			expect(route.request().method()).toBe("POST");
			checkout = JSON.parse(route.request().postData() ?? "{}");
			await route.fulfill({ contentType: "application/json", body: JSON.stringify({ url: `${page.url()}#checkout` }) });
		});
		await page.goto(`/?fixture=print&kind=${kind}`);
		await page.getByLabel("Size", { exact: true }).selectOption("11x14");
		await page.getByLabel("Border", { exact: true }).selectOption("0.5");
		await page.getByRole("button", { name: "add to cart", exact: true }).filter({ visible: true }).click();
		const payload = JSON.parse(await page.getByLabel("Cart payload").textContent() ?? "[]");
		expect(payload).toHaveLength(1);
		expect(payload[0]).toMatchObject({
			productSlug: `fixture-${kind}-original`, type: kind === "set" ? "set" : "print",
			paperSlug: "archival-matte", sizeSlug: "11x14", borderWidthValue: "0.5", frameValue: "none",
			borderWidth: 0.5, unitPriceCents: 3500, quantity: 1,
		});
		if (kind === "set") expect(payload[0].imageUrls).toHaveLength(1);
		else expect(payload[0]).not.toHaveProperty("imageUrls");
		await page.getByRole("button", { name: "buy now", exact: true }).filter({ visible: true }).click();
		await expect(page).toHaveURL(/#checkout$/);
		expect(checkout).toEqual({
			productId: `fixture-${kind}-original`, coupon: null, isPrintSet: kind === "set",
			paperSlug: "archival-matte", sizeSlug: "11x14", borderWidth: "0.5", frame: "none",
		});
	});
}

test("two page instances have independent selectors and unique control labels", async ({ page }) => {
	await page.goto("/?fixture=print&kind=both");
	const product = page.getByRole("region", { name: "Product", exact: true });
	const set = page.getByRole("region", { name: "Print set", exact: true });
	await product.getByLabel("Material", { exact: true }).selectOption("canvas-black-0.75");
	await expect(set.getByLabel("Material", { exact: true })).toHaveValue("archival-matte");
	await expect(set.getByLabel("Size", { exact: true })).toHaveValue("8x10");
	await set.getByLabel("Border", { exact: true }).selectOption("1");
	await expect(product.getByLabel("Border", { exact: true })).toHaveCount(0);
	const ids = await page.locator("select").evaluateAll(elements => elements.map(element => element.id));
	expect(new Set(ids).size).toBe(ids.length);
});
