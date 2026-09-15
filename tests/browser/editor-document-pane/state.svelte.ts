const params = new URLSearchParams(window.location.search);
const nativeRoute = window.location.pathname.startsWith("/admin")
	? window.location.pathname
	: "/admin/editor";
export const page = $state({
	url: new URL(params.get("route") ?? nativeRoute, "https://example.invalid"),
	state: {},
});
export const navigating = $state({ to: null });
