import assert from "node:assert/strict";
import { chromium, webkit } from "@playwright/test";

// Uses only the isolated fixture. No production host, session or mutation is accepted.
const engine = process.argv.includes("--webkit") ? webkit : chromium;
const browser = await engine.launch({ headless: true });
try {
	for (const width of [390, 1440]) {
		const page = await browser.newPage({
			viewport: { width, height: 1000 },
			hasTouch: width < 768,
		});
		await page.route("**/*", (route) =>
			["GET", "HEAD"].includes(route.request().method()) ? route.continue() : route.abort(),
		);
		await page.goto(
			"http://127.0.0.1:5208/?route=/admin/editor/products/demo-product-1&theme=dark&period=morning&state=populated",
		);
		const material = page.getByRole("combobox").first();
		if (width < 768) await material.tap();
		else await material.click();
		const glossy = page.getByRole("option", { name: "Glossy", exact: true });
		if (width < 768) await glossy.tap();
		else await glossy.click();
		assert.equal(
			(await material.textContent()).trim(),
			"Glossy",
			`Pointer selection must apply at ${width}px`,
		);
		assert.equal(await material.getAttribute("aria-expanded"), "false");
		assert.equal(await material.evaluate((element) => element === document.activeElement), true);
		await material.press("ArrowDown");
		await page.getByRole("option", { name: "Glossy", exact: true }).press("Home");
		await page.getByRole("option").first().press("Enter");
		assert.equal((await material.textContent()).trim(), "Archival Matte");
		await material.press("ArrowDown");
		await page.getByRole("option").first().press("Escape");
		assert.equal(await material.getAttribute("aria-expanded"), "false");
		assert.equal(await material.evaluate((element) => element === document.activeElement), true);
		await material.press("ArrowDown");
		await page.getByRole("option").first().press("Tab");
		assert.equal(await material.getAttribute("aria-expanded"), "false");
		await material.click();
		await page.locator(".editor-workbench h1").click();
		assert.equal(await material.getAttribute("aria-expanded"), "false");
		console.log(`PASS ${engine.name()} selection, Escape, Tab and outside click: ${width}px`);
		await page.close();
	}
} finally {
	await browser.close();
}
