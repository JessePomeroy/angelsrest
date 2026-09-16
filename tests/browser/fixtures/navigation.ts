export async function goto(url: string) {
	window.history.pushState({}, "", url);
}

export function afterNavigate(callback: () => void) { callback(); }

export async function invalidateAll() {}
import { page } from "./state.svelte";

export function replaceState(url: string | URL, state: Record<string, unknown>) {
	const nextUrl = new URL(url, page.url);
	page.url = nextUrl;
	page.state = state;
	// Keep the component fixture's entry point when emulating a route's URL.
	window.history.replaceState({}, "", `/${nextUrl.search}${nextUrl.hash}`);
}
