import { readable } from "svelte/store";
import { page as routeState } from "./state.svelte";

export const page = readable({ url: routeState.url });
export function replaceState(href: string | URL, state: Record<string, unknown>) {
	routeState.url = new URL(href, routeState.url);
	routeState.state = state;
}
export async function goto(href: string) {
	const route = new URL(href, routeState.url);
	if (route.origin !== "https://example.invalid" || !route.pathname.startsWith("/admin")) {
		throw new Error("The handbook fixture only navigates between local admin examples.");
	}
	const fixture = new URL(window.location.href);
	fixture.searchParams.set("route", route.pathname + route.search);
	window.location.assign(fixture);
}

export function installPreviewLinks() {
	const navigate = (event: MouseEvent) => {
		if (
			event.defaultPrevented ||
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		)
			return;
		const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
		if (
			!(link instanceof HTMLAnchorElement) ||
			link.download ||
			(link.target && link.target !== "_self")
		)
			return;
		const destination = new URL(link.href);
		if (
			destination.origin !== window.location.origin ||
			!/^\/admin(?:\/|$)/.test(destination.pathname)
		)
			return;
		event.preventDefault();
		void goto(destination.pathname + destination.search);
	};
	document.addEventListener("click", navigate);
	return () => document.removeEventListener("click", navigate);
}
export function afterNavigate(callback: () => void) {
	callback();
}
export function beforeNavigate() {}
export async function invalidateAll() {}
