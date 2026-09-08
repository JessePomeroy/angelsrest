import { createServer } from "node:http";
import { expect, test, type Locator } from "@playwright/test";

declare global {
	interface Window {
		asciiPending: HTMLImageElement[];
		asciiLate: (event: Event) => unknown;
		asciiRasterDraws: number;
	}
}

// Observe the rendered pixels, whether the implementation displays an image or canvas.
async function expectAsciiPixels(portrait: Locator) {
	const surface = portrait.locator(".ascii-overlay");
	await expect(surface).toBeVisible();
	expect(await surface.evaluate(async element => {
		let canvas: HTMLCanvasElement;
		if (element instanceof HTMLCanvasElement) canvas = element;
		else if (element instanceof HTMLImageElement) {
			await element.decode();
			canvas = document.createElement("canvas");
			canvas.width = element.naturalWidth;
			canvas.height = element.naturalHeight;
			const context = canvas.getContext("2d");
			if (!context) throw new Error("Missing pixel inspection context");
			context.drawImage(element, 0, 0);
		} else throw new Error("Unexpected ASCII rendering surface");
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Missing ASCII context");
		return new Set(context.getImageData(0, 0, canvas.width, canvas.height).data).size;
	})).toBeGreaterThan(4);
}

test.beforeEach(async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.addInitScript(() => {
		Object.defineProperty(window, "turnstile", { value: { render: () => "fixture", reset() {}, remove() {} } });
		Object.defineProperty(window, "Cal", { writable: true, value: Object.assign(() => {}, { ns: { photosession: Object.assign(() => {}, { instance: {} }) } }) });
	});
	await page.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:5196" ? route.continue() : route.abort());
});

test("About portrait supports keyboard toggle, Escape, blur and a visible focus ring", async ({ page }) => {
	await page.goto("/?fixture=content&kind=about");
	const portrait = page.locator(".ascii-image-container");
	for (let i = 0; i < 12; i++) {
		await page.keyboard.press("Tab");
		if (await portrait.evaluate(node => node === document.activeElement)) break;
	}
	await expect(portrait).toBeFocused();
	await expect(portrait).toHaveAccessibleName("Portrait fixture — toggle ASCII art");
	await expect(portrait).toHaveCSS("outline-style", "solid");
	for (const key of ["Space", "Enter"]) {
		await page.keyboard.press(key);
		await expect(portrait.locator(".ascii-overlay")).toBeVisible();
		await expect(portrait).toHaveAttribute("aria-pressed", "true");
		await page.keyboard.press(key);
		await expect(portrait.locator("img")).toBeVisible();
	}
	await page.keyboard.press("Enter");
	await page.keyboard.press("Escape");
	await expect(portrait.locator("img")).toBeVisible();
	await page.keyboard.press("Enter");
	await page.keyboard.press("Tab");
	await expect(portrait.locator("img")).toBeVisible();
});

test("About portrait supports repeated hover or tap without changing its crop", async ({ page }, testInfo) => {
	// The real portrait is 2:3, taller than the About frame's 3:4 crop.
	const src = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="#789abc"/></svg>');
	await page.goto(`/?fixture=content&kind=about&portrait=${encodeURIComponent(src)}`);
	const portrait = page.locator(".ascii-image-container");
	const photo = portrait.locator("img").first();
	for (let i = 0; i < 2; i++) {
		if (testInfo.project.name === "desktop") await portrait.hover();
		else await portrait.tap();
		const surface = portrait.locator(".ascii-overlay");
		await expect(surface).toBeVisible();
		expect(await surface.boundingBox()).toEqual(await photo.boundingBox());
		await expect(surface).toHaveCSS("object-fit", "cover");
		if (testInfo.project.name === "desktop") await page.mouse.move(1200, 700);
		else await portrait.tap();
		await expect(photo).toBeVisible();
	}
});

test("an invalid portrait URL leaves the About fallback usable without a page error", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", error => errors.push(error.message));
	await page.goto(`/?fixture=content&kind=about&portrait=${encodeURIComponent("http://[")}`);
	await expect(page.getByRole("button", { name: "Book a session" })).toBeEnabled();
	await expect(page.locator(".ascii-image-container img")).toHaveAttribute("alt", "Portrait fixture");
	await expect(page.locator(".ascii-overlay")).not.toBeVisible();
	expect(errors).toEqual([]);
});

