export type AnalyticsUrlEvent = { url: string };

const PRIVATE_CAPABILITY_PATH_PATTERN = /\/(portal|delivery)\/[^/?#&\s"'<>\\]+/g;

function isPathWithin(pathname: string, prefix: string) {
	return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Browser pages whose path itself contains a private bearer capability. */
export function isPrivateCapabilityPagePath(pathname: string) {
	return isPathWithin(pathname, "/portal") || isPathWithin(pathname, "/delivery");
}

/** Responses that carry or act on a private bearer capability in their path. */
export function isPrivateCapabilityResponsePath(pathname: string) {
	return isPrivateCapabilityPagePath(pathname) || isPathWithin(pathname, "/api/portal");
}

/** Drop capability-bearing page views before Vercel Analytics sees the URL. */
export function filterPrivateCapabilityAnalytics<T extends AnalyticsUrlEvent>(event: T): T | null {
	let pathname: string;
	try {
		pathname = new URL(event.url, "https://analytics.invalid").pathname;
	} catch {
		// A malformed analytics URL is safer to drop than to forward.
		return null;
	}
	return isPrivateCapabilityPagePath(pathname) ? null : event;
}

/**
 * Replace bearer path segments while retaining a useful route label and any
 * suffix after the capability. This also catches the `/portal/<token>` segment
 * inside `/api/portal/<token>/...` action URLs.
 */
export function redactPrivateCapabilityPaths(value: string) {
	return value.replace(
		PRIVATE_CAPABILITY_PATH_PATTERN,
		(_match, route: "portal" | "delivery") => `/${route}/[redacted]`,
	);
}

function scrubTelemetryValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
	if (typeof value === "string") return redactPrivateCapabilityPaths(value);
	if (value === null || typeof value !== "object") return value;

	const prior = seen.get(value);
	if (prior !== undefined) return prior;

	if (Array.isArray(value)) {
		const scrubbed: unknown[] = [];
		seen.set(value, scrubbed);
		for (const item of value) scrubbed.push(scrubTelemetryValue(item, seen));
		return scrubbed;
	}

	// Sentry events, transactions, and breadcrumbs are normalized plain records
	// before these callbacks run. Preserve any unexpected class instance rather
	// than changing its semantics while trying to inspect private implementation.
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return value;

	const scrubbed: Record<string, unknown> = Object.create(prototype);
	seen.set(value, scrubbed);
	for (const [key, nested] of Object.entries(value)) {
		scrubbed[key] = scrubTelemetryValue(nested, seen);
	}
	return scrubbed;
}

/**
 * Pure Sentry telemetry scrubber shared by browser and server adapters.
 *
 * Scrubbing every normalized string covers direct request URLs, transaction
 * names/fields, fetch data, and navigation breadcrumbs retained from an older
 * private page and attached to a later ordinary-page error.
 */
export function scrubPrivateCapabilityTelemetry<T>(value: T): T {
	return scrubTelemetryValue(value, new WeakMap()) as T;
}
