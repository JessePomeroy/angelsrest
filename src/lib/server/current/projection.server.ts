import { ConvexHttpClient } from "convex/browser";
import { getConvexUrl } from "$lib/server/runtimeConfig";

/** A published Convex read that does not satisfy its public projection contract. */
export class ProjectionError extends Error {}

/** Structural validators that reject through the caller's projection failure. */
export function projectionValidators(fail: () => never) {
	function object(
		value: unknown,
		required: readonly string[],
		optional: readonly string[] = [],
	): Record<string, unknown> {
		if (!value || typeof value !== "object" || Array.isArray(value)) fail();
		if (Object.getPrototypeOf(value) !== Object.prototype) fail();
		const keys = Reflect.ownKeys(value);
		if (keys.some((key) => typeof key !== "string")) fail();
		const allowed = new Set([...required, ...optional]);
		if (
			required.some((key) => !Object.hasOwn(value, key)) ||
			keys.some((key) => !allowed.has(key as string))
		)
			fail();
		return value as Record<string, unknown>;
	}

	function list(value: unknown, maximum: number): unknown[] {
		if (!Array.isArray(value) || value.length > maximum) fail();
		return value;
	}

	function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
		if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum)
			fail();
		return value as number;
	}

	return { object, list, integer };
}

/** A fresh unauthenticated public-content client whose requests honor `signal`. */
export function convexReadClient(signal: AbortSignal) {
	return new ConvexHttpClient(getConvexUrl(), {
		logger: false,
		fetch: (input, init) => fetch(input, { ...init, signal }),
	});
}
