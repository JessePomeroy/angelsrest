import { expect, test, type Locator } from "@playwright/test";

async function expectFrameOn(frame: Locator, target: Locator) {
	await expect(frame).toHaveCSS("opacity", "1");
	await expect.poll(async () => {
		const actual = await frame.boundingBox();
		const expected = await target.boundingBox();
		if (!actual || !expected) return Infinity;
		return Math.max(...(["x", "y", "width", "height"] as const).map(key => Math.abs(actual[key] - expected[key])));
	}).toBeLessThan(1);
}

async function pauseFrameMotion(frame: Locator, progress: number) {
	return frame.evaluate((element, fraction) => {
		const geometry = ["inset", "top", "right", "bottom", "left", "margin", "marginTop", "marginRight", "marginBottom", "marginLeft"];
		const animations = element.getAnimations().filter(animation =>
			animation.effect instanceof KeyframeEffect &&
			animation.effect.getKeyframes().some(keyframe => geometry.some(property => property in keyframe)),
		);
		for (const animation of animations) {
			const duration = animation.effect?.getTiming().duration;
			if (typeof duration !== "number" || duration <= 0) throw new Error("Expected finite frame motion");
			animation.pause();
			animation.currentTime = duration * fraction;
		}
		const { x, y, width, height } = element.getBoundingClientRect();
		return { count: animations.length, bounds: { x, y, width, height } };
	}, progress);
}

const surfaces = [
	{ name: "portfolio collections", url: "?fixture=content&kind=portfolio-index", item: ".gallery-entry", target: ".image-frame" },
	{ name: "portfolio photographs", url: "?fixture=content&kind=portfolio-page&mixed", item: ".image-button", target: null },
	{ name: "shop thumbnails", url: "?fixture=shop", item: ".catalog-entry", target: ".image-clip" },
	{ name: "product images", url: "?fixture=product-css", item: "[data-magnetic-item]", target: null },
] as const;

for (const surface of surfaces) {
	test(`${surface.name}: hover frame fits its target and leaves links and lightboxes usable`, async ({ page, isMobile }) => {
		test.skip(isMobile, "Hover is intentionally disabled for touch devices");
		await page.goto(`/${surface.url}`);
		const items = page.locator(surface.item);
		const frame = page.locator(".magnetic-indicator");
		for (const index of [0, 1, 2]) {
			const item = items.nth(index);
			await item.hover();
			await expectFrameOn(frame, surface.target ? item.locator(surface.target) : item);
			await expect(item).toHaveCSS("opacity", "1");
		}
		await expect(frame).toHaveCSS("pointer-events", "none");
		if (surface.target) {
			await expect(items.nth(2)).toHaveAttribute("href", /^\/(gallery|shop)\//);
		} else {
			await items.nth(2).click();
			await expect(page.getByRole("dialog")).toBeVisible();
			await expect(page.getByRole("dialog").getByRole("img")).toHaveAttribute("src", await items.nth(2).locator("img").getAttribute("src") ?? "");
			await page.keyboard.press("Escape");
			await expect(page.getByRole("dialog")).toHaveCount(0);
		}
	});
}

test("frame glides across masonry gutters and follows reflow and late image sizing", async ({ page, isMobile }) => {
	test.skip(isMobile, "Spatial hover transitions require a mouse");
	await page.goto("/?fixture=content&kind=portfolio-page&mixed");
	const items = page.locator(".image-button");
	const frame = page.locator(".magnetic-indicator");
	await items.first().hover();
	await expectFrameOn(frame, items.first());
	expect(await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches)).toBe(true);
	const first = await items.first().boundingBox();
	if (!first) throw new Error("Missing first photograph");
	await page.mouse.move(first.x + first.width + 2, first.y + 10);
	await expectFrameOn(frame, items.first());
	const target = await items.nth(2).boundingBox();
	if (!target) throw new Error("Missing target photograph");
	await items.nth(2).hover();
	const motion = await pauseFrameMotion(frame, 0.25);
	expect(motion.count, "The frame must animate geometry, not only opacity").toBeGreaterThan(0);
	const axes = ["x", "y", "width", "height"] as const;
	expect(Math.max(...axes.map(axis => Math.abs(motion.bounds[axis] - first[axis])))).toBeGreaterThan(1);
	expect(Math.max(...axes.map(axis => Math.abs(motion.bounds[axis] - target[axis])))).toBeGreaterThan(1);
	for (const axis of axes) {
		expect(motion.bounds[axis]).toBeGreaterThanOrEqual(Math.min(first[axis], target[axis]) - 1);
		expect(motion.bounds[axis]).toBeLessThanOrEqual(Math.max(first[axis], target[axis]) + 1);
	}
	await frame.evaluate(el => el.getAnimations().forEach(animation => animation.play()));
	await expectFrameOn(frame, items.nth(2));
	await page.setViewportSize({ width: 800, height: 900 });
	await items.nth(2).hover();
	await expectFrameOn(frame, items.nth(2));
	// A loaded image can change masonry geometry without a pointer event.
	await items.nth(2).locator("img").evaluate(img => { img.style.aspectRatio = "2 / 1"; });
	await expectFrameOn(frame, items.nth(2));
	await page.mouse.move(0, 0);
	await expect(frame).toHaveCSS("opacity", "0");
});

