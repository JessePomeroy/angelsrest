import { clamp, createSpring, type Point, type Spring } from "./motion";

const RADIUS = 24;
const SEPARATION = 13;

export function createInnerIcons(count: number): Spring[] {
	return Array.from({ length: count }, (_, i) => {
		const angle = i * 2.39996;
		const radius = Math.sqrt((i + 0.5) / count) * 22;
		return {
			...createSpring({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }),
			vx: Math.cos(angle + 1.1) * 9,
			vy: Math.sin(angle + 1.1) * 9,
		};
	});
}

export function stepInnerIcons(
	icons: Spring[],
	elapsed: number,
	time: number,
	impulse: Point = { x: 0, y: 0 },
) {
	for (const icon of icons) {
		icon.vx -= clamp(impulse.x * 0.025, -12, 12);
		icon.vy -= clamp(impulse.y * 0.025, -12, 12);
	}
	let remaining = Math.min(Math.max(elapsed, 0), 0.05);
	while (remaining > 0) {
		const dt = Math.min(remaining, 1 / 120);
		for (let i = 0; i < icons.length; i++) {
			const icon = icons[i];
			icon.vx += Math.cos(time * 0.45 + i * 2.1) * 1.5 * dt;
			icon.vy += Math.sin(time * 0.38 + i * 1.7) * 1.5 * dt;
			const speed = Math.hypot(icon.vx, icon.vy);
			const scale = Math.min(
				Math.exp(-(0.12 + Math.max(0, speed - 9) * 0.06) * dt),
				22 / Math.max(speed, 1),
			);
			icon.vx *= scale;
			icon.vy *= scale;
			icon.x += icon.vx * dt;
			icon.y += icon.vy * dt;
		}

		// Gentle equal-mass collisions keep the six symbols individually legible.
		for (let i = 0; i < icons.length; i++) {
			for (let j = i + 1; j < icons.length; j++) {
				const a = icons[i];
				const b = icons[j];
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const distance = Math.hypot(dx, dy);
				if (distance >= SEPARATION) continue;
				const nx = distance > 0 ? dx / distance : 1;
				const ny = distance > 0 ? dy / distance : 0;
				const overlap = (SEPARATION - distance) / 2;
				a.x -= nx * overlap;
				a.y -= ny * overlap;
				b.x += nx * overlap;
				b.y += ny * overlap;
				const approach = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
				if (approach < 0) {
					a.vx += approach * nx * 0.9;
					a.vy += approach * ny * 0.9;
					b.vx -= approach * nx * 0.9;
					b.vy -= approach * ny * 0.9;
				}
			}
		}
		for (const icon of icons) {
			const radius = Math.hypot(icon.x, icon.y);
			if (radius <= RADIUS) continue;
			const nx = icon.x / radius;
			const ny = icon.y / radius;
			icon.x = nx * RADIUS;
			icon.y = ny * RADIUS;
			const outward = icon.vx * nx + icon.vy * ny;
			if (outward > 0) {
				icon.vx -= 1.85 * outward * nx;
				icon.vy -= 1.85 * outward * ny;
			}
		}
		remaining -= dt;
	}
}
