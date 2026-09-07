<script lang="ts">
import {
	HouseIcon,
	ImageIcon,
	PencilLineIcon,
	ShoppingBagIcon,
	ShoppingCartIcon,
	UserIcon,
	XIcon,
} from "@lucide/svelte";
import { onMount } from "svelte";
import { afterNavigate } from "$app/navigation";
import { page } from "$app/state";
import { cart } from "$lib/shop/cart.svelte";
import { registerCartFeedback } from "$lib/shop/cartFeedback";
import { drawPhotoLens } from "./jelly-nav/photoLens";
import { cartUI } from "$lib/shop/cartUI.svelte";
import {
	DOCK_RADIUS,
	bubbleOffset,
	clamp,
	clampDock,
	createSpring,
	menuCenter,
	settleSpring,
	stepSpring,
	stepFling,
	launchFling,
	type Spring,
	type Point,
} from "./jelly-nav/motion";
import { createInnerIcons, stepInnerIcons } from "./jelly-nav/innerIcons";
import type { WaterSurface } from "./jelly-nav/surface";

const POSITION_KEY = "angelsrest-water-nav-position";
const SURFACE_SIZE = 320;
const links = [
	{ label: "Gallery", href: "/gallery", icon: ImageIcon },
	{ label: "Shop", href: "/shop", icon: ShoppingBagIcon },
	{ label: "Cart", href: null, icon: ShoppingCartIcon },
	{ label: "About", href: "/about", icon: UserIcon },
	{ label: "Home", href: "/", icon: HouseIcon },
	{ label: "Blog", href: "/blog", icon: PencilLineIcon },
];

let trigger: HTMLButtonElement;
let canvas: HTMLCanvasElement;
let lensCanvas: HTMLCanvasElement;
let lensVisible = $state(false);
let wake = $state.raw<{ x: number; y: number; age: number; id: number }[]>([]);
let cartDrop = $state.raw<{ x: number; y: number; scale: number } | null>(null);
let absorption = $state(0);
let expanded = $state(false);
let dragging = $state(false);
let flying = $state(false);
let flight: Spring | null = null;
let mounted = $state(false);
let rendered = $state(false);
let reducedMotion = false;
let viewport = $state({ width: 390, height: 844, left: 0, top: 0 });
let dock = { x: 195, y: 772 };
let frame = $state.raw({
	center: dock,
	drops: links.map(() => ({ ...dock })),
	open: 0,
});
const frostRadius = $derived(DOCK_RADIUS - frame.open * 11);
let innerIcons = $state.raw(createInnerIcons(links.length).map(({ x, y }) => ({ x, y })));
let announcement = $state("");
let requestFrame = () => {};
let pointer: {
	id: number; origin: Point; offset: Point; last: Point;
	time: number; velocity: Point; moved: boolean;
} | undefined;

function close(restoreFocus = false) {
	expanded = false;
	requestFrame();
	if (restoreFocus) trigger?.focus();
}

function savePosition() {
	try {
		localStorage.setItem(POSITION_KEY, JSON.stringify({
			x: dock.x / viewport.width,
			y: dock.y / viewport.height,
		}));
	} catch { /* Storage may be disabled; dragging still works for this visit. */ }
}

function pointerDown(event: PointerEvent) {
	if (!event.isPrimary || event.button !== 0 || pointer) return;
	event.preventDefault();
	trigger.focus({ preventScroll: true });
	flight = null;
	flying = false;
	dock = clampDock(frame.center, viewport);
	const origin = { x: event.clientX, y: event.clientY };
	pointer = {
		id: event.pointerId, origin, last: origin,
		time: event.timeStamp, velocity: { x: 0, y: 0 }, moved: false,
		offset: { x: origin.x - dock.x - viewport.left, y: origin.y - dock.y - viewport.top },
	};
	trigger.setPointerCapture(event.pointerId);
	dragging = true;
	requestFrame();
}

