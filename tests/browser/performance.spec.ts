import { expect, test } from "@playwright/test";

test("shop loads only leading images eagerly and supplies responsive candidates", async ({ page }) => {
	await page.goto("/?fixture=shop");
	const photos = page.locator(".catalog-photo");
	expect(await photos.evaluateAll((images) => images.map((image) => image.getAttribute("loading"))))
		.toEqual(["eager", "eager", "lazy", "lazy", "lazy", "lazy"]);
	await expect(photos.first()).toHaveAttribute("width", "768");
	await expect(photos.first()).toHaveAttribute("sizes", /767px/);
});

test("portrait decoding is deferred until interaction", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.addInitScript(() => {
		const NativeImage = window.Image;
		let count = 0;
		Object.defineProperty(window, "asciiImageCount", { get: () => count });
		window.Image = class extends NativeImage { constructor() { super(); count++; } };
	});
	await page.goto("/?fixture=motion&kind=ascii");
	expect(await page.evaluate(() => Reflect.get(window, "asciiImageCount"))).toBe(0);
	await page.locator(".ascii-image-container").click();
	await expect(page.locator(".ascii-overlay")).toBeVisible();
	expect(await page.evaluate(() => Reflect.get(window, "asciiImageCount"))).toBe(1);
});

test("large delivery galleries mount 48 items and retain whole-gallery selection", async ({ page }) => {
	await page.goto("/?fixture=delivery-downloads&count=2000");
	await expect(page.locator(".grid-cell")).toHaveCount(48);
	await expect(page.getByText("Showing 48 of 2000")).toBeVisible();
	await page.getByRole("button", { name: "Show more", exact: true }).click();
	await expect(page.locator(".grid-cell")).toHaveCount(96);
	await expect(page.getByRole("button", { name: "View item 49 of 2000", exact: true })).toBeFocused();
	await page.getByRole("button", { name: "select all", exact: true }).click();
	await expect(page.getByRole("button", { name: "clear selection", exact: true })).toBeVisible();
	await expect(page.getByText("Showing 96 of 2000")).toBeVisible();
});

test("mobile navigation defers its renderer and rests after interaction", async ({ page, isMobile }) => {
	test.skip(!isMobile);
	test.setTimeout(45_000);
	await page.emulateMedia({ reducedMotion: "no-preference" });
	const surfaceRequests: string[] = [];
	page.on("request", request => { if (request.url().includes("jelly-nav/surface")) surfaceRequests.push(request.url()); });
	await page.addInitScript(() => {
		let draws = 0;
		Object.defineProperty(window, "navDraws", { get: () => draws });
		for (const prototype of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
			const draw = prototype.drawElements;
			prototype.drawElements = function(...args) {
				if (this.canvas instanceof HTMLCanvasElement && this.canvas.classList.contains("water-surface")) draws++;
				return draw.apply(this, args);
			};
		}
	});
	await page.goto("/?fixture=liquid-details");
	await expect(page.locator(".sphere")).toBeVisible();
	expect(surfaceRequests).toHaveLength(0);
	await page.locator(".sphere").tap();
	await expect.poll(() => surfaceRequests.length).toBeGreaterThan(0);
	await expect.poll(() => page.evaluate(() => Reflect.get(window, "navDraws"))).toBeGreaterThan(0);
	// Physics caps each step at 50ms, so slow software GPUs need more wall time.
	// Require a full quiet second while browser frames still advance.
	await expect(async () => {
		const sample = await page.evaluate(async () => {
			const before = Number(Reflect.get(window, "navDraws"));
			const started = performance.now();
			let frames = 0;
			await new Promise<void>((resolve) => {
				function observe(time: number) {
					frames++;
					if (time - started >= 1000 && frames >= 3) resolve();
					else requestAnimationFrame(observe);
				}
				requestAnimationFrame(observe);
			});
			return { before, after: Number(Reflect.get(window, "navDraws")) };
		});
		expect(sample.after).toBe(sample.before);
	}).toPass({ timeout: 20_000, intervals: [250] });
});
