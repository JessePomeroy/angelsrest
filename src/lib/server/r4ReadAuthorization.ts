import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "$env/dynamic/private";
import { verifySiteAdminRequest } from "$lib/server/siteAdminAuthorization";

const MAX_CLOCK_SKEW_SECONDS = 300;
const SIGNATURE_DOMAIN = "angels-rest-r4-read-v1";

export const r4ReadPurposes = {
	checkoutCatalogSentinel: "r4-checkout-catalog-sentinel-v1",
	closureState: "r4-closure-state-v1",
	shopCatalogSentinel: "r4-shop-catalog-sentinel-v1",
} as const;

export type R4ReadPurpose = (typeof r4ReadPurposes)[keyof typeof r4ReadPurposes];

const contracts: Record<
	R4ReadPurpose,
	{ method: "GET" | "POST"; pathname: string; contentType: string | null; maxBodyBytes: number }
> = {
	[r4ReadPurposes.checkoutCatalogSentinel]: {
		method: "POST",
		pathname: "/api/admin/commerce/catalog-sentinel",
		contentType: "application/json",
		maxBodyBytes: 96,
	},
	[r4ReadPurposes.closureState]: {
		method: "GET",
		pathname: "/api/admin/commerce/closure-state",
		contentType: null,
		maxBodyBytes: 0,
	},
	[r4ReadPurposes.shopCatalogSentinel]: {
		method: "GET",
		pathname: "/api/admin/commerce/shop-catalog-sentinel",
		contentType: null,
		maxBodyBytes: 0,
	},
};

export type R4ReadAuthorization = { rawBody: string };

/**
 * Authorize one bounded R4 read through either the normal stored-membership
 * path or a fresh server HMAC. Machine signatures bind the unique purpose,
 * exact method/path, SHA-256 of the exact bounded body, and timestamp.
 */
export async function authorizeR4ReadRequest(
	request: Request,
	purpose: R4ReadPurpose,
): Promise<R4ReadAuthorization | null> {
	const contract = contracts[purpose];
	const url = new URL(request.url);
	if (
		request.method !== contract.method ||
		url.pathname !== contract.pathname ||
		url.search !== "" ||
		url.hash !== "" ||
		request.headers.get("content-type") !== contract.contentType
	) {
		return null;
	}
	const rawBody = await boundedBody(request, contract.maxBodyBytes);
	if (rawBody === null) return null;
	if (await verifySiteAdminRequest(request)) return { rawBody };
	return verifyR4ReadHmac(request, purpose, rawBody) ? { rawBody } : null;
}

export function verifyR4ReadHmac(
	request: Request,
	purpose: R4ReadPurpose,
	rawBody: string,
	nowMs = Date.now(),
) {
	const secret = env.WEBHOOK_SECRET;
	if (!secret) return false;
	const timestampText = request.headers.get("x-r4-timestamp");
	const supplied = request.headers.get("x-r4-signature");
	if (
		!timestampText ||
		!supplied ||
		!/^\d{10}$/.test(timestampText) ||
		!/^[0-9a-f]{64}$/.test(supplied)
	) {
		return false;
	}
	const timestamp = Number(timestampText);
	const nowSeconds = Math.floor(nowMs / 1_000);
	if (
		!Number.isSafeInteger(timestamp) ||
		!Number.isSafeInteger(nowSeconds) ||
		Math.abs(nowSeconds - timestamp) > MAX_CLOCK_SKEW_SECONDS
	) {
		return false;
	}
	const message = signatureMessage(request, purpose, rawBody, timestampText);
	const expected = createHmac("sha256", secret).update(message).digest();
	return timingSafeEqual(expected, Buffer.from(supplied, "hex"));
}

export function r4ReadSignatureMessage(
	request: Request,
	purpose: R4ReadPurpose,
	rawBody: string,
	timestampText: string,
) {
	return signatureMessage(request, purpose, rawBody, timestampText);
}

function signatureMessage(
	request: Request,
	purpose: R4ReadPurpose,
	rawBody: string,
	timestampText: string,
) {
	const bodyHash = createHash("sha256").update(rawBody).digest("hex");
	return [
		SIGNATURE_DOMAIN,
		purpose,
		request.method,
		new URL(request.url).pathname,
		bodyHash,
		timestampText,
	].join("\n");
}

async function boundedBody(request: Request, maximumBytes: number): Promise<string | null> {
	const declared = request.headers.get("content-length");
	if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes))
		return null;
	if (!request.body) return "";
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maximumBytes) {
				void reader.cancel().catch(() => undefined);
				return null;
			}
			chunks.push(value);
		}
	} catch {
		return null;
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return null;
	}
}
