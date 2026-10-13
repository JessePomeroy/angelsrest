import { expect, test } from "@playwright/test";

// Control only the page's animation queue; Playwright's isolated actionability
// world retains its native RAF. Actual Svelte components and 2D canvas run normally.
const probeScript = `(() => {
 const queue = new Map();
 let nextId = 1;
 const probe = window.motionProbe = {
  draws: 0, rasterDraws: 0, glyphDraws: 0, encodes: 0, deleted: [], images: [], lateLoad: null, lateFrame: null, failPaint: false,
  compilationComplete: false, shaderStatusReads: 0, motionChanges: 0,
  queued: () => queue.size,
  tick(time) { const callbacks = [...queue.values()]; queue.clear(); callbacks.forEach(callback => callback(time)); },
  captureLate() { const image = this.images[0]; this.lateLoad = image.onload && (() => image.onloadSaved.call(image, new Event("load"))); image.onloadSaved = image.onload; },
  fireLate() { if (this.lateLoad) this.lateLoad(); },
  captureFrame() { this.lateFrame = [...queue.values()][0]; },
  fireLateFrame(time) { this.lateFrame?.(time); }
 };
 window.requestAnimationFrame = callback => { const id = nextId++; queue.set(id, callback); return id; };
 window.cancelAnimationFrame = id => queue.delete(id);
 const nativeTimeout = window.setTimeout;
 const nativeClear = window.clearTimeout;
 window.setTimeout = (callback, delay, ...args) => {
  if (delay === 125 && typeof callback === "function") { const id = nextId++; queue.set(id, callback); return id; }
  return nativeTimeout(callback, delay, ...args);
 };
 window.clearTimeout = id => { queue.delete(id); nativeClear(id); };
 const fail = new URLSearchParams(location.search).get("failure");
 const gl = {
  VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
  ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, TRIANGLE_STRIP: 8,
  createShader: () => ({}), createProgram: () => ({}),
  createBuffer: () => fail === "buffer" ? null : ({}),
  deleteShader: () => probe.deleted.push("shader"),
  deleteProgram: () => probe.deleted.push("program"),
  deleteBuffer: () => probe.deleted.push("buffer"),
  shaderSource() {}, compileShader() {}, attachShader() {}, linkProgram() {}, useProgram() {},
  getExtension: name => name === "KHR_parallel_shader_compile" && new URLSearchParams(location.search).has("parallel") ? { COMPLETION_STATUS_KHR: 9 } : null,
  getShaderParameter: () => { probe.shaderStatusReads++; return fail !== "compile"; },
  getProgramParameter: (program, parameter) => parameter === 9 ? probe.compilationComplete : fail !== "link",
  getUniformLocation: () => ({}), bindBuffer() {}, bufferData() {},
  getAttribLocation: () => 0, enableVertexAttribArray() {}, vertexAttribPointer() {},
  viewport() {}, uniform1f() {}, drawArrays: () => probe.draws++,
 };
 const getContext = HTMLCanvasElement.prototype.getContext;
 HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
  if (kind === "2d" && fail === "canvas") return null;
  return kind === "webgl" ? gl : getContext.call(this, kind, ...args);
 };
 const getImageData = CanvasRenderingContext2D.prototype.getImageData;
 CanvasRenderingContext2D.prototype.getImageData = function(...args) {
  if (fail === "read") throw new DOMException("Synthetic unreadable image", "SecurityError");
  return getImageData.apply(this, args);
 };
 const fillText = CanvasRenderingContext2D.prototype.fillText;
 CanvasRenderingContext2D.prototype.fillText = function(...args) {
  if (probe.failPaint) throw new Error("Synthetic canvas rendering failure");
  probe.glyphDraws++;
  return fillText.apply(this, args);
 };
 const drawImage = CanvasRenderingContext2D.prototype.drawImage;
 CanvasRenderingContext2D.prototype.drawImage = function(...args) { probe.rasterDraws++; return drawImage.apply(this, args); };
 const toDataURL = HTMLCanvasElement.prototype.toDataURL;
 HTMLCanvasElement.prototype.toDataURL = function(...args) { probe.encodes++; return toDataURL.apply(this, args); };
 const NativeImage = window.Image;
 window.Image = function(...args) {
  const image = new NativeImage(...args);
  probe.images.push(image);
  if (new URLSearchParams(location.search).has("delay-image")) {
   Object.defineProperty(image, "src", { get() { return ""; }, set(value) {} });
  } else if (fail === "image") {
   Object.defineProperty(image, "src", { set() { queueMicrotask(() => image.onerror?.(new Event("error"))); } });
  }
  return image;
 };
})();`;

