import { cartUI } from "./cartUI.svelte";

type Origin = { x: number; y: number };
type Feedback = (origin: Origin, complete: () => void) => void;
let feedback: Feedback | undefined;

// The mounted liquid nav owns the optional presentation; cart data is already
// committed before this runs. Desktop/reduced-motion visitors open immediately.
export function registerCartFeedback(handler: Feedback) {
	feedback = handler;
	return () => {
		if (feedback === handler) feedback = undefined;
	};
}

export function showCartAddition(source: EventTarget | null) {
	if (!feedback || !(source instanceof HTMLElement)) {
		cartUI.open();
		return;
	}
	const box = source.getBoundingClientRect();
	let finished = false;
	const complete = () => {
		if (finished) return;
		finished = true;
		clearTimeout(timeout);
		cartUI.open();
	};
	// Feedback must never become a dependency of access to the cart.
	const timeout = setTimeout(complete, 1200);
	try {
		feedback({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, complete);
	} catch {
		complete();
	}
}
