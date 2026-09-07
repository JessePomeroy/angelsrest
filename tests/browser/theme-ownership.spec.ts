import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const bootstrap = readFileSync(new URL("../../src/app.html", import.meta.url), "utf8")
	.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!bootstrap) throw new Error("Theme bootstrap missing");

test.beforeEach(async ({ page }) => {
	await page.route("**/*", async (route) => {
		if (new URL(route.request().url()).origin === "http://127.0.0.1:5196") await route.continue();
		else {
			await route.abort();
			throw new Error("Unexpected external request in theme fixture");
		}
	});
});

for (const deniedStorage of [false, true]) {
	test(`public and actual Admin controls share theme across remounts (${deniedStorage ? "denied" : "saved"} storage)`, async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.emulateMedia({ colorScheme: "light" });
		if (deniedStorage) await page.addInitScript(() => {
			Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Denied", "SecurityError"); } });
		});
		await page.goto("/?fixture=ownership");
		const light = page.getByRole("button", { name: "Light mode", exact: true });
		const dark = page.getByRole("button", { name: "Dark mode", exact: true });
		await expect(light).toHaveAttribute("aria-pressed", "true");
		await dark.click();
		await expect(page.locator("html")).toHaveClass(/dark/);
		await page.getByRole("button", { name: "Open Admin", exact: true }).click();
		expect(errors).toEqual([]);
		const menu = page.getByRole("button", { name: "Toggle menu", exact: true });
		if (await menu.isVisible()) await menu.click();
		await page.getByRole("button", { name: "switch to light mode", exact: true }).click();
		await expect(light).toHaveAttribute("aria-pressed", "true");
		await expect(page.locator("html")).not.toHaveClass(/dark/);
		await page.getByRole("button", { name: "Return to public", exact: true }).click();
		await dark.click();
		await page.getByRole("button", { name: "Open Admin", exact: true }).click();
		if (await menu.isVisible()) await menu.click();
		await expect(page.getByRole("button", { name: "switch to light mode", exact: true })).toBeVisible();
		await page.reload();
		await expect(deniedStorage ? light : dark).toHaveAttribute("aria-pressed", "true");
		expect(errors).toEqual([]);
	});
}

test("first-paint bootstrap survives denied storage and follows system mode", async ({ page }) => {
	await page.emulateMedia({ colorScheme: "dark" });
	await page.goto("/index.html");
	await page.evaluate(() => {
		Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Denied", "SecurityError"); } });
		document.documentElement.classList.remove("dark");
		delete document.documentElement.dataset.timePeriod;
	});
	await page.addScriptTag({ content: bootstrap });
	await expect(page.locator("html")).toHaveClass(/dark/);
	await expect(page.locator("html")).toHaveAttribute("data-time-period", /^(dawn|morning|afternoon|golden|evening|night)$/);
});


test("contact fields follow both themes without mutating document styles", async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(window, "turnstile", { value: {
			render: () => "fixture-widget",
			reset: () => {},
			remove: () => {},
		} });
	});
	await page.goto("/?fixture=contact");
	await expect(page.locator(".contact-field, .contact-submit")).toHaveCount(5);
	for (const [mode, color] of [["Light mode", "rgb(0, 0, 0)"], ["Dark mode", "rgb(250, 250, 250)"]]) {
		await page.getByRole("button", { name: mode, exact: true }).click();
		for (const field of await page.locator(".contact-field, .contact-submit").all()) {
			await expect(field).toHaveCSS("color", color);
		}
		expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--form-text-color"))).toBe("");
	}
});
