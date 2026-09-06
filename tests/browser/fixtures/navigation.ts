export async function goto(url: string) {
	window.history.pushState({}, "", url);
}
