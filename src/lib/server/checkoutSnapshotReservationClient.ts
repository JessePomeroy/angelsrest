import { env as publicEnv } from "$env/dynamic/public";
import { getCheckoutSnapshotReservationCredential } from "$lib/server/checkoutBridgeConfig";
import type { CheckoutSnapshotItem } from "$lib/server/checkoutCatalog";
import {
	checkoutHttpOrigin,
	CHECKOUT_REQUEST_MAX_BYTES as REQUEST_MAX_BYTES,
	CHECKOUT_REQUEST_TIMEOUT_MS as REQUEST_TIMEOUT_MS,
	CHECKOUT_RESPONSE_MAX_BYTES as RESPONSE_MAX_BYTES,
	readCheckoutHttpResponse,
} from "$lib/server/checkoutHttp";
import {
	type LumaPrintsConnection,
	parseLumaPrintsConnection,
} from "$lib/server/lumaprintsConnections";

const RESERVE_PATH = "/commerce/checkout-snapshots/reserve";
const BIND_PATH = "/commerce/checkout-snapshots/bind";
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
		printInputVersion?: 1;
		lumaprintsConnectionVersion?: 1;
	}): Promise<{ handle: string; lumaprintsConnection?: LumaPrintsConnection | null }>;
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
	const origin = checkoutHttpOrigin(baseUrl, unavailable);

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
			const text = await readCheckoutHttpResponse(response, unavailable);
			if (response.status === 409) throw new ReservationConflict();
			if (!response.ok) throw unavailable();
			return JSON.parse(text) as unknown;
		} catch (error) {
			if (error instanceof ReservationConflict) throw error;
			throw unavailable();
		}
	}

	return {
		async reserve({
			tenantId,
			site,
			attempt,
			account,
			catalogProvider,
			items,
			printInputVersion,
			lumaprintsConnectionVersion,
		}) {
			if (lumaprintsConnectionVersion === 1 && (!tenantId || !account || printInputVersion !== 1))
				throw unavailable();
			const response = await post(RESERVE_PATH, site, {
				version: 1,
				site,
				...(tenantId === undefined ? {} : { tenantId }),
				attempt,
				account,
				snapshot: { schemaVersion: 1, catalogProvider, items },
				...(printInputVersion === undefined ? {} : { printInputVersion }),
				...(lumaprintsConnectionVersion === undefined ? {} : { lumaprintsConnectionVersion }),
			});
			const capturesSupplier = lumaprintsConnectionVersion === 1;
			if (
				!exactRecord(response, [
					"version",
					"handle",
					"replayed",
					...(capturesSupplier ? ["lumaprintsConnection"] : []),
				])
			)
				throw unavailable();
			if (
				response.version !== (capturesSupplier ? 3 : 2) ||
				!UUID_V4.test(String(response.handle)) ||
				typeof response.replayed !== "boolean"
			)
				throw unavailable();
			if (capturesSupplier) {
				try {
					const connection =
						response.lumaprintsConnection === null
							? null
							: parseLumaPrintsConnection(response.lumaprintsConnection);
					if (connection && connection.tenantId !== tenantId) throw unavailable();
					return { handle: String(response.handle), lumaprintsConnection: connection };
				} catch {
					throw unavailable();
				}
			}
			return { handle: String(response.handle) };
		},
		async bind({ tenantId, site, handle, account, session, stripeExpiresAt }) {
			const response = await post(BIND_PATH, site, {
				version: 1,
				site,
				...(tenantId === undefined ? {} : { tenantId }),
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
