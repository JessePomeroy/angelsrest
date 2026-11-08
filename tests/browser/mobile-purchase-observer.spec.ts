import { expect, test } from "@playwright/test";

test("queued visibility changes keep keyboard navigation above purchase controls", async ({ page, isMobile }) => {
	test.skip(!isMobile, "Mobile purchase controls");
	await page.setViewportSize({ width: 402, height: 874 });
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.addInitScript(() => {
		const NativeObserver = window.IntersectionObserver;
		let deliverQueuedChanges: (() => void) | undefined;
		window.IntersectionObserver = class extends NativeObserver {
			constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
				super((entries, observer) => {
					const current = entries.find((entry) => entry.target.classList.contains("sticky-bar") && entry.isIntersecting);
					if (current) {
						deliverQueuedChanges = () => {
							// Coalesce the bar's earlier offscreen state and current visible
							// state in one delivery, as the asynchronous observer API permits.
							const earlier: IntersectionObserverEntry = {
								time: current.time - 1,
								target: current.target,
								rootBounds: current.rootBounds,
								boundingClientRect: new DOMRectReadOnly(current.boundingClientRect.x, innerHeight + 1, current.boundingClientRect.width, current.boundingClientRect.height),
								intersectionRect: new DOMRectReadOnly(),
								intersectionRatio: 0,
								isIntersecting: false,
							};
							callback([earlier, current], observer);
							document.documentElement.dataset.purchaseVisibilityDelivered = "true";
						};
					}
					callback(entries, observer);
				}, options);
			}
		};
		window.addEventListener("test:purchase-visibility", () => {
			if (!deliverQueuedChanges) throw new Error("Purchase observer is not ready");
			deliverQueuedChanges();
		});
	});
	await page.goto("/?fixture=chrome&purchase=true&kind=product");
	const sphere = page.locator(".sphere");
	await expect(sphere).toBeInViewport();
	await expect(page.locator(".sticky-bar")).toHaveCSS("bottom", "0px");
	await page.evaluate(() => window.dispatchEvent(new Event("test:purchase-visibility")));
	await expect(page.locator("html")).toHaveAttribute("data-purchase-visibility-delivered", "true");
	await sphere.focus();
	for (let step = 0; step < 8; step++) await page.keyboard.press("ArrowDown");
	// An immediate positive gap can precede an overlapping animation target.
	// Observe the movement, including its settled position, rather than a single frame.
	const minimumGap = await page.evaluate(() => new Promise<number>((resolve) => {
		const start = performance.now();
		let minimum = Infinity;
		function sample() {
			const bar = document.querySelector(".sticky-bar")?.getBoundingClientRect();
			const sphere = document.querySelector(".sphere")?.getBoundingClientRect();
			minimum = Math.min(minimum, bar && sphere ? bar.y - sphere.bottom : -Infinity);
			if (performance.now() - start < 1200) requestAnimationFrame(sample);
			else resolve(minimum);
		}
		requestAnimationFrame(sample);
	}));
	expect(minimumGap).toBeGreaterThanOrEqual(0);
});