test("leaving during a glide fades the frame without snapping to its destination", async ({ page, isMobile }) => {
	test.skip(isMobile, "Spatial hover transitions require a mouse");
	await page.goto("/?fixture=content&kind=portfolio-page&mixed");
	const items = page.locator(".image-button");
	const frame = page.locator(".magnetic-indicator");
	await items.first().hover();
	await expectFrameOn(frame, items.first());
	await items.nth(2).hover();
	const before = await pauseFrameMotion(frame, 0.25);
	expect(before.count).toBeGreaterThan(0);
	await page.mouse.move(0, 0);
	const after = await frame.boundingBox();
	if (!after) throw new Error("Missing fading frame");
	expect(Math.max(...(["x", "y", "width", "height"] as const).map(axis => Math.abs(after[axis] - before.bounds[axis])))).toBeLessThan(1);
	await frame.evaluate(el => el.getAnimations().forEach(animation => animation.play()));
	await expect(frame).toHaveCSS("opacity", "0");
	await expect.poll(() => frame.evaluate(el => el.getAnimations().length)).toBe(0);
	await items.nth(2).hover();
	await expectFrameOn(frame, items.nth(2));
});

test("shop filtering clears removed anchors and supports print-set previews", async ({ page, isMobile }) => {
	test.skip(isMobile, "Hover is intentionally disabled for touch devices");
	await page.goto("/?fixture=shop");
	const frame = page.locator(".magnetic-indicator");
	await page.locator(".catalog-entry").first().hover();
	await expectFrameOn(frame, page.locator(".image-clip").first());
	await page.getByRole("tab", { name: "Postcards", exact: true }).click();
	await expect(frame).toHaveCSS("opacity", "0");
	await expect(page.locator("[data-magnetic-anchor]")).toHaveCount(0);
	await page.getByRole("tab", { name: "Prints", exact: true }).click();
	await page.getByRole("link", { name: /Fixture pair/ }).hover();
	await expectFrameOn(frame, page.locator(".set-preview"));
	await page.locator(".catalog-entry").last().hover();
	await expectFrameOn(frame, page.locator(".image-clip").last());
});

test("keyboard focus and reduced motion preserve immediate feedback and lightbox access", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/?fixture=product-css");
	const images = page.locator("[data-magnetic-item]");
	const frame = page.locator(".magnetic-indicator");
	await images.first().focus();
	await page.keyboard.press("Tab");
	await expect(images.nth(1)).toBeFocused();
	await expect(images.nth(1)).toHaveCSS("outline-style", "solid");
	const hasHoverFrame = await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches && CSS.supports("anchor-scope", "--image") && CSS.supports("inset", "anchor(inside)"));
	if (hasHoverFrame) {
		await expectFrameOn(frame, images.nth(1));
		await page.keyboard.press("Tab");
		await expectFrameOn(frame, images.nth(2));
		expect((await pauseFrameMotion(frame, 0.25)).count).toBe(0);
	}
	await page.keyboard.press("Enter");
	await expect(page.getByRole("dialog")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await expect(images.nth(hasHoverFrame ? 2 : 1)).toBeFocused();
});

test("touch opens a photograph in one tap without a sticky hover frame", async ({ page, isMobile }) => {
	test.skip(!isMobile, "Requires a touch viewport");
	await page.goto("/?fixture=content&kind=portfolio-page&mixed");
	const image = page.locator(".image-button").nth(1);
	await image.tap();
	await expect(page.getByRole("dialog")).toBeVisible();
	await expect(page.getByRole("dialog").getByRole("img")).toHaveAttribute("alt", "Portfolio photograph 2");
	await page.getByRole("button", { name: "Close lightbox" }).tap();
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await expect(page.locator(".magnetic-indicator")).toBeHidden();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
