/** A runner capability must stay within the backend's own deployed environment. */
export function hubRunnerUrl(
	configuredUrl: string | undefined,
	convexSiteUrl: string | undefined,
	path: "/api/internal/commerce-intake" | "/api/internal/print-fulfillment",
): URL {
	const origins = convexSiteUrl === "https://loyal-swan-967.convex.site"
		? ["https://angelsrest.online", "https://www.angelsrest.online"]
		: convexSiteUrl === "https://rosy-firefly-366.convex.site"
			? ["https://staging.angelsrest.online"]
			: [];
	const url = new URL(configuredUrl ?? "");
	if (!origins.includes(url.origin) || url.pathname !== path
		|| url.search || url.hash || url.username || url.password) {
		throw new Error("Hub runner destination is invalid");
	}
	return url;
}