test("About replacement disconnects pending image work before it can paint the new portrait", async ({ page }, testInfo) => {
	await page.addInitScript(() => {
		const NativeImage = window.Image;
		window.asciiPending = [];
		window.asciiRasterDraws = 0;
		CanvasRenderingContext2D.prototype.drawImage = new Proxy(CanvasRenderingContext2D.prototype.drawImage, {
			apply(target, receiver, args) {
				window.asciiRasterDraws++;
				return Reflect.apply(target, receiver, args);
			},
		});
		// Decode real images, but hold the application's completion callbacks.
		window.Image = class extends NativeImage {
			constructor() {
				super();
				let onload: HTMLImageElement["onload"] = null;
				let onerror: HTMLImageElement["onerror"] = null;
				Object.defineProperties(this, {
					onload: { get: () => onload, set: (value: HTMLImageElement["onload"]) => { onload = value; } },
					onerror: { get: () => onerror, set: (value: HTMLImageElement["onerror"]) => { onerror = value; } },
				});
				window.asciiPending.push(this);
			}
		};
	});
	await page.goto("/?fixture=content&kind=about&replace-portrait");
	const about = await page.locator(".about-page").elementHandle();
	const portrait = page.locator(".ascii-image-container");
	const photo = portrait.locator("img").first();
	const originalSrc = await photo.getAttribute("src");
	await expect.poll(() => page.evaluate(() => window.asciiPending.length)).toBe(1);
	await page.evaluate(async () => {
		const old = window.asciiPending[0];
		await old.decode();
		const callback = old.onload;
		if (!callback) throw new Error("Missing original image callback");
		window.asciiLate = event => callback.call(old, event);
	});
	// The fixture updates the real About route data, without remounting About.
	await page.getByRole("button", { name: "Replace portrait" }).click();
	expect(await about?.evaluate(node => node === document.querySelector(".about-page"))).toBe(true);
	await expect(photo).not.toHaveAttribute("src", originalSrc ?? "");
	await expect.poll(() => photo.evaluate(image => image instanceof HTMLImageElement && image.naturalWidth)).toBeGreaterThan(0);
	await expect.poll(() => page.evaluate(() => window.asciiPending.length)).toBe(2);
	expect(await page.evaluate(() => {
		const old = window.asciiPending[0];
		return [old.onload, old.onerror];
	})).toEqual([null, null]);
	if (testInfo.project.name === "desktop") await portrait.hover();
	else await portrait.tap();
	await page.evaluate(() => window.asciiLate(new Event("load")));
	expect(await page.evaluate(() => window.asciiRasterDraws)).toBe(0);
	await expect(photo).toBeVisible();
	await expect(portrait.locator(".ascii-overlay")).not.toBeVisible();
	await page.evaluate(async () => {
		const current = window.asciiPending[1];
		await current.decode();
		current.onload?.call(current, new Event("load"));
	});
	await expectAsciiPixels(portrait);
	const draws = await page.evaluate(() => window.asciiRasterDraws);
	await page.evaluate(() => window.asciiLate(new Event("load")));
	expect(await page.evaluate(() => window.asciiRasterDraws)).toBe(draws);
});

test("About canvas can read a cross-origin portrait after its ordinary response is cached", async ({ page }, testInfo) => {
	const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#789abc"/></svg>';
	const requests: { path: string | undefined; origin: string | undefined; mode: string | string[] | undefined }[] = [];
	const errors: string[] = [];
	page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
	page.on("pageerror", error => errors.push(error.message));
	const server = createServer((request, response) => {
		requests.push({ path: request.url, origin: request.headers.origin, mode: request.headers["sec-fetch-mode"] });
		response.setHeader("Content-Type", "image/svg+xml");
		response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
		// Match R2: no-Origin responses have neither ACAO nor Vary.
		if (request.headers.origin === "http://127.0.0.1:5196") {
			response.setHeader("Access-Control-Allow-Origin", request.headers.origin);
			response.setHeader("Vary", "Origin");
		}
		response.end(svg);
	});
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing fixture address");
	const src = `http://127.0.0.1:${address.port}/portrait.svg`;
	try {
		await page.goto(`/?fixture=content&kind=about&defer-about&portrait=${encodeURIComponent(src)}`);
		await expect(page.getByRole("button", { name: "Show About" })).toBeVisible();
		await expect(page.locator(".about-page")).not.toBeAttached();
		// Keep provider requests blocked without Playwright routing disabling cache.
		await page.evaluate(origin => {
			const policy = document.createElement("meta");
			policy.httpEquiv = "Content-Security-Policy";
			policy.content = `default-src 'self' data: blob:; img-src 'self' data: ${origin}; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:5196`;
			document.head.append(policy);
		}, new URL(src).origin);
		// Playwright routing disables HTTP cache. Remove every route BEFORE warming.
		await page.unrouteAll({ behavior: "wait" });
		for (let read = 0; read < 2; read++) {
			await page.evaluate(src => new Promise<void>((resolve, reject) => {
				const photo = new Image();
				photo.onload = () => resolve();
				photo.onerror = () => reject(new Error("Ordinary photo failed"));
				photo.src = src;
			}), src);
		}
		expect(requests).toEqual([{ path: "/portrait.svg", origin: undefined, mode: "no-cors" }]);
		await page.getByRole("button", { name: "Show About" }).click();
		const portrait = page.locator(".ascii-image-container");
		await expect(portrait.locator("img").first()).toHaveAttribute("src", src);
		if (testInfo.project.name === "desktop") await portrait.hover();
		else await portrait.tap();
		await expectAsciiPixels(portrait);
	} finally {
		await testInfo.attach("warm-cache-observations", { body: JSON.stringify({ requests, errors }, null, 2), contentType: "application/json" });
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
	}
});
