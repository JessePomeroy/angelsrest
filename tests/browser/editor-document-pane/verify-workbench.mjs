import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const browser = await chromium.launch({ headless: true });
const errors = [];
const rectanglesOverlap = (a, b) =>
	a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
let rendered = 0;
let interactions = 0;

async function open(route, width, theme, kind = "print") {
	const page = await browser.newPage({
		viewport: { width, height: 1000 },
		hasTouch: width < 768,
		reducedMotion: "reduce",
	});
	page.on("pageerror", (error) => errors.push(error.message));
	await page.route("**/*", (request) =>
		["GET", "HEAD"].includes(request.request().method()) ? request.continue() : request.abort(),
	);
	await page.goto(
		`http://127.0.0.1:5208/?route=/admin/editor/${route}&theme=${theme}&period=morning&state=populated&kind=${kind}`,
	);
	await page.locator(".editor-workbench").waitFor();
	await page.evaluate(() => document.fonts.ready);
	return page;
}

try {
	for (const theme of ["dark", "light"]) {
		for (const width of [390, 834, 1440]) {
			for (const route of ["portfolio/demo-portfolio-1", "products/demo-product-1"]) {
				const page = await open(route, width, theme);
				const doc = page.locator(".editor-workbench");
				assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
				const inputs = doc.locator('input:not([type="radio"]):not([type="file"]), textarea');
				for (const input of await inputs.all()) {
					const style = await input.evaluate((element) => {
						const s = getComputedStyle(element);
						return { size: s.fontSize, radius: s.borderRadius };
					});
					assert.equal(style.size, "16px");
					assert.equal(style.radius, "0px");
				}
				for (const group of await doc.locator(".money-input, .multiplier-input").all()) {
					const input = group.locator("input");
					await input.focus();
					const style = await input.evaluate((element) => {
						const inner = getComputedStyle(element);
						const outer = getComputedStyle(element.parentElement);
						return {
							border: inner.borderWidth,
							shadow: inner.boxShadow,
							outline: inner.outlineWidth,
							outerOutline: outer.outlineWidth,
						};
					});
					assert.equal(style.border, "0px", "Compound fields have one outer border");
					assert.equal(style.shadow, "none");
					assert.equal(style.outline, "0px", "Compound fields have one focus indicator");
					assert.equal(style.outerOutline, "2px");
				}
				for (const row of await doc.locator(".image-list > li").all()) {
					const image = await row.locator(".image-summary").boundingBox();
					const fields = await row.locator(".placement-fields").boundingBox();
					const actions = await row.locator(".actions").boundingBox();
					assert.ok(image && fields && actions);
					assert.ok(image.width >= 160, "Gallery previews retain a useful size");
					assert.equal(
						rectanglesOverlap(image, fields),
						false,
						"Image and fields must not overlap",
					);
					assert.equal(
						rectanglesOverlap(fields, actions),
						false,
						"Fields and remove action must not overlap",
					);
				}
				await inputs.first().focus();
				assert.equal(await inputs.first().evaluate((e) => getComputedStyle(e).outlineWidth), "2px");
				await page.close();
				rendered += 1;
			}
		}
	}
	for (const kind of ["print_set", "postcard", "merchandise", "tapestry", "digital_download"]) {
		const page = await open("products/demo-product-1", 390, "dark", kind);
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
		await page.close();
		rendered += 1;
	}
	for (const width of [390, 1440]) {
		const product = await open("products/demo-product-1", width, "dark");
		const price = product.getByRole("textbox", {
			name: "variant 1 retail price (USD)",
			exact: true,
		});
		await price.fill("58.25");
		await expect(product.locator(".save-state")).toHaveText("unsaved changes");
		const availability = product.locator(
			'.segmented-choice:has(input[name="catalog-sale-availability"])',
		);
		await availability.getByText("available", { exact: true }).click();
		await expect(availability.getByRole("radio", { name: "available", exact: true })).toBeChecked();
		await product.getByRole("button", { name: "save draft", exact: true }).click();
		await expect(
			product.getByRole("alert").filter({ hasText: "Simulated save failure" }),
		).toBeVisible();
		await expect(price).toHaveValue("58.25");
		await expect(product.getByRole("button", { name: "save draft", exact: true })).toBeEnabled();
		await product.close();
		interactions += 1;

		const gallery = await open("portfolio/demo-portfolio-1", width, "dark");
		const title = gallery.locator("#gallery-title");
		await title.fill("Window light, revised");
		await gallery.getByRole("button", { name: "save now", exact: true }).click();
		await expect(
			gallery.getByRole("alert").filter({ hasText: "Simulated save failure" }),
		).toBeVisible();
		await expect(title).toHaveValue("Window light, revised");
		const names = gallery.locator(".image-list .image-summary strong");
		const originalNames = await names.allTextContents();
		await gallery.locator(".image-list .remove").first().click();
		await expect(names).toHaveCount(originalNames.length - 1);
		await expect(names.first()).toHaveText(originalNames[1]);
		const chooseMedia = gallery.getByRole("button", { name: "choose from media", exact: true });
		await chooseMedia.click();
		await gallery.keyboard.press("Escape");
		await expect(chooseMedia).toBeFocused();
		await gallery.close();
		interactions += 1;
	}
	assert.deepEqual(errors, []);
	console.log(JSON.stringify({ rendered, interactions, pageErrors: errors, result: "PASS" }));
} finally {
	await browser.close();
}
