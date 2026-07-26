import { env as publicEnv } from "$env/dynamic/public";
import { getCheckoutSnapshotReservationCredential } from "$lib/server/checkoutBridgeConfig";
import type { CheckoutSnapshotItem } from "$lib/server/checkoutCatalog";

const RESERVE_PATH = "/commerce/checkout-snapshots/reserve";
const BIND_PATH = "/commerce/checkout-snapshots/bind";
const REQUEST_MAX_BYTES = 64 * 1024;
const RESPONSE_MAX_BYTES = 2 * 1024;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const encoder = new TextEncoder();

export interface CheckoutSnapshotReservationClient {
	reserve(input: {
		site: string;
		attempt: string;
		account: string | null;
		items: readonly CheckoutSnapshotItem[];
	}): Promise<{ handle: string }>;
	bind(input: {
		site: string;
		handle: string;
		account: string | null;
		session: string;
		stripeExpiresAt: number;
	}): Promise<void>;
}

export function createCheckoutSnapshotReservationClient({
	baseUrl = publicEnv.PUBLIC_CONVEX_SITE_URL,
	fetcher = fetch,
	credential = getCheckoutSnapshotReservationCredential,
}: {
	baseUrl?: string;
	fetcher?: typeof fetch;
	credential?: (site: string) => string;
} = {}): CheckoutSnapshotReservationClient {
	const origin = reservationOrigin(baseUrl);

	async function post(path: string, site: string, body: unknown) {
		const serialized = JSON.stringify(body);
		if (encoder.encode(serialized).byteLength > REQUEST_MAX_BYTES) throw unavailable();
		let response: Response;
		try {
			response = await fetcher(`${origin}${path}`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${credential(site)}`,
					"Content-Type": "application/json",
				},
				body: serialized,
			});
		} catch {
			throw unavailable();
		}
		const declaredLength = Number(response.headers.get("Content-Length"));
		if (Number.isFinite(declaredLength) && declaredLength > RESPONSE_MAX_BYTES) throw unavailable();
		let text: string;
		try {
			text = await response.text();
		} catch {
			throw unavailable();
		}
		if (!response.ok || encoder.encode(text).byteLength > RESPONSE_MAX_BYTES) throw unavailable();
		try {
			return JSON.parse(text) as unknown;
		} catch {
			throw unavailable();
		}
	}

	return {
		async reserve({ site, attempt, account, items }) {
			const response = await post(RESERVE_PATH, site, {
				version: 1,
				site,
				attempt,
				account,
				snapshot: { schemaVersion: 1, catalogProvider: "sanity", items },
			});
			if (!exactRecord(response, ["version", "handle", "replayed"])) throw unavailable();
			if (
				response.version !== 2 ||
				!UUID_V4.test(String(response.handle)) ||
				typeof response.replayed !== "boolean"
			)
				throw unavailable();
			return { handle: String(response.handle) };
		},
		async bind({ site, handle, account, session, stripeExpiresAt }) {
			const response = await post(BIND_PATH, site, {
				version: 1,
				site,
				handle,
				account,
				session,
				stripeExpiresAt,
			});
			if (
				!exactRecord(response, ["bound", "replayed"]) ||
				response.bound !== true ||
				typeof response.replayed !== "boolean"
			)
				throw unavailable();
		},
	};
}

function reservationOrigin(value: string | undefined) {
	try {
		const url = new URL(value ?? "");
		if (
			url.protocol !== "https:" ||
			url.username ||
			url.password ||
			url.pathname !== "/" ||
			url.search ||
			url.hash
		)
			throw unavailable();
		return url.origin;
	} catch {
		throw unavailable();
	}
}

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
	return (
		!!value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.keys(value).length === keys.length &&
		keys.every((key) => Object.hasOwn(value, key))
	);
}

function unavailable() {
	return new Error("Checkout reservation is unavailable");
}