declare global {
	interface Window {
		motionProbe: {
			draws: number;
			rasterDraws: number;
			glyphDraws: number;
			encodes: number;
			failPaint: boolean;
			compilationComplete: boolean;
			shaderStatusReads: number;
			motionChanges: number;
			motionQuery?: MediaQueryList;
			deleted: string[];
			images: HTMLImageElement[];
			queued: () => number;
			tick: (time: number) => void;
			captureLate: () => void;
			fireLate: () => void;
			captureFrame: () => void;
			fireLateFrame: (time: number) => void;
		};
	}
}

test.beforeEach(async ({ page }) => {
	await page.addInitScript({ content: probeScript });
	await page.route("**/*", async route => {
		if (new URL(route.request().url()).origin === "http://127.0.0.1:5196") return route.continue();
		await route.abort();
		throw new Error("Unexpected external request in motion fixture");
	});
});

test("grain is static when reduced, resumes dynamically, and releases every GPU resource", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/?fixture=motion&kind=grain");
	await expect(page.locator(".grain-canvas")).toBeAttached();
	expect(await page.evaluate(() => [window.motionProbe.queued(), window.motionProbe.draws])).toEqual([0, 1]);
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await expect.poll(() => page.evaluate(() => window.motionProbe.queued())).toBe(1);
	await page.evaluate(() => window.motionProbe.tick(1000));
	expect(await page.evaluate(() => window.motionProbe.draws)).toBe(2);
	await page.emulateMedia({ reducedMotion: "reduce" });
	await expect.poll(() => page.evaluate(() => window.motionProbe.queued())).toBe(0);
	await page.evaluate(() => window.motionProbe.tick(2000));
	expect(await page.evaluate(() => window.motionProbe.draws)).toBe(2);
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await expect.poll(() => page.evaluate(() => window.motionProbe.queued())).toBe(1);
	await page.getByRole("button", { name: "Unmount motion" }).click();
	expect(await page.evaluate(() => window.motionProbe.queued())).toBe(0);
	expect(await page.evaluate(() => window.motionProbe.deleted.sort())).toEqual(["buffer", "program", "shader", "shader"]);
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.evaluate(() => window.dispatchEvent(new Event("resize")));
	expect(await page.evaluate(() => [window.motionProbe.queued(), window.motionProbe.draws])).toEqual([0, 2]);
});

test("grain waits for parallel compilation without reading blocking shader status", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.goto("/?fixture=motion&kind=grain&parallel");
	await expect(page.locator(".grain-canvas")).toBeAttached();
	expect(await page.evaluate(() => [window.motionProbe.draws, window.motionProbe.shaderStatusReads, window.motionProbe.queued()])).toEqual([0, 0, 1]);
	await page.evaluate(() => window.motionProbe.tick(1000));
	expect(await page.evaluate(() => [window.motionProbe.draws, window.motionProbe.shaderStatusReads, window.motionProbe.queued()])).toEqual([0, 0, 1]);
	await page.evaluate(() => {
		const query = matchMedia("(prefers-reduced-motion: reduce)");
		window.motionProbe.motionQuery = query;
		query.addEventListener("change", () => window.motionProbe.motionChanges++, { once: true });
	});
	await page.emulateMedia({ reducedMotion: "reduce" });
	await expect.poll(() => page.evaluate(() => window.motionProbe.motionChanges)).toBe(1);
	await page.evaluate(() => { window.motionProbe.compilationComplete = true; window.motionProbe.tick(2000); });
	expect(await page.evaluate(() => [window.motionProbe.draws, window.motionProbe.queued()])).toEqual([1, 0]);
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await expect.poll(() => page.evaluate(() => window.motionProbe.queued())).toBe(1);
	await page.evaluate(() => window.motionProbe.tick(3000));
	expect(await page.evaluate(() => window.motionProbe.draws)).toBe(2);
	await page.getByRole("button", { name: "Unmount motion" }).click();
	expect(await page.evaluate(() => window.motionProbe.deleted.sort())).toEqual(["buffer", "program", "shader", "shader"]);
});

test("grain cancels pending compilation and ignores a late completion after unmount", async ({ page }) => {
	await page.goto("/?fixture=motion&kind=grain&parallel");
	await expect(page.locator(".grain-canvas")).toBeAttached();
	await page.evaluate(() => window.motionProbe.captureFrame());
	await page.getByRole("button", { name: "Unmount motion" }).click();
	expect(await page.evaluate(() => [window.motionProbe.draws, window.motionProbe.queued()])).toEqual([0, 0]);
	expect(await page.evaluate(() => window.motionProbe.deleted.sort())).toEqual(["buffer", "program", "shader", "shader"]);
	await page.evaluate(() => { window.motionProbe.compilationComplete = true; window.motionProbe.fireLateFrame(1000); });
	expect(await page.evaluate(() => [window.motionProbe.draws, window.motionProbe.shaderStatusReads, window.motionProbe.queued()])).toEqual([0, 0, 0]);
});

