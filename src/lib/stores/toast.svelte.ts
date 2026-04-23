/**
 * Minimal runes-based toast store (audit M16).
 *
 * Replaces blocking `alert()` calls in shop / cart / delivery with a
 * non-blocking stack of ephemeral banners. Intentionally tiny — we don't
 * need Skeleton's full headless toast store for seven call sites. The
 * `<Toaster />` component in `$lib/components/Toaster.svelte` subscribes
 * to the `.items` array and renders the stack; consumers call
 * `toasts.show(msg, { type })` to push.
 *
 * SSR-safe: the store creates no timers and mutates no state until
 * `show()` is called — which only fires from client event handlers.
 */

export type ToastType = "info" | "success" | "error";

export interface Toast {
	id: number;
	message: string;
	type: ToastType;
	createdAt: number;
}

class ToastStore {
	#nextId = 1;
	items = $state<Toast[]>([]);

	/**
	 * Push a toast onto the stack. Auto-dismisses after `duration` ms
	 * (default 4s for info/success, 6s for error — errors linger a bit).
	 */
	show(message: string, opts: { type?: ToastType; duration?: number } = {}) {
		const type = opts.type ?? "info";
		const duration = opts.duration ?? (type === "error" ? 6000 : 4000);
		const id = this.#nextId++;
		this.items = [...this.items, { id, message, type, createdAt: Date.now() }];
		setTimeout(() => {
			this.dismiss(id);
		}, duration);
		return id;
	}

	dismiss(id: number) {
		this.items = this.items.filter((t) => t.id !== id);
	}

	clear() {
		this.items = [];
	}
}

export const toasts = new ToastStore();
