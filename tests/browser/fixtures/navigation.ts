export async function goto(url: string) {
	window.history.pushState({}, "", url);
}

export function afterNavigate(callback: () => void) { callback(); }

export async function invalidateAll() {}
