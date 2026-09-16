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
export function afterNavigate(callback: () => void) { callback(); }
export function beforeNavigate() {}
export async function invalidateAll() {}