test("grain completed in a hidden document waits to animate until visible", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.goto("/?fixture=motion&kind=grain&parallel");
	await expect(page.locator(".grain-canvas")).toBeAttached();
	await page.evaluate(() => {
		Object.defineProperty(document, "hidden", { configurable: true, value: true });
		document.dispatchEvent(new Event("visibilitychange"));
		window.motionProbe.compilationComplete = true;
		window.motionProbe.tick(1000);
	});
	expect(await page.evaluate(() => [window.motionProbe.draws, window.motionProbe.queued()])).toEqual([1, 0]);
	await page.evaluate(() => {
		Object.defineProperty(document, "hidden", { configurable: true, value: false });
		document.dispatchEvent(new Event("visibilitychange"));
		window.motionProbe.tick(2000);
	});
	expect(await page.evaluate(() => window.motionProbe.draws)).toBe(2);
	await page.getByRole("button", { name: "Unmount motion" }).click();
	expect(await page.evaluate(() => window.motionProbe.queued())).toBe(0);
});

for (const failure of ["compile", "link"]) {
	test(`grain releases failed parallel ${failure} resources exactly once`, async ({ page }) => {
		await page.goto(`/?fixture=motion&kind=grain&parallel&failure=${failure}`);
		await expect(page.locator(".grain-canvas")).toBeAttached();
		expect(await page.evaluate(() => window.motionProbe.deleted)).toEqual([]);
		await page.evaluate(() => { window.motionProbe.compilationComplete = true; window.motionProbe.tick(1000); });
		expect(await page.evaluate(() => [window.motionProbe.draws, window.motionProbe.queued()])).toEqual([0, 0]);
		expect(await page.evaluate(() => window.motionProbe.deleted.sort())).toEqual(["buffer", "program", "shader", "shader"]);
		await page.getByRole("button", { name: "Unmount motion" }).click();
		expect(await page.evaluate(() => window.motionProbe.deleted.sort())).toEqual(["buffer", "program", "shader", "shader"]);
	});
}

for (const failure of ["compile", "link", "buffer"]) {
	test(`grain releases partial resources after ${failure} failure`, async ({ page }) => {
		await page.goto(`/?fixture=motion&kind=grain&failure=${failure}`);
		await expect(page.locator(".grain-canvas")).toBeAttached();
		expect(await page.evaluate(() => window.motionProbe.queued())).toBe(0);
		expect(await page.evaluate(() => window.motionProbe.deleted.sort())).toEqual(failure === "buffer" ? ["program", "shader", "shader"] : ["buffer", "program", "shader", "shader"]);
		await page.getByRole("button", { name: "Unmount motion" }).click();
		expect(await page.evaluate(() => window.motionProbe.draws)).toBe(0);
	});
}

test("gradient suppresses CSS drift and cursor RAF on preference changes and unmount", async ({ page }) => {
	// Exercise the mouse listener directly: mobile WebKit does not synthesize mouse movement.
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/?fixture=motion&kind=gradient");
	await expect(page.locator(".orb-primary")).toHaveCSS("animation-name", "none");
	await page.evaluate(() => window.dispatchEvent(new MouseEvent("mousemove", { clientX: 350, clientY: 400 })));
	expect(await page.evaluate(() => window.motionProbe.queued())).toBe(0);
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await expect(page.locator(".orb-primary")).not.toHaveCSS("animation-name", "none");
	// Wait for the listener to observe the asynchronously applied media preference.
	await expect.poll(() => page.evaluate(() => {
		window.dispatchEvent(new MouseEvent("mousemove", { clientX: 100, clientY: 100 }));
		return window.motionProbe.queued();
	})).toBe(1);
	await page.evaluate(() => window.motionProbe.tick(1000));
	const transform = await page.locator(".orb-primary").evaluate(element => (element as HTMLElement).style.transform);
	expect(transform).toContain("translate3d");
	await page.emulateMedia({ reducedMotion: "reduce" });
	await expect.poll(() => page.evaluate(() => window.motionProbe.queued())).toBe(0);
	await page.evaluate(() => window.dispatchEvent(new MouseEvent("mousemove", { clientX: 250, clientY: 250 })));
	await page.evaluate(() => window.motionProbe.tick(2000));
	expect(await page.locator(".orb-primary").evaluate(element => (element as HTMLElement).style.transform)).toBe(transform);
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await expect.poll(() => page.evaluate(() => {
		window.dispatchEvent(new MouseEvent("mousemove", { clientX: 300, clientY: 300 }));
		return window.motionProbe.queued();
	})).toBe(1);
	await page.getByRole("button", { name: "Unmount motion" }).click();
	await page.evaluate(() => window.dispatchEvent(new MouseEvent("mousemove", { clientX: 50, clientY: 50 })));
	expect(await page.evaluate(() => window.motionProbe.queued())).toBe(0);
});

