import { env as publicEnv } from "$env/dynamic/public";
import { getCheckoutSnapshotReservationCredential } from "$lib/server/checkoutBridgeConfig";
import type { CheckoutSnapshotItem } from "$lib/server/checkoutCatalog";

const RESERVE_PATH = "/commerce/checkout-snapshots/reserve";
const BIND_PATH = "/commerce/checkout-snapshots/bind";
const REQUEST_MAX_BYTES = 64 * 1024;
const RESPONSE_MAX_BYTES = 2 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const encoder = new TextEncoder();

export interface CheckoutSnapshotReservationClient {
	reserve(input: {
		tenantId?: string;
		site: string;
		attempt: string;
		account: string | null;
		catalogProvider: "convex";
		items: readonly CheckoutSnapshotItem[];
	}): Promise<{ handle: string }>;
	bind(input: {
		tenantId?: string;
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
	timeoutMs = REQUEST_TIMEOUT_MS,
}: {
	baseUrl?: string;
	fetcher?: typeof fetch;
	credential?: (site: string) => string;
	timeoutMs?: number;
} = {}): CheckoutSnapshotReservationClient {
	const origin = reservationOrigin(baseUrl);

	async function post(path: string, site: string, body: unknown) {
		const serialized = JSON.stringify(body);
		if (encoder.encode(serialized).byteLength > REQUEST_MAX_BYTES) throw unavailable();
		try {
			const response = await fetcher(`${origin}${path}`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${credential(site)}`,
					"Content-Type": "application/json",
				},
				body: serialized,
				signal: AbortSignal.timeout(timeoutMs),
			});
			const declaredLength = Number(response.headers.get("Content-Length"));
			if (Number.isFinite(declaredLength) && declaredLength > RESPONSE_MAX_BYTES)
				throw unavailable();
			const text = await readBoundedResponse(response);
			if (response.status === 409) throw new ReservationConflict();
			if (!response.ok) throw unavailable();
			return JSON.parse(text) as unknown;
		} catch (error) {
			if (error instanceof ReservationConflict) throw error;
			throw unavailable();
		}
	}

	return {
		async reserve({ tenantId, site, attempt, account, catalogProvider, items }) {
			const response = await post(RESERVE_PATH, site, {
				version: 1,
				site,
				...(tenantId ? { tenantId } : {}),
				attempt,
				account,
				snapshot: { schemaVersion: 1, catalogProvider, items },
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
		async bind({ tenantId, site, handle, account, session, stripeExpiresAt }) {
			const response = await post(BIND_PATH, site, {
				version: 1,
				site,
				...(tenantId ? { tenantId } : {}),
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

async function readBoundedResponse(response: Response) {
	const reader = response.body?.getReader();
	if (!reader) return "";
	const bytes = new Uint8Array(RESPONSE_MAX_BYTES);
	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) return new TextDecoder().decode(bytes.subarray(0, size));
		if (size + value.byteLength > RESPONSE_MAX_BYTES) {
			await reader.cancel();
			throw unavailable();
		}
		bytes.set(value, size);
		size += value.byteLength;
	}
}

class ReservationConflict extends Error {}

export function isCheckoutSnapshotReservationConflict(error: unknown) {
	return error instanceof ReservationConflict;
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