function pointerMove(event: PointerEvent) {
	if (pointer?.id !== event.pointerId) return;
	event.preventDefault();
	const dt = Math.max((event.timeStamp - pointer.time) / 1000, 0.001);
	pointer.velocity = {
		x: clamp(pointer.velocity.x * 0.35 + (event.clientX - pointer.last.x) / dt * 0.65, -2400, 2400),
		y: clamp(pointer.velocity.y * 0.35 + (event.clientY - pointer.last.y) / dt * 0.65, -2400, 2400),
	};
	pointer.last = { x: event.clientX, y: event.clientY };
	pointer.time = event.timeStamp;
	if (Math.hypot(event.clientX - pointer.origin.x, event.clientY - pointer.origin.y) > 4) {
		pointer.moved = true;
		expanded = false;
	}
	dock = clampDock({
		x: event.clientX - pointer.offset.x - viewport.left,
		y: event.clientY - pointer.offset.y - viewport.top,
	}, viewport);
	requestFrame();
}

function finishPointer(cancelled = false, releaseTime?: number) {
	const gesture = pointer;
	if (!gesture) return;
	pointer = undefined;
	dragging = false;
	if (trigger?.hasPointerCapture(gesture.id)) trigger.releasePointerCapture(gesture.id);
	if (!cancelled && gesture.moved && !reducedMotion && releaseTime !== undefined
		&& releaseTime - gesture.time < 100) {
		flight = launchFling(dock, gesture.velocity);
		flying = Math.hypot(flight.vx, flight.vy) >= 12;
		if (!flying) flight = null;
	} else if (!cancelled && !gesture.moved && releaseTime !== undefined) {
		expanded = !expanded;
	}
	if (!flying) savePosition();
	announcement = flying ? "Sphere released." : "Navigation position saved.";
	requestFrame();
}

function activate(event: MouseEvent) {
	// Pointer taps are handled on release because touchstart is cancelled to
	// prevent native text selection. Keep synthesized keyboard/AT activation.
	if (event.detail !== 0) return;
	flight = null;
	flying = false;
	expanded = !expanded;
	requestFrame();
}

function keyboardMove(event: KeyboardEvent) {
	const movement: Record<string, Point> = {
		ArrowLeft: { x: -24, y: 0 }, ArrowRight: { x: 24, y: 0 },
		ArrowUp: { x: 0, y: -24 }, ArrowDown: { x: 0, y: 24 },
	};
	const delta = movement[event.key];
	if (!delta) return;
	event.preventDefault();
	flight = null;
	flying = false;
	close();
	dock = clampDock({ x: dock.x + delta.x, y: dock.y + delta.y }, viewport);
	savePosition();
	requestFrame();
}

afterNavigate(() => close());

