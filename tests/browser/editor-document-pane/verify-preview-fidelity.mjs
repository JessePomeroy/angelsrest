import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const browser = await chromium.launch({ headless: true });
const failures = [];
let passed = 0;

async function check(name, run) {
	try { await run(); passed += 1; }
	catch (error) { failures.push({ name, error: error.message }); }
}

try {
	for (const width of [390, 1440]) {
		for (const theme of ["dark", "light"]) {
			const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
			await page.route("**/*", (route) => ["GET", "HEAD"].includes(route.request().method()) ? route.continue() : route.abort());
			await check(`portfolio selection ${width} ${theme}`, async () => {
				for (const [id, title] of [[1, "Window light"], [2, "Along the shore"], [1, "Window light"]]) {
					await page.goto(`http://127.0.0.1:5208/?route=/admin/editor/portfolio&state=populated&theme=${theme}`);
					await page.locator(`a[href="/admin/editor/portfolio/demo-portfolio-${id}"]`).click();
					await expect.poll(() => new URL(page.url()).searchParams.get("route")).toBe(`/admin/editor/portfolio/demo-portfolio-${id}`);
					await expect(page.locator("#gallery-title")).toHaveValue(title);
					await expect(page.locator(".gallery-page h1")).toHaveText(title);
				}
			});
			await page.close();
		}
	}
	for (const state of ["populated", "loading", "error"]) {
		const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
		const errors = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.route("**/*", (route) => ["GET", "HEAD"].includes(route.request().method()) ? route.continue() : route.abort());
		await check(`paginated initial ${state}`, async () => {
			await page.goto(`http://127.0.0.1:5208/?route=/admin/messages&state=${state}&theme=dark`);
			await page.locator(".admin-layout").waitFor();
			// Inspect the actual compiled fixture hook, not a second mocked implementation.
			const result = await page.evaluate(async () => {
				const { usePaginatedQuery } = await import("/convex.svelte.ts");
				const { api } = await import("/api.ts");
				const snapshot = (query) => ({ count: query.results.length, status: query.status, loading: query.isLoading, error: query.error?.message ?? null });
				return snapshot(usePaginatedQuery(api.messages.allThreadsPaginated, {}));
			});
			assert.deepEqual(result, {
				count: state === "populated" ? 1 : 0,
				status: state === "populated" ? "Exhausted" : "LoadingFirstPage",
				loading: state === "loading",
				error: state === "error" ? "Simulated read failure" : null,
			});
			await expect(page.locator(".thread-item")).toHaveCount(state === "populated" ? 1 : 0);
			// The existing MessagesPage renders its loading branch after an initial error.
			await expect(page.locator(".loading-state")).toHaveCount(state === "populated" ? 0 : 1);
			assert.deepEqual(errors, []);
		});
		await page.close();
	}
} finally {
	await browser.close();
}

console.log(JSON.stringify({ passed, failures }, null, 2));
if (failures.length) process.exitCode = 1;
