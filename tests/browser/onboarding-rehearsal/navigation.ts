import { readable } from "svelte/store";
import { localNavigate, page as routeState } from "./state.svelte";
export const page = readable({ url: routeState.url });
export function goto(path: string) { localNavigate(path); return Promise.resolve(); }
export function replaceState(path: string | URL, state: Record<string, unknown>) { window.history.replaceState(state, "", path); }
export function afterNavigate(callback: () => void) { callback(); }
export function beforeNavigate() {}
export async function invalidateAll() { window.location.reload(); }
