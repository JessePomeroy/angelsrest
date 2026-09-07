import { expect, test } from "@playwright/test";

// Control only the page's animation queue; Playwright's isolated actionability
// world retains its native RAF. Actual Svelte components and 2D canvas run normally.
const probeScript = `(() => {
 const queue = new Map();
 let nextId = 1;
 const probe = window.motionProbe = {
  draws: 0, rasterDraws: 0, encodes: 0, deleted: [], images: [], lateLoad: null,
  queued: () => queue.size,
  tick(time) { const callbacks = [...queue.values()]; queue.clear(); callbacks.forEach(callback => callback(time)); },
  captureLate() { const image = this.images[0]; this.lateLoad = image.onload && (() => image.onloadSaved.call(image, new Event("load"))); image.onloadSaved = image.onload; },
  fireLate() { if (this.lateLoad) this.lateLoad(); }
 };
 window.requestAnimationFrame = callback => { const id = nextId++; queue.set(id, callback); return id; };
 window.cancelAnimationFrame = id => queue.delete(id);
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
  getShaderParameter: () => fail !== "compile", getProgramParameter: () => fail !== "link",
  getUniformLocation: () => ({}), bindBuffer() {}, bufferData() {},
  getAttribLocation: () => 0, enableVertexAttribArray() {}, vertexAttribPointer() {},
  viewport() {}, uniform1f() {}, drawArrays: () => probe.draws++,
 };
 const getContext = HTMLCanvasElement.prototype.getContext;
 HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
  return kind === "webgl" ? gl : getContext.call(this, kind, ...args);
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
  }
  return image;
 };
})();`;

declare global {
	interface Window {
		motionProbe: {
			draws: number;
			rasterDraws: number;
			encodes: number;
			deleted: string[];
			images: HTMLImageElement[];
			queued: () => number;
			tick: (time: number) => void;
			captureLate: () => void;
			fireLate: () => void;
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
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/?fixture=motion&kind=gradient");
	await expect(page.locator(".orb-primary")).toHaveCSS("animation-name", "none");
	await page.mouse.move(350, 400);
	expect(await page.evaluate(() => window.motionProbe.queued())).toBe(0);
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await expect(page.locator(".orb-primary")).not.toHaveCSS("animation-name", "none");
	await page.mouse.move(100, 100);
	await expect.poll(() => page.evaluate(() => window.motionProbe.queued())).toBe(1);
	await page.evaluate(() => window.motionProbe.tick(1000));
	const transform = await page.locator(".orb-primary").evaluate(element => (element as HTMLElement).style.transform);
	expect(transform).toContain("translate3d");
	await page.emulateMedia({ reducedMotion: "reduce" });
	await expect.poll(() => page.evaluate(() => window.motionProbe.queued())).toBe(0);
	await page.mouse.move(250, 250);
	await page.evaluate(() => window.motionProbe.tick(2000));
	expect(await page.locator(".orb-primary").evaluate(element => (element as HTMLElement).style.transform)).toBe(transform);
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.mouse.move(300, 300);
	await expect.poll(() => page.evaluate(() => window.motionProbe.queued())).toBe(1);
	await page.getByRole("button", { name: "Unmount motion" }).click();
	await page.mouse.move(50, 50);
	expect(await page.evaluate(() => window.motionProbe.queued())).toBe(0);
});

test("ASCII keeps the original under reduced motion and cancels active scramble dynamically", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/?fixture=motion&kind=ascii");
	const container = page.locator(".ascii-image-container");
	await container.dispatchEvent("mouseenter");
	expect(await page.evaluate(() => window.motionProbe.queued())).toBe(0);
	await expect(container.locator("img")).toHaveCount(1);
	await expect(container.locator("img")).toHaveCSS("visibility", "visible");
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await expect.poll(() => page.evaluate(() => window.motionProbe.encodes)).toBe(1);
	await expect.poll(() => page.evaluate(() => window.motionProbe.queued())).toBe(1);
	await page.evaluate(() => window.motionProbe.tick(performance.now() + 100));
	expect(await page.evaluate(() => window.motionProbe.encodes)).toBe(2);
	await page.emulateMedia({ reducedMotion: "reduce" });
	await expect.poll(() => page.evaluate(() => window.motionProbe.queued())).toBe(0);
	await expect(container.locator("img")).toHaveCount(1);
	await expect(container.locator("img")).toHaveCSS("visibility", "visible");
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await expect.poll(() => page.evaluate(() => window.motionProbe.queued())).toBe(1);
	await page.getByRole("button", { name: "Unmount motion" }).click();
	await page.evaluate(() => window.motionProbe.tick(performance.now() + 200));
	expect(await page.evaluate(() => [window.motionProbe.queued(), window.motionProbe.encodes])).toEqual([0, 2]);
});

test("ASCII unmount disconnects pending image handlers and rejects a captured late callback", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.goto("/?fixture=motion&kind=ascii&delay-image=1");
	await expect.poll(() => page.evaluate(() => window.motionProbe.images.length)).toBe(1);
	await page.evaluate(() => window.motionProbe.captureLate());
	await page.getByRole("button", { name: "Unmount motion" }).click();
	expect(await page.evaluate(() => window.motionProbe.images.map(image => [image.onload, image.onerror]))).toEqual([[null, null]]);
	await page.evaluate(() => window.motionProbe.fireLate());
	expect(await page.evaluate(() => [window.motionProbe.queued(), window.motionProbe.rasterDraws, window.motionProbe.encodes])).toEqual([0, 0, 0]);
});