onMount(() => {
	const media = window.matchMedia("(prefers-reduced-motion: reduce)");
	reducedMotion = media.matches;
	const visualViewport = window.visualViewport;
	let surface: WaterSurface | null = null;
	let loadingSurface = false;
	let disposed = false;
	let surfaceUnavailable = false;
	async function loadSurface() {
		if (surface || loadingSurface || surfaceUnavailable || window.innerWidth >= 768) return;
		loadingSurface = true;
		try {
			const { createWaterSurface } = await import("./jelly-nav/surface");
			if (disposed) return;
			surface = createWaterSurface(canvas, SURFACE_SIZE, requestFrame);
			surfaceUnavailable = !surface;
			requestFrame();
		} catch {
			surfaceUnavailable = true;
		} finally {
			loadingSurface = false;
		}
	}
	function measure() {
		viewport = {
			width: visualViewport?.width ?? window.innerWidth,
			height: visualViewport?.height ?? window.innerHeight,
			left: visualViewport?.offsetLeft ?? 0,
			top: visualViewport?.offsetTop ?? 0,
		};
		dock = clampDock(dock, viewport);
		flight = null;
		flying = false;
		if (window.innerWidth >= 768) {
			close();
			finishPointer(true);
		}
		requestFrame();
		void loadSurface();
	}
	measure();
	dock = clampDock({ x: viewport.width / 2, y: viewport.height - 76 }, viewport);
	try {
		const saved: unknown = JSON.parse(localStorage.getItem(POSITION_KEY) ?? "null");
		if (saved && typeof saved === "object" && "x" in saved && "y" in saved
			&& typeof saved.x === "number" && typeof saved.y === "number"
			&& Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
			dock = clampDock({ x: saved.x * viewport.width, y: saved.y * viewport.height }, viewport);
		}
	} catch { /* Ignore unavailable or malformed saved placement. */ }

	const center = createSpring(dock);
	const openness = createSpring({ x: 0, y: 0 });
	const flow = createSpring({ x: 0, y: 0 });
	const floatingIcons = createInnerIcons(links.length);
	let lastIconVelocity = { x: 0, y: 0 };
	const compression = createSpring({ x: 0, y: 0 });
	const drops = links.map((_, i) => {
		const offset = bubbleOffset(i, 0);
		return createSpring({ x: dock.x + offset.x, y: dock.y + offset.y });
	});
	let animation = 0;
	let lastTime = 0;
	let activeUntil = 0;
	let dark = document.documentElement.classList.contains("dark");
	const warmthForPeriod = () => {
		const period = document.documentElement.dataset.timePeriod;
		return period === "golden" ? 1 : period === "dawn" ? 0.65 : period === "evening" ? 0.25 : period === "night" ? -1 : 0;
	};
	let warmth = warmthForPeriod();
	let lastWake = 0;
	let restStarted = 0;
	let lastLensDraw = 0;
	let absorbedAt = -10000;
	let delivery: { origin: Point; start: number; absorbed?: boolean; complete: () => void } | null = null;
	const unregisterFeedback = registerCartFeedback((origin, complete) => {
		delivery?.complete();
		close();
		flight = null;
		flying = false;
		delivery = { origin: { x: origin.x - viewport.left, y: origin.y - viewport.top }, start: performance.now(), complete };
		cartDrop = { ...delivery.origin, scale: 1 };
		requestFrame();
	});
	function clearDetails() {
		wake = [];
		lensVisible = false;
		restStarted = 0;
		cartDrop = null;
		const pending = delivery;
		delivery = null;
		pending?.complete();
	}
	const themeObserver = new MutationObserver(() => {
		dark = document.documentElement.classList.contains("dark");
		warmth = warmthForPeriod();
		requestFrame();
	});
	themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-time-period"] });

	function animate(time: number) {
		animation = 0;
		if (disposed || document.hidden || window.innerWidth >= 768) return;
		const moving = time < activeUntil || dragging || flying
			|| Math.hypot(flow.x, flow.y) > 1 || Math.hypot(compression.x, compression.y) > 0.001;
		// Idle ripples need fewer draws than direct touch motion on a phone GPU.
		if (!reducedMotion && !moving && lastTime && time - lastTime < 1000 / 30) {
			animation = requestAnimationFrame(animate);
			return;
		}
		const dt = lastTime ? (time - lastTime) / 1000 : 1 / 60;
		lastTime = time;
		if (flight) {
			flying = !reducedMotion && stepFling(flight, viewport, dt);
			dock = { x: flight.x, y: flight.y };
			if (!flying) { flight = null; savePosition(); }
		}
		const target = expanded ? menuCenter(dock, viewport) : dock;
		if (dragging || flying) {
			settleSpring(center, dock);
			center.vx = flight?.vx ?? pointer?.velocity.x ?? 0;
			center.vy = flight?.vy ?? pointer?.velocity.y ?? 0;
		} else if (reducedMotion) {
			settleSpring(center, target);
		} else {
			stepSpring(center, target, dt, dragging ? 340 : 210, dragging ? 31 : 27);
		}
		if (!reducedMotion && !expanded) {
			stepInnerIcons(floatingIcons, dt, time / 1000, {
				x: center.vx - lastIconVelocity.x, y: center.vy - lastIconVelocity.y,
			});
			innerIcons = floatingIcons.map(({ x, y }) => ({ x, y }));
		}
		lastIconVelocity = { x: center.vx, y: center.vy };
		if (reducedMotion) settleSpring(openness, { x: expanded ? 1 : 0, y: 0 });
		else stepSpring(openness, { x: expanded ? 1 : 0, y: 0 }, dt, 115, 21);
		for (let i = 0; i < drops.length; i++) {
			const offset = bubbleOffset(i, clamp(openness.x, 0, 1), expanded);
			const destination = { x: center.x + offset.x, y: center.y + offset.y };
			if (reducedMotion) settleSpring(drops[i], destination);
			else stepSpring(drops[i], destination, dt, 180 - i * 8, 24);
		}
		frame = {
			center: { x: center.x, y: center.y },
			drops: drops.map(({ x, y }) => ({ x, y })),
			open: clamp(openness.x, 0, 1),
		};
		wake = wake.map((ring) => ({ ...ring, age: time - ring.id })).filter((ring) => ring.age < 750);
		if (flying && !expanded && Math.hypot(center.vx, center.vy) > 100 && time - lastWake > 120) {
			wake = [...wake.slice(-2), { x: center.x, y: center.y, age: 0, id: time }];
			lastWake = time;
		}
		if (delivery) {
			const progress = clamp((time - delivery.start) / 700, 0, 1);
			const ease = progress * progress * (3 - 2 * progress);
			cartDrop = {
				x: delivery.origin.x + (center.x - delivery.origin.x) * ease,
				y: delivery.origin.y + (center.y - delivery.origin.y) * ease - Math.sin(progress * Math.PI) * 45,
				scale: 1 - Math.max(0, (progress - 0.75) / 0.25) * 0.85,
			};
			if (progress === 1) {
				if (!delivery.absorbed) { absorbedAt = time; delivery.absorbed = true; }
				cartDrop = null;
			}
			if (time - delivery.start >= 1000) {
				const complete = delivery.complete;
				delivery = null;
				complete();
			}
		}
		absorption = Math.max(0, 1 - (time - absorbedAt) / 650);
		if (dragging || flying || expanded || cartUI.isOpen || Math.hypot(center.vx, center.vy) > 8) {
			restStarted = time;
			lensVisible = false;
		} else if (time - lastLensDraw > 100) {
			if (!restStarted) restStarted = time;
			const moment = (time - restStarted) % 12000;
			lensVisible = moment > 1200 && moment < 4000 && drawPhotoLens(lensCanvas, {
				x: center.x + viewport.left, y: center.y + viewport.top,
			});
			lastLensDraw = time;
		}
		const pressure = {
			x: clamp((DOCK_RADIUS + 2 - Math.min(center.x, viewport.width - center.x)) / DOCK_RADIUS, 0, 0.45),
			y: clamp((DOCK_RADIUS + 2 - Math.min(center.y, viewport.height - center.y)) / DOCK_RADIUS, 0, 0.45),
		};
		if (reducedMotion) {
			settleSpring(flow, { x: 0, y: 0 });
			settleSpring(compression, { x: 0, y: 0 });
		} else {
			stepSpring(flow, { x: clamp(center.vx, -700, 700), y: clamp(center.vy, -700, 700) }, dt, 65, 12);
			stepSpring(compression, pressure, dt, 240, 20);
		}
		rendered = surface?.draw({
			...frame,
			velocity: { x: flow.x, y: flow.y },
			compression: { x: compression.x, y: compression.y },
			viewport,
			time: time / 1000,
			ambientRipple: reducedMotion ? 0 : 1,
			agitation: reducedMotion ? 0 : Math.min(1, Math.hypot(center.vx, center.vy) / 500 + Math.abs(openness.vx) * 0.3 + absorption * 0.65 + (dragging ? 0.25 : 0)),
			dark,
			warmth,
		}) ?? false;
		if (!reducedMotion && (surface || moving || !expanded)) {
			animation = requestAnimationFrame(animate);
		}
	}

	requestFrame = () => {
		activeUntil = performance.now() + 1800;
		if (!animation && !document.hidden && window.innerWidth < 768) {
			lastTime = 0;
			animation = requestAnimationFrame(animate);
		}
	};
	function visibility() {
		if (document.hidden) {
			clearDetails();
			finishPointer(true);
			flight = null;
			flying = false;
			savePosition();
			cancelAnimationFrame(animation);
			animation = 0;
		} else requestFrame();
	}
	function scrollDetails() { lensVisible = false; restStarted = performance.now(); }
	window.addEventListener("scroll", scrollDetails, { passive: true, capture: true });
	function motionPreference() { reducedMotion = media.matches; requestFrame(); }
	// Safari can initiate selection from content beneath a transparent overlay.
	// Cancel the native touch gesture only on the sphere, leaving page gestures alone.
	function preventNativeTouch(event: TouchEvent) { if (event.cancelable) event.preventDefault(); }
	trigger.addEventListener("touchstart", preventNativeTouch, { passive: false });
	trigger.addEventListener("touchmove", preventNativeTouch, { passive: false });
	window.addEventListener("resize", measure);
	visualViewport?.addEventListener("resize", measure);
	visualViewport?.addEventListener("scroll", measure);
	document.addEventListener("visibilitychange", visibility);
	media.addEventListener("change", motionPreference);
	mounted = true;
	requestFrame();

	return () => {
		disposed = true;
		unregisterFeedback();
		clearDetails();
		window.removeEventListener("scroll", scrollDetails, true);
		trigger.removeEventListener("touchstart", preventNativeTouch);
		trigger.removeEventListener("touchmove", preventNativeTouch);
		cancelAnimationFrame(animation);
		requestFrame = () => {};
		window.removeEventListener("resize", measure);
		visualViewport?.removeEventListener("resize", measure);
		visualViewport?.removeEventListener("scroll", measure);
		document.removeEventListener("visibilitychange", visibility);
		media.removeEventListener("change", motionPreference);
		themeObserver.disconnect();
		surface?.dispose();
	};
});
</script>

