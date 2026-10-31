import type { BeforeNavigate } from "@sveltejs/kit";

export async function invalidateAll() {}

export function beforeNavigate(_callback: (navigation: BeforeNavigate) => void) {}
