import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";

const captures = await mkdtemp(join(tmpdir(), "admin-workbench-verified-"));
console.log(`Captures: ${captures}`);
const operations = [
	"/admin", "/admin/orders", "/admin/inquiries", "/admin/crm", "/admin/board",
	"/admin/invoicing", "/admin/quotes", "/admin/contracts", "/admin/emails",
	"/admin/messages", "/admin/platform", "/admin/galleries",
];
const editors = [
	"/admin/editor", "/admin/editor/pages", "/admin/editor/pages/about",
	"/admin/editor/pages/contact", "/admin/editor/portfolio",
	"/admin/editor/portfolio/demo-portfolio-1", "/admin/editor/products",
	"/admin/editor/products/demo-product-1", "/admin/editor/blog",
	"/admin/editor/blog/posts/demo-post-1", "/admin/editor/blog/authors/demo-author-1",
	"/admin/editor/blog/categories/demo-category-1",
];
const browser = await chromium.launch({ headless: true });
const errors = [];
const cases = [];
let interactions = 0;

async function open(page, route, theme, state = "populated", extras = "") {
	await page.goto(`http://127.0.0.1:5208/?route=${route}&theme=${theme}&period=morning&state=${state}${extras}`);
	await page.locator("[data-admin]").waitFor();
	await page.evaluate(() => document.fonts.ready);
}

async function checkFields(root) {
	const fields = root.locator('input:not([type="file"]):not([type="radio"]):not([type="checkbox"]):not([type="hidden"]):not([type="color"]):not([type="range"]), textarea, select');
	for (const field of await fields.all()) {
		if (!await field.isVisible()) continue;
		const style = await field.evaluate((element) => {
			const s = getComputedStyle(element);
			return { size: s.fontSize, radius: s.borderRadius, height: element.getBoundingClientRect().height, compound: element.parentElement.matches(".money-input, .multiplier-input") };
		});
		assert.equal(style.size, "16px", `Readable field: ${await field.getAttribute("class")}`);
		assert.equal(style.radius, "0px", `Square field: ${await field.getAttribute("class")}`);
		assert.ok(style.height >= (style.compound ? 46 : 48), `Comfortable field: ${JSON.stringify(style)}`);
	}
}

