import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

// Known pre-existing failure, kept separate from the style checks.
assert.ok(
	!process.argv.includes("--without-workbench"),
	"Workbench styles are now shared. Use a baseline source checkout for the old-style comparison.",
);
const browser = await chromium.launch({ headless: true });
try {
	const page = await browser.newPage({ viewport: { width: 390, height: 1000 } });
	await page.goto(
		"http://127.0.0.1:5208/?route=/admin/editor/portfolio/demo-portfolio-1&theme=dark&period=morning&state=populated",
	);
	const doc = page.locator(".editor-workbench");
	await doc.waitFor();
	const names = page.locator(".image-list .image-summary strong");
	const originalNames = await names.allTextContents();
	await page.locator(".image-list .drag-handle").first().focus();
	await page.keyboard.press("Space");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("Space");
	assert.equal(
		await names.first().textContent(),
		originalNames[1],
		"Keyboard drag handle should reorder the first image",
	);
} finally {
	await browser.close();
}
