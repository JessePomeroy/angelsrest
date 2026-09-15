import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const browser = await chromium.launch({ headless: true });
const failures = [];
let passed = 0;

async function check(name, fn) {
	try { await fn(); passed += 1; }
	catch (error) { failures.push({ name, error: error.message }); }
}

async function open(page, route, theme = "dark") {
	await page.goto(`http://127.0.0.1:5208/?route=/admin/${route}&theme=${theme}&period=morning&state=populated`);
	await page.locator(".admin-page").waitFor();
	await page.evaluate(() => document.fonts.ready);
}

try {
	for (const width of [320, 390, 768, 1440]) {
		const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: "reduce" });
		for (const theme of ["dark", "light"]) {
			await open(page, "crm", theme);
			await check(`clients layout ${width} ${theme}`, async () => {
				const category = await page.getByLabel("Client category").boundingBox();
				const status = await page.getByLabel("Client status").boundingBox();
				assert.ok(Math.abs(category.y - status.y) <= 1, "Filters should share a row");
				if (width <= 768) {
					const stats = await page.locator(".stats-line").boundingBox();
					const bar = await page.locator(".filter-bar").boundingBox();
					const search = await page.locator(".filter-search").boundingBox();
					assert.ok(stats.height < 90, "Stats should wrap compactly, not form a long column");
					assert.ok(Math.abs(search.width - bar.width) <= 1, "Search should use the available width");
					assert.ok(Math.abs(category.x - bar.x) <= 1, "Filters should align to the page gutter");
				}
				assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
			});
			for (const route of ["quotes", "contracts"]) {
				await open(page, route, theme);
				await check(`${route} tab strip ${width} ${theme}`, async () => {
					const geometry = await page.locator(".tab-bar").evaluate((e) => {
						e.scrollTop = 10; e.scrollLeft = 10;
						return { top: e.scrollTop, left: e.scrollLeft, height: e.clientHeight, scrollHeight: e.scrollHeight };
					});
					assert.equal(geometry.top, 0, "Tab strip must not scroll vertically");
					assert.equal(geometry.left, 0, "Tab strip must not scroll horizontally");
					assert.ok(geometry.scrollHeight <= geometry.height, "No one-pixel tab overflow");
					await page.getByRole("tab").nth(1).click();
					await expect(page.getByRole("tab").nth(1)).toHaveAttribute("aria-selected", "true");
				});
			}
		}
		await page.close();
	}
	for (const motion of ["no-preference", "reduce"]) {
		const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: motion });
		const errors = [];
		page.on("pageerror", (error) => errors.push(error.message));
		const cdp = await page.context().newCDPSession(page);
		const sheet = page.locator(".modal-content");
		const handle = page.locator(".sheet-handle");
		const opener = page.locator(".template-item").first();
		await page.addInitScript(() => {
			window.sheetTransitions = [];
			for (const type of ["introstart", "introend", "outrostart", "outroend"]) {
				document.addEventListener(type, (event) => {
					if (event.target.classList.contains("modal-content")) {
						window.sheetTransitions.push({ type, time: performance.now(), scrollLock: document.body.style.overflow });
					}
				}, true);
			}
		});
		await open(page, "emails");
		async function openSheet() {
			await opener.click();
			await expect(handle).toBeVisible();
			await page.waitForFunction(() => window.sheetTransitions.at(-1)?.type === "introend");
			await expect(page.locator(".modal-close")).toBeFocused();
		}
		async function drag(distance, cancel = false) {
			const rect = await handle.boundingBox();
			const x = rect.x + rect.width / 2;
			const y = rect.y + rect.height / 2;
			await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
			for (let step = 1; step <= 5; step += 1) {
				await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + distance * step / 5 }] });
			}
			await cdp.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd", touchPoints: [] });
		}
		await check(`sheet drag and dismissal ${motion}`, async () => {
			await openSheet();
			await drag(24);
			await expect(sheet).toBeVisible();
			await expect.poll(() => sheet.evaluate((e) => getComputedStyle(e).transform)).toBe("none");
			await drag(120, true);
			await expect(sheet).toBeVisible();
			await expect.poll(() => sheet.evaluate((e) => getComputedStyle(e).transform)).toBe("none");
			await drag(140);
			await expect(sheet).toHaveCount(0);
			await expect(opener).toBeFocused();
			assert.equal(await page.evaluate(() => document.body.style.overflow), "");
			for (const action of ["close", "backdrop", "escape"]) {
				await openSheet();
				if (action === "close") await page.locator(".modal-close").click();
				if (action === "backdrop") await page.mouse.click(10, 10);
				if (action === "escape") await page.keyboard.press("Escape");
				await expect(sheet).toHaveCount(0);
				await expect(opener).toBeFocused();
			}
			const transitions = await page.evaluate(() => window.sheetTransitions);
			const intro = transitions.find((event) => event.type === "introstart");
			const introEnd = transitions.find((event) => event.type === "introend");
			const outro = transitions.find((event) => event.type === "outrostart");
			const outroEnd = transitions.find((event) => event.type === "outroend");
			assert.ok(intro && introEnd && outro && outroEnd);
			if (motion === "no-preference") {
				assert.ok(introEnd.time - intro.time >= 150, "Sheet visibly animates on open");
				assert.ok(outroEnd.time - outro.time >= 150, "Sheet visibly animates on close");
			} else {
				assert.ok(introEnd.time - intro.time < 80, "Reduced motion skips the slide");
			}
			assert.ok(transitions.filter((event) => event.type === "outroend").every((event) => event.scrollLock === "hidden"), "Keep scroll ownership until the outro completes");
			assert.deepEqual(errors, []);
		});
		await open(page, "crm");
		await check(`long sheet content scrolling ${motion}`, async () => {
			const add = page.getByRole("button", { name: "add client", exact: true });
			await add.click();
			await page.waitForFunction(() => window.sheetTransitions.at(-1)?.type === "introend");
			await page.locator(".modal-scroll-region").evaluate((e) => { e.scrollTop = e.scrollHeight; });
			const rect = await sheet.boundingBox();
			const grip = await handle.boundingBox();
			assert.ok(Math.abs(grip.y - rect.y) < 3, "Handle stays at the top while contents scroll");
			await expect(sheet).toBeVisible();
			await page.getByRole("button", { name: "cancel", exact: true }).focus();
			for (let step = 0; step < 10; step += 1) {
				await page.keyboard.press("Shift+Tab");
				const visibility = await page.evaluate(() => {
					const e = document.activeElement;
					if (!e.matches("input, textarea, select")) return { visible: true };
					const rect = e.getBoundingClientRect();
					const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
					return { visible: hit === e || e.contains(hit), field: e.id, top: rect.y, hit: hit?.className };
				});
				assert.ok(visibility.visible, `Pinned header must not obscure focused form controls: ${JSON.stringify(visibility)}`);
			}
			await page.getByRole("button", { name: "cancel", exact: true }).click();
			await expect(sheet).toHaveCount(0);
			await expect(add).toBeFocused();
			assert.deepEqual(errors, []);
		});
		await page.close();
	}
	console.log(JSON.stringify({ passed, failures }));
	assert.deepEqual(failures, []);
} finally {
	await browser.close();
}