try {
	for (const theme of process.argv.includes("--interactions-only") ? [] : ["dark", "light"]) {
		for (const width of [390, 834, 1440]) {
			const context = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: width < 768, reducedMotion: "reduce", timezoneId: "America/Detroit" });
			const page = await context.newPage();
			page.on("pageerror", (error) => errors.push(error.message));
			await page.route("**/*", (request) => ["GET", "HEAD"].includes(request.request().method()) ? request.continue() : request.abort());
			await page.clock.setFixedTime(new Date("2026-09-15T13:00:00Z"));
			for (const route of [...operations, ...editors]) {
				await open(page, route, theme);
				await page.locator(".admin-main").waitFor();
				assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `${route} ${width} ${theme} root overflow`);
				await checkFields(page.locator(".admin-main"));
				if (operations.includes(route) && width !== 834) {
					await page.screenshot({ path: join(captures, `${route.replaceAll("/", "-")}-${width}-${theme}.png`) });
				}
				cases.push({ route, width, theme, state: "populated" });
			}
			await open(page, "/admin", theme, "populated", "&screen=login");
			await checkFields(page.locator(".login-page"));
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
			cases.push({ route: "login", width, theme, state: "populated" });
			console.log(`Rendered ${theme} ${width}: 24 routes + login`);
			await context.close();
		}
	}

	for (const width of [390, 1440]) {
		const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: "reduce", timezoneId: "America/Detroit" });
		page.on("pageerror", (error) => errors.push(error.message));
		await page.route("**/*", (request) => ["GET", "HEAD"].includes(request.request().method()) ? request.continue() : request.abort());
		await page.clock.setFixedTime(new Date("2026-09-15T13:00:00Z"));
		for (const [route, state, selector] of [
			["/admin/crm", "empty", ".empty-state"],
			["/admin/crm", "error", '[role="alert"]'],
			["/admin/invoicing", "loading", ".loading-state"],
			["/admin/galleries", "empty", ".empty-state"],
		]) {
			await open(page, route, "dark", state);
			await expect(page.locator(selector).first()).toBeVisible();
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
			cases.push({ route, width, theme: "dark", state });
		}
		for (const [route, label] of [
			["/admin/crm", "add client"], ["/admin/invoicing", "new invoice"],
			["/admin/quotes", "new quote"], ["/admin/contracts", "new contract"],
			["/admin/emails", "new template"], ["/admin/galleries", "+ new gallery"],
		]) {
			console.log(`Checking ${label} dialog at ${width}`);
			await open(page, route, "dark");
			const trigger = page.getByRole("button", { name: label, exact: true });
			await trigger.click();
			const dialog = page.getByRole("dialog").last();
			await expect(dialog).toBeVisible();
			await checkFields(dialog);
			const containment = await dialog.locator(".modal-content").evaluate((e) => ({ scroll: e.scrollWidth, client: e.clientWidth, width: e.getBoundingClientRect().width }));
			assert.ok(containment.scroll <= containment.client + 1, `${label}: dialog contents overflow`);
			assert.ok(containment.width <= width);
			await page.screenshot({ path: join(captures, `${route.replaceAll("/", "-")}-create-${width}-dark.png`) });
			await page.keyboard.press("Tab");
			assert.ok(await dialog.evaluate((e) => e.contains(document.activeElement)), "Keyboard focus stays in dialog");
			await page.keyboard.press("Escape");
			await expect(dialog).not.toBeVisible();
			await expect(trigger).toBeFocused();
			interactions += 1;
		}

		await open(page, "/admin/crm", "light");
		const search = page.locator(".filter-search");
		await search.fill("no matching fictional client");
		await expect(page.locator(".data-table tbody tr")).toHaveCount(0);
		await search.fill("");
		await expect(page.locator(".data-table tbody tr").first()).toBeVisible();
		interactions += 1;
		await page.getByRole("button", { name: "add client", exact: true }).click();
		await expect(page.getByRole("button", { name: "save client", exact: true })).toBeDisabled();
		await page.locator("#add-name").fill("Disposable client draft");
		await page.getByRole("button", { name: "save client", exact: true }).click();
		await expect(page.getByText("Failed to create client. Please try again.", { exact: true })).toBeVisible();
		await expect(page.locator("#add-name")).toHaveValue("Disposable client draft");
		await expect(page.getByRole("dialog")).toBeVisible();
		interactions += 1;

		await open(page, "/admin/quotes", "light");
		const presets = page.getByRole("tab", { name: "presets", exact: true });
		await presets.click();
		await expect(presets).toHaveAttribute("aria-selected", "true");
		assert.equal(await presets.evaluate((e) => getComputedStyle(e).borderWidth), "0px");
		assert.notEqual(await presets.evaluate((e) => getComputedStyle(e).backgroundColor), "rgba(0, 0, 0, 0)");
		interactions += 1;

		await open(page, "/admin/messages", "dark");
		await page.locator(".thread-item").first().click();
		await expect(page.locator(".message-field")).toBeVisible();
		await page.locator(".message-field").fill("Disposable preview draft");
		await expect(page.locator(".send-btn")).toBeEnabled();
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
		await page.screenshot({ path: join(captures, `conversation-${width}-dark.png`) });
		if (width === 390) {
			await page.locator(".back-btn").click();
			await expect(page.locator(".thread-list")).toBeVisible();
		}
		interactions += 1;
		await open(page, "/admin", "light", "populated", "&screen=login");
		await page.getByRole("textbox", { name: "email", exact: true }).fill("designer@example.invalid");
		await page.locator('input[type="password"]').fill("fictional-password");
		await page.getByRole("button", { name: "sign in", exact: true }).click();
		await expect(page.locator(".login-error")).toContainText("Authentication is disabled");
		interactions += 1;
		if (width === 390) {
			await open(page, "/admin", "dark");
			await page.getByRole("button", { name: "Toggle menu", exact: true }).click();
			await expect(page.locator(".sidebar")).toHaveClass(/sidebar-open/);
			assert.ok(await page.locator(".nav-item").first().evaluate((e) => e.getBoundingClientRect().height >= 44));
			await page.getByRole("button", { name: "Close menu", exact: true }).click({ position: { x: 360, y: 80 } });
			await expect(page.locator(".sidebar")).not.toHaveClass(/sidebar-open/);
			interactions += 1;
		}
		await page.close();
	}
	assert.deepEqual(errors, []);
	const result = { result: "PASS", rendered: cases.length, interactions, errors, cases, captures, classification: "synthetic; provider writes blocked" };
	await writeFile(join(captures, "report.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify({ ...result, cases: undefined }));
} finally {
	await browser.close();
}
