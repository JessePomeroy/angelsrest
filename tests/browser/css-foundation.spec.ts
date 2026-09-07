import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const reset = readFileSync(new URL("../../src/lib/styles/reset.css", import.meta.url), "utf8");
const theme = readFileSync(new URL("../../src/lib/styles/theme.css", import.meta.url), "utf8");

test("native CSS foundation works without Tailwind compilation", async ({ page }) => {
	await page.setContent(`
		<style>${reset}\n${theme}</style>
		<section style="font-family: monospace; font-size: 20px; color: rgb(20, 30, 40)">
			<button>Native button</button><input aria-label="Native input" placeholder="Name">
			<select aria-label="Native select"><option>One</option></select>
			<textarea aria-label="Native text"></textarea>
		</section>
		<div id="box" style="width: 100px; padding: 10px; border: 2px solid">Box</div>
		<div id="hidden" hidden>Hidden</div>
		<svg aria-label="Icon" width="20" height="20"></svg>
		<table><tbody><tr><td>Cell</td></tr></tbody></table>
		<p id="sample" style="color: var(--color-surface-950); font-size: var(--text-sm); line-height: var(--text-sm--line-height)">Sample</p>
	`);
	await expect(page.locator("body")).toHaveCSS("margin", "0px");
	await expect(page.locator("#box")).toHaveCSS("width", "100px");
	await expect(page.locator("#box")).toHaveCSS("box-sizing", "border-box");
	await expect(page.locator("#hidden")).toBeHidden();
	await expect(page.locator("svg")).toHaveCSS("display", "block");
	await expect(page.locator("table")).toHaveCSS("border-collapse", "collapse");
	for (const control of await page.locator("button, input, select, textarea").all()) {
		await expect(control).toHaveCSS("font-family", "monospace");
		await expect(control).toHaveCSS("font-size", "20px");
		await expect(control).toHaveCSS("color", "rgb(20, 30, 40)");
		await expect(control).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
	}
	await expect(page.getByLabel("Native text")).toHaveCSS("resize", "vertical");
	await expect(page.locator("#sample")).toHaveCSS("color", "oklch(0.3191 0.04 266.95)");
	await expect(page.locator("#sample")).toHaveCSS("font-size", "14.938px");
});
