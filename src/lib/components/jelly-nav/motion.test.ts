import { describe, expect, it } from "vitest";
import {
	bubbleOffset,
	clampDock,
	createSpring,
	launchFling,
	menuCenter,
	stepFling,
	stepSpring,
} from "./motion";

describe("water navigation placement", () => {
	it("keeps every touch target on screen at all four dock corners", () => {
		for (const viewport of [
			{ width: 320, height: 568 },
			{ width: 390, height: 844 },
			{ width: 667, height: 375 },
		]) {
			for (const x of [0, viewport.width]) {
				for (const y of [0, viewport.height]) {
					const center = menuCenter(clampDock({ x, y }, viewport), viewport);
					const positions = Array.from({ length: 6 }, (_, i) => {
						const offset = bubbleOffset(i, 1);
						return { x: center.x + offset.x, y: center.y + offset.y };
					});
					for (const position of positions) {
						expect(position.x - 26).toBeGreaterThanOrEqual(0);
						expect(position.x + 26).toBeLessThanOrEqual(viewport.width);
						expect(position.y - 26).toBeGreaterThanOrEqual(0);
						expect(position.y + 38).toBeLessThanOrEqual(viewport.height);
					}
					for (let i = 1; i < positions.length; i++) {
						expect(
							Math.hypot(positions[i].x - positions[i - 1].x, positions[i].y - positions[i - 1].y),
						).toBeGreaterThan(60);
					}
				}
			}
		}
	});
});

describe("water navigation spring", () => {
	it("settles at the same position across refresh rates", () => {
		for (const fps of [30, 60, 120]) {
			const spring = createSpring({ x: 20, y: 700 });
			for (let frame = 0; frame < fps * 2; frame++) {
				stepSpring(spring, { x: 300, y: 60 }, 1 / fps);
			}
			expect(spring.x).toBeCloseTo(300, 2);
			expect(spring.y).toBeCloseTo(60, 2);
		}
	});

	it("reverses smoothly mid-flight and stays finite after a long pause", () => {
		const spring = createSpring({ x: 195, y: 750 });
		stepSpring(spring, { x: 52, y: 52 }, 1 / 60);
		const beforeReversal = { ...spring };
		stepSpring(spring, { x: 330, y: 740 }, 1 / 60);
		expect(Math.hypot(spring.x - beforeReversal.x, spring.y - beforeReversal.y)).toBeLessThan(30);
		stepSpring(spring, { x: 330, y: 740 }, 300);
		expect(Number.isFinite(spring.x) && Number.isFinite(spring.y)).toBe(true);
		for (let frame = 0; frame < 120; frame++) {
			stepSpring(spring, { x: 330, y: 740 }, 1 / 60);
		}
		expect(spring.x).toBeCloseTo(330, 2);
		expect(spring.y).toBeCloseTo(740, 2);
	});
});

describe("water navigation fling", () => {
	it("reflects fast throws at every edge without leaving the viewport", () => {
		const viewport = { width: 320, height: 568 };
		for (const velocity of [
			{ vx: -2400, vy: 0 },
			{ vx: 2400, vy: 0 },
			{ vx: 0, vy: -2400 },
			{ vx: 0, vy: 2400 },
		]) {
			const body = { ...createSpring({ x: 160, y: 280 }), ...velocity };
			let bounced = false;
			for (let i = 0; i < 120; i++) {
				stepFling(body, viewport, 1 / 60);
				expect(body.x).toBeGreaterThanOrEqual(24);
				expect(body.x).toBeLessThanOrEqual(viewport.width - 24);
				expect(body.y).toBeGreaterThanOrEqual(24);
				expect(body.y).toBeLessThanOrEqual(viewport.height - 24);
				if (body.vx * velocity.vx < 0 || body.vy * velocity.vy < 0) bounced = true;
			}
			expect(bounced).toBe(true);
		}
	});

	it("slows to rest rather than running forever", () => {
		const body = { ...createSpring({ x: 180, y: 400 }), vx: 2200, vy: -1800 };
		let moving = true;
		for (let i = 0; i < 60 * 15; i++) moving = stepFling(body, { width: 390, height: 844 }, 1 / 60);
		expect(moving).toBe(false);
		expect(body.vx).toBe(0);
		expect(body.vy).toBe(0);
	});

	it("preserves travel across refresh rates", () => {
		const positions = [30, 60, 120].map((fps) => {
			const body = { ...createSpring({ x: 180, y: 400 }), vx: 50, vy: -70 };
			for (let i = 0; i < fps; i++) stepFling(body, { width: 390, height: 844 }, 1 / fps);
			return body;
		});
		for (const body of positions) {
			expect(body.x).toBeCloseTo(positions[0].x, 4);
			expect(body.y).toBeCloseTo(positions[0].y, 4);
		}
	});
});

describe("gentle liquid contact", () => {
	it("scales release speed down and caps diagonal throws", () => {
		const slow = launchFling({ x: 100, y: 200 }, { x: 1000, y: 0 });
		expect(slow.vx).toBeCloseTo(340);
		const diagonal = launchFling({ x: 100, y: 200 }, { x: 2400, y: 2400 });
		expect(Math.hypot(diagonal.vx, diagonal.vy)).toBeCloseTo(680);
	});

	it("compresses against a wall before reversing and recovering", () => {
		const body = { ...createSpring({ x: 60, y: 300 }), vx: -500, vy: 0 };
		let pressing = false;
		let recovering = false;
		let contactFrames = 0;
		for (let i = 0; i < 120; i++) {
			stepFling(body, { width: 390, height: 844 }, 1 / 120);
			if (body.x < 42) {
				contactFrames++;
				if (body.vx < 0) pressing = true;
				if (body.vx > 0) recovering = true;
			}
		}
		expect(pressing).toBe(true);
		expect(recovering).toBe(true);
		expect(contactFrames).toBeGreaterThan(8);
		expect(body.x).toBeGreaterThan(42);
	});
});

describe("clockwise bubble sweep", () => {
	it("moves clockwise during both expansion and collapse", () => {
		for (let i = 0; i < 6; i++) {
			for (const expanding of [true, false]) {
				const progress = expanding ? [0, 0.25, 0.5, 0.75, 1] : [1, 0.75, 0.5, 0.25, 0];
				for (let j = 1; j < progress.length; j++) {
					const a = bubbleOffset(i, progress[j - 1], expanding);
					const b = bubbleOffset(i, progress[j], expanding);
					// Positive cross product is clockwise in screen coordinates (y down).
					expect(a.x * b.y - a.y * b.x).toBeGreaterThan(0);
				}
			}
		}
	});

	it("keeps the open destinations identical in either direction", () => {
		for (let i = 0; i < 6; i++) {
			expect(bubbleOffset(i, 1, true)).toEqual(bubbleOffset(i, 1, false));
		}
	});
});
