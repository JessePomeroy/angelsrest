import { describe, expect, it } from "vitest";
import { createInnerIcons, stepInnerIcons } from "./innerIcons";

describe("floating navigation icons", () => {
	it("keeps all six icons inside the sphere through sustained motion and impulses", () => {
		const icons = createInnerIcons(6);
		const initial = icons.map(({ x, y }) => ({ x, y }));
		for (let frame = 0; frame < 1800; frame++) {
			stepInnerIcons(
				icons,
				1 / 30,
				frame / 30,
				frame % 120 === 0 ? { x: 1200, y: -800 } : undefined,
			);
			for (const icon of icons) {
				expect(Math.hypot(icon.x, icon.y)).toBeLessThanOrEqual(24.00001);
				expect(Number.isFinite(icon.vx) && Number.isFinite(icon.vy)).toBe(true);
			}
		}
		for (let i = 0; i < icons.length; i++) {
			expect(Math.hypot(icons[i].x - initial[i].x, icons[i].y - initial[i].y)).toBeGreaterThan(1);
		}
	});

	it("bounces an icon inward at the circular wall", () => {
		const icons = [{ x: 24, y: 0, vx: 10, vy: 0 }];
		stepInnerIcons(icons, 1 / 30, 0);
		expect(icons[0].vx).toBeLessThan(0);
		expect(Math.hypot(icons[0].x, icons[0].y)).toBeLessThanOrEqual(24);
	});

	it("separates approaching icons and exchanges their direction", () => {
		const icons = [
			{ x: -6, y: 0, vx: 8, vy: 0 },
			{ x: 6, y: 0, vx: -8, vy: 0 },
		];
		stepInnerIcons(icons, 1 / 30, 0);
		expect(icons[0].vx).toBeLessThan(0);
		expect(icons[1].vx).toBeGreaterThan(0);
		expect(Math.hypot(icons[1].x - icons[0].x, icons[1].y - icons[0].y)).toBeGreaterThanOrEqual(13);
	});
});