test("ASCII keeps the original under reduced motion and cancels active scramble dynamically", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/?fixture=motion&kind=ascii");
	const container = page.locator(".ascii-image-container");
	await expect(container).toHaveCSS("opacity", "1");
	await container.dispatchEvent("pointerenter", { pointerType: "mouse" });
	expect(await page.evaluate(() => window.motionProbe.queued())).toBe(0);
	await expect(container.locator("img")).toHaveCount(1);
	await expect(container.locator("img")).toHaveCSS("visibility", "visible");
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await expect.poll(() => page.evaluate(() => window.motionProbe.glyphDraws)).toBeGreaterThan(0);
	await expect.poll(() => page.evaluate(() => window.motionProbe.queued())).toBe(1);
	await expect(container.locator(".ascii-overlay")).toBeVisible();
	await expect(container).toHaveCSS("opacity", "1");
	const initialGlyphs = await page.evaluate(() => window.motionProbe.glyphDraws);
	await page.evaluate(() => window.motionProbe.tick(performance.now() + 100));
	expect(await page.evaluate(() => window.motionProbe.glyphDraws)).toBeGreaterThan(initialGlyphs);
	await page.emulateMedia({ reducedMotion: "reduce" });
	await expect.poll(() => page.evaluate(() => window.motionProbe.queued())).toBe(0);
	await expect(container.locator("img")).toHaveCount(1);
	await expect(container.locator("img")).toHaveCSS("visibility", "visible");
	await expect(container).toHaveCSS("opacity", "1");
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await expect.poll(() => page.evaluate(() => window.motionProbe.queued())).toBe(1);
	const beforeUnmount = await page.evaluate(() => window.motionProbe.glyphDraws);
	await page.evaluate(() => window.motionProbe.captureFrame());
	await page.getByRole("button", { name: "Unmount motion" }).click();
	await page.evaluate(() => {
		window.motionProbe.tick(performance.now() + 200);
		window.motionProbe.fireLateFrame(performance.now() + 200);
	});
	expect(await page.evaluate(() => [window.motionProbe.queued(), window.motionProbe.encodes, window.motionProbe.glyphDraws])).toEqual([0, 0, beforeUnmount]);
});

test("ASCII unmount disconnects pending image handlers and rejects a captured late callback", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.goto("/?fixture=motion&kind=ascii&delay-image=1");
	await page.locator(".ascii-image-container").dispatchEvent("pointerenter", { pointerType: "mouse" });
	await expect.poll(() => page.evaluate(() => window.motionProbe.images.length)).toBe(1);
	await page.evaluate(() => window.motionProbe.captureLate());
	await page.getByRole("button", { name: "Unmount motion" }).click();
	expect(await page.evaluate(() => window.motionProbe.images.map(image => [image.onload, image.onerror]))).toEqual([[null, null]]);
	await page.evaluate(() => window.motionProbe.fireLate());
	expect(await page.evaluate(() => [window.motionProbe.queued(), window.motionProbe.rasterDraws, window.motionProbe.encodes])).toEqual([0, 0, 0]);
});

for (const failure of ["image", "canvas", "read"]) {
	test(`ASCII keeps the ordinary image after ${failure} failure`, async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", error => errors.push(error.message));
		await page.emulateMedia({ reducedMotion: "no-preference" });
		await page.goto(`/?fixture=motion&kind=ascii&failure=${failure}`);
		const portrait = page.locator(".ascii-image-container");
		await portrait.dispatchEvent("pointerenter", { pointerType: "mouse" });
		await expect.poll(() => page.evaluate(() => window.motionProbe.images[0]?.onload === null)).toBe(true);
		await portrait.click();
		await expect(portrait.locator("img")).toBeVisible();
		await expect.poll(() => portrait.locator("img").evaluate(image => image instanceof HTMLImageElement && image.naturalWidth)).toBeGreaterThan(0);
		await expect(portrait.locator(".ascii-overlay")).not.toBeVisible();
		expect(await page.evaluate(() => [window.motionProbe.queued(), window.motionProbe.encodes])).toEqual([0, 0]);
		expect(errors).toEqual([]);
	});
}

test("ASCII restores the ordinary image and stops scheduling after an animation paint fails", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", error => errors.push(error.message));
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.goto("/?fixture=motion&kind=ascii");
	const portrait = page.locator(".ascii-image-container");
	await portrait.hover();
	await expect(portrait.locator(".ascii-overlay")).toBeVisible();
	await page.evaluate(() => {
		window.motionProbe.failPaint = true;
		window.motionProbe.tick(performance.now() + 100);
	});
	await expect(portrait.locator("img")).toBeVisible();
	await expect(portrait.locator(".ascii-overlay")).not.toBeVisible();
	expect(await page.evaluate(() => window.motionProbe.queued())).toBe(0);
	expect(errors).toEqual([]);
});
