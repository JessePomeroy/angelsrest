const params = new URLSearchParams(window.location.search);
export const page = $state({
	url: new URL(params.get("route") ?? "/admin", "https://example.invalid"),
	state: {},
});
export const navigating = $state({ to: null });
