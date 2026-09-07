export interface Point {
	x: number;
	y: number;
}

export interface Viewport {
	width: number;
	height: number;
}

export interface Spring extends Point {
	vx: number;
	vy: number;
}

export const DOCK_RADIUS = 40;
export const BUBBLE_RADIUS = 24;
const ORBIT_RADIUS = 92;
const MENU_MARGIN = ORBIT_RADIUS + BUBBLE_RADIUS + 22;

export function clamp(value: number, low: number, high: number) {
	return Math.max(low, Math.min(value, Math.max(low, high)));
}

export function clampDock(point: Point, viewport: Viewport): Point {
	return {
		x: clamp(point.x, DOCK_RADIUS + 12, viewport.width - DOCK_RADIUS - 12),
		y: clamp(point.y, DOCK_RADIUS + 12, viewport.height - DOCK_RADIUS - 24),
	};
}

// The open orbit shifts inward near an edge, then returns to the user's dock
// when closed. Keeping the orbit rigid prevents overlapping hit targets.
export function menuCenter(dock: Point, viewport: Viewport): Point {
	return {
		x: clamp(dock.x, MENU_MARGIN, viewport.width - MENU_MARGIN),
		y: clamp(dock.y, MENU_MARGIN, viewport.height - MENU_MARGIN),
	};
}

export function bubbleOffset(index: number, openness: number, expanding = true): Point {
	// Approach the resting orbit from counterclockwise, then depart clockwise.
	// Both journeys sweep clockwise while fully open destinations stay fixed.
	const sweep = (expanding ? -1 : 1) * (1 - openness) * (Math.PI / 7);
	const angle = -Math.PI / 2 + (index * Math.PI) / 3 + sweep;
	const radius = 9 + (ORBIT_RADIUS - 9) * openness;
	return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

export function createSpring(point: Point): Spring {
	return { ...point, vx: 0, vy: 0 };
}

// Substeps make the damped spring stable across 30/60/120 Hz displays and
// prevent a background-tab pause from injecting a large physics impulse.
export function stepSpring(
	spring: Spring,
	target: Point,
	elapsed: number,
	stiffness = 210,
	damping = 27,
) {
	let remaining = Math.min(Math.max(elapsed, 0), 0.05);
	while (remaining > 0) {
		const dt = Math.min(remaining, 1 / 120);
		spring.vx += ((target.x - spring.x) * stiffness - spring.vx * damping) * dt;
		spring.vy += ((target.y - spring.y) * stiffness - spring.vy * damping) * dt;
		spring.x += spring.vx * dt;
		spring.y += spring.vy * dt;
		remaining -= dt;
	}
}

export function settleSpring(spring: Spring, target: Point) {
	spring.x = target.x;
	spring.y = target.y;
	spring.vx = 0;
	spring.vy = 0;
}

// Release speed is intentionally much gentler than finger speed. Cap the
// vector magnitude so diagonal throws are no faster than straight throws.
export function launchFling(point: Point, velocity: Point): Spring {
	const speed = Math.hypot(velocity.x, velocity.y);
	const scale = Math.min(0.34, 680 / Math.max(speed, 1));
	return { ...point, vx: velocity.x * scale, vy: velocity.y * scale };
}

// Walls act like damped springs: the liquid presses into them before the
// restoring force pushes it away. A final penetration limit handles pauses
// and extreme input without letting the volume escape the viewport.
export function stepFling(body: Spring, viewport: Viewport, elapsed: number): boolean {
	const low = { x: DOCK_RADIUS + 2, y: DOCK_RADIUS + 2 };
	const high = { x: viewport.width - DOCK_RADIUS - 2, y: viewport.height - DOCK_RADIUS - 2 };
	let remaining = Math.min(Math.max(elapsed, 0), 0.05);
	while (remaining > 0) {
		const dt = Math.min(remaining, 1 / 120);
		for (const axis of ["x", "y"] as const) {
			const velocity = axis === "x" ? "vx" : "vy";
			const penetration =
				body[axis] < low[axis]
					? body[axis] - low[axis]
					: body[axis] > high[axis]
						? body[axis] - high[axis]
						: 0;
			if (penetration !== 0) {
				body[velocity] += (-500 * penetration - 14 * body[velocity]) * dt;
			}
			body[velocity] *= Math.exp(-1.05 * dt);
			body[axis] += body[velocity] * dt;
			if (body[axis] < low[axis] - 18 || body[axis] > high[axis] + 18) {
				body[axis] = clamp(body[axis], low[axis] - 18, high[axis] + 18);
				body[velocity] *= -0.35;
			}
		}
		remaining -= dt;
	}
	const touching = body.x < low.x || body.x > high.x || body.y < low.y || body.y > high.y;
	if (!touching && Math.hypot(body.vx, body.vy) < 10) {
		body.vx = 0;
		body.vy = 0;
		return false;
	}
	return true;
}