<svelte:window onkeydown={(event) => {
	if (event.key === "Escape" && (expanded || dragging || flying)) { finishPointer(true); flight = null; flying = false; close(true); }
}} />

<div class="jelly-nav md:hidden" class:expanded class:dragging class:flying class:rendered class:mounted
	style:left={`${viewport.left}px`} style:top={`${viewport.top}px`}>
	{#if expanded}
		<button class="dismiss" type="button" tabindex="-1" aria-label="Close navigation" onclick={() => close(true)}></button>
	{/if}
	{#each wake as ring (ring.id)}
		<span class="wake-ring" aria-hidden="true" style:opacity={(1 - ring.age / 750) * 0.16}
			style:transform={`translate(${ring.x - 30}px, ${ring.y - 30}px) scale(${1 + ring.age / 1100})`}></span>
	{/each}
	<!-- Frost sits under the liquid renderer so reflections and icons stay sharp. -->
	<div class="frost-layer" aria-hidden="true">
		<span class="frost" style:width={`${frostRadius * 2}px`} style:height={`${frostRadius * 2}px`}
			style:transform={`translate3d(${frame.center.x - frostRadius}px, ${frame.center.y - frostRadius}px, 0)`}></span>
		{#each frame.drops as drop, i (i)}
			{@const dropRadius = 8 + frame.open * 16}
			<span class="frost" style:width={`${dropRadius * 2}px`} style:height={`${dropRadius * 2}px`}
				style:opacity={frame.open}
				style:transform={`translate3d(${drop.x - dropRadius}px, ${drop.y - dropRadius}px, 0)`}></span>
		{/each}
	</div>
	<canvas bind:this={lensCanvas} class="photo-lens" class:visible={lensVisible} width="160" height="160" aria-hidden="true"
		style:transform={`translate3d(${frame.center.x - 40}px, ${frame.center.y - 40}px, 0)`}></canvas>
	{#if cartDrop}
		<span class="cart-droplet" aria-hidden="true" style:transform={`translate3d(${cartDrop.x - 9}px, ${cartDrop.y - 9}px, 0) scale(${cartDrop.scale})`}></span>
	{/if}
	{#if absorption > 0}
		<span class="absorption-ring" aria-hidden="true" style:opacity={absorption * 0.45}
			style:transform={`translate(${frame.center.x - 34}px, ${frame.center.y - 34}px) scale(${1.5 - absorption * 0.5})`}></span>
	{/if}
	<canvas bind:this={canvas} class="water-surface" aria-hidden="true"
		style:width={`${SURFACE_SIZE}px`} style:height={`${SURFACE_SIZE}px`}
		style:transform={`translate3d(${frame.center.x - SURFACE_SIZE / 2}px, ${frame.center.y - SURFACE_SIZE / 2}px, 0)`}></canvas>
	<nav aria-label="Mobile navigation" onfocusout={(event) => {
		if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) close();
	}}>
		<button bind:this={trigger} class="sphere" type="button"
			disabled={!mounted}
			style:transform={`translate3d(${frame.center.x - DOCK_RADIUS}px, ${frame.center.y - DOCK_RADIUS}px, 0)`}
			aria-label={expanded ? "Close navigation" : "Open navigation"}
			aria-expanded={expanded} aria-controls="water-nav-links" aria-describedby="water-nav-help"
			onpointerdown={pointerDown} onpointermove={pointerMove}
			onpointerup={(event) => { if (pointer?.id === event.pointerId) finishPointer(false, event.timeStamp); }}
			onpointercancel={(event) => { if (pointer?.id === event.pointerId) finishPointer(true); }}
			onlostpointercapture={(event) => { if (pointer?.id === event.pointerId) finishPointer(true); }}
			oncontextmenu={(event) => event.preventDefault()}
			onkeydown={keyboardMove} onclick={activate}>
			{#if expanded}
				<XIcon size={16} strokeWidth={1.25} />
			{:else}
				<span class="inner-links" aria-hidden="true">
					{#each links as link, i (link.label)}
						{@const Icon = link.icon}
						<span class="floating-icon" style:transform={`translate(${innerIcons[i].x * Math.min(1, Math.max(0.5, (Math.min(frame.center.x, viewport.width - frame.center.x) - 8) / 30))}px, ${innerIcons[i].y * Math.min(1, Math.max(0.5, (Math.min(frame.center.y, viewport.height - frame.center.y) - 8) / 30))}px)`}>
							<Icon size={10} strokeWidth={1.3} />
						</span>
					{/each}
				</span>
			{/if}
			{#if !expanded && cart.itemCount > 0}
				<span class="cart-count">{cart.itemCount > 99 ? "99+" : cart.itemCount}</span>
			{/if}
		</button>
		<div id="water-nav-links" inert={!expanded || dragging || flying} style:opacity={frame.open > 0.55 ? (frame.open - 0.55) / 0.45 : 0}>
			{#each links as link, i (link.label)}
				{@const Icon = link.icon}
				{@const active = link.href !== null && (page.url.pathname === link.href || (link.href !== "/" && page.url.pathname.startsWith(`${link.href}/`)))}
				<div class="satellite" style:transform={`translate3d(${frame.drops[i].x - 26}px, ${frame.drops[i].y - 26}px, 0)`}>
					{#if link.href}
						<a class="destination" href={link.href} aria-current={active ? "page" : undefined} aria-label={link.label} onclick={() => close()}>
							<Icon size={18} strokeWidth={1.25} /><span class="bubble-label">{link.label}</span>
						</a>
					{:else}
						<button class="destination" type="button" aria-label={`Open cart, ${cart.itemCount} items`} onclick={() => { close(true); cartUI.open(); }}>
							<Icon size={18} strokeWidth={1.25} /><span class="bubble-label">Cart{cart.itemCount > 0 ? ` · ${cart.itemCount}` : ""}</span>
						</button>
					{/if}
				</div>
			{/each}
		</div>
	</nav>
	<p id="water-nav-help" class="sr-only">Tap to open navigation. Drag to move; release to fling. Tap a moving sphere to catch it. With keyboard focus, use arrow keys to move the sphere.</p>
	<span class="sr-only" role="status">{announcement}</span>
</div>

<style>
	.jelly-nav { position: fixed; z-index: 50; width: 0; height: 0; pointer-events: none; visibility: hidden; }
	.mounted { visibility: visible; }
	.dismiss { position: fixed; inset: 0; pointer-events: auto; border: 0; background: transparent; }
	.frost-layer { position: absolute; left: 0; top: 0; pointer-events: none; }
	.frost {
		position: absolute; left: 0; top: 0; border-radius: 50%;
		background: rgb(241 245 243 / 48%);
		backdrop-filter: blur(18px) saturate(65%);
		-webkit-backdrop-filter: blur(18px) saturate(65%);
		mask-image: radial-gradient(closest-side, #000 72%, transparent 100%);
		-webkit-mask-image: radial-gradient(closest-side, #000 72%, transparent 100%);
	}
	:global(.dark) .frost { background: rgb(24 32 34 / 60%); }
	.wake-ring, .absorption-ring { position: absolute; left: 0; top: 0; width: 60px; height: 60px; border-radius: 50%; border: 1px solid rgb(100 134 149 / 70%); box-shadow: 0 1px 2px rgb(255 255 255 / 65%); pointer-events: none; }
	.absorption-ring { width: 68px; height: 68px; }
	.cart-droplet { position: absolute; left: 0; top: 0; width: 18px; height: 18px; border-radius: 50%; background: radial-gradient(circle at 28% 22%, white, rgb(222 240 246 / 65%) 28%, rgb(138 171 183 / 55%) 70%, rgb(255 255 255 / 80%)); box-shadow: inset -1px -1px 3px rgb(68 105 119 / 40%), 0 2px 5px rgb(40 70 80 / 15%); pointer-events: none; }
	.photo-lens { position: absolute; left: 0; top: 0; width: 80px; height: 80px; border-radius: 50%; opacity: 0; transition: opacity 600ms ease; pointer-events: none; mask-image: radial-gradient(circle, black 45%, transparent 70%); }
	.photo-lens.visible { opacity: .5; }
	.dragging .photo-lens, .flying .photo-lens, .expanded .photo-lens { opacity: 0; transition: none; }
	.water-surface { opacity: 0; position: absolute; left: 0; top: 0; pointer-events: none; }
	.rendered .water-surface { opacity: 1; }
	.sphere, .destination {
		display: flex; align-items: center; justify-content: center;
		border: 0; border-radius: 50%; color: #273234;
		background: rgb(227 231 230 / 30%);
		box-shadow: inset 0 0 0 1px rgb(255 255 255 / 35%);
		backdrop-filter: blur(1px); -webkit-backdrop-filter: blur(1px);
		pointer-events: auto; cursor: pointer; text-decoration: none;
		-webkit-tap-highlight-color: transparent;
	}
	.sphere { position: absolute; left: 0; top: 0; width: 80px; height: 80px; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
	.rendered .sphere, .rendered .destination { background: transparent; box-shadow: none; backdrop-filter: none; -webkit-backdrop-filter: none; }
	.dragging .sphere { cursor: grabbing; }
	.sphere :global(*) { pointer-events: none; user-select: none; -webkit-user-select: none; }
	.inner-links { position: absolute; inset: 0; opacity: .9; }
	.floating-icon { position: absolute; left: 35px; top: 35px; width: 10px; height: 10px; }
	.satellite { position: absolute; left: 0; top: 0; width: 52px; height: 52px; }
	.destination { position: relative; width: 52px; height: 52px; }
	.bubble-label { position: absolute; top: 54px; left: -14px; width: 80px; text-align: center; font-size: 10px; letter-spacing: .035em; line-height: 16px; color: #263234; text-shadow: 0 1px 4px rgb(255 255 255 / 90%), 0 0 8px rgb(255 255 255 / 80%); }
	.bubble-label {
		left: 50%; width: max-content; max-width: 80px; padding-inline: 5px;
		transform: translateX(-50%); border-radius: 4px;
		background: rgb(241 245 243 / 78%); text-shadow: none;
		backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
	}
	.destination[aria-current="page"] .bubble-label { text-decoration: underline; text-underline-offset: 3px; }
	.sphere:focus, .sphere:focus-visible, .destination:focus, .destination:focus-visible { outline: none; }
	.cart-count { position: absolute; top: 6px; right: 4px; min-width: 17px; padding: 2px 4px; border-radius: 10px; background: #344041; color: #fff; font-size: 9px; line-height: 13px; text-align: center; }
	:global(.dark) .sphere, :global(.dark) .destination { color: #e5e9e8; }
	:global(.dark) .bubble-label { color: #edf0ef; background: rgb(24 32 34 / 82%); text-shadow: none; }
	@media (prefers-reduced-motion: reduce) { .jelly-nav * { transition: none; } }
</style>
