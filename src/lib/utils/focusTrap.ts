/**
 * Focus-trap helper (audit M6).
 *
 * Call this from a `keydown` handler on a modal/dialog-style container so
 * that Tab / Shift+Tab wrap within the container instead of escaping to
 * the rest of the document.
 *
 * Returns `true` if the event was a Tab that wrapped focus (caller may
 * skip further handling); returns `false` otherwise — including plain
 * Tab navigation that stayed inside the container.
 *
 * The default selector covers the standard focusable controls for
 * typical modal UIs (links, buttons, tabindex-0 elements, form
 * controls). Pass a narrower selector if a container has unusual
 * focusables or you want to exclude some by role.
 */
export const DEFAULT_FOCUSABLE_SELECTOR =
	'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

export function trapFocus(
	event: KeyboardEvent,
	container: HTMLElement,
	selector: string = DEFAULT_FOCUSABLE_SELECTOR,
): boolean {
	if (event.key !== "Tab") return false;
	const focusable = container.querySelectorAll<HTMLElement>(selector);
	if (focusable.length === 0) return false;
	const first = focusable[0];
	const last = focusable[focusable.length - 1];
	if (event.shiftKey && document.activeElement === first) {
		event.preventDefault();
		last.focus();
		return true;
	}
	if (!event.shiftKey && document.activeElement === last) {
		event.preventDefault();
		first.focus();
		return true;
	}
	return false;
}
