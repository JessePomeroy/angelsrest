import { env } from "$env/dynamic/private";
import type { CheckoutSnapshotItem } from "$lib/server/checkoutCatalog";

const PATHS = {
	checkout: "/commerce/catalog/checkout/resolve",
	paid_fulfillment: "/commerce/catalog/paid-fulfillment/resolve",
	paid_download: "/commerce/catalog/paid-download/resolve",
	print_source: "/v1/catalog-assets/fulfillment/print-source/capabilities",
	paid_file: "/v1/catalog-assets/fulfillment/paid-file/capabilities",
} as const;
const PAID_KEYS = "version purpose item identity commerce media current descriptor".split(" ");
const SOURCE_KEYS = "memberKey relationKey key mime bytes hash dimensions".split(" ");
const FILE_KEYS = "kind relationKey key mime bytes hash filename version".split(" ");
const token68 = /^[A-Za-z0-9._~+/-]{32,512}$/;
const sha256 = /^[a-f0-9]{64}$/;
const PRINT_SOURCE_DIMENSION_MAX = 100_000;
const capabilityToken = /^[A-Za-z0-9_-]+$/;
const CAPABILITY_TOKEN_MIN_BYTES = 12 + 16;
const CAPABILITY_TOKEN_MAX_BYTES = 720;
const CAPABILITY_FUTURE_SKEW_MS = 60_000;
const PRINT_CAPABILITY_TTL_MS = 24 * 60 * 60 * 1000;
const PRINT_CAPABILITY_MIN_REMAINING_MS = PRINT_CAPABILITY_TTL_MS - 60 * 60 * 1000;
const PAID_CAPABILITY_TTL_MS = 15 * 60 * 1000;

type Config = {
	origin?: string;
	bearer?: string;
	fetch?: typeof globalThis.fetch;
	signal?: AbortSignal;
};
type Descriptor = { key: string; hash: string; bytes: number; mime: string };
export type PrintSourceDescriptor = Descriptor & {
	mime: "image/jpeg" | "image/png";
	dimensions: { width: number; height: number };
};
type Finish = {
	paper: { subcategoryId: number };
	size: { width: number; height: number };
	border: { inches: number };
	frame: { subcategoryId: number };
	canvas: null | { subcategoryId: number; wrapHex: string };
};
export type PaidFulfillmentResolution = {
	item: CheckoutSnapshotItem;
	identity: { productKind: string };
	commerce: { finish: Finish | null };
	descriptor:
		| {
				kind: "print_sources";
				sources: Array<PrintSourceDescriptor & { memberKey: string | null }>;
		  }
		| ({ kind: "paid_zip" } & Descriptor)
		| { kind: "merchant" };
};

export type CatalogBoundaryPhase =
	| "configuration"
	| "fetch"
	| "status"
	| "content_type"
	| "content_encoding"
	| "declared_length"
	| "stream"
	| "utf8"
	| "json"
	| "envelope";

export class CatalogBoundaryError extends Error {
	constructor(
		readonly kind: "unavailable" | "rejected" | "refunded",
		readonly phase: CatalogBoundaryPhase = "configuration",
	) {
		super(`Catalog boundary ${kind}`);
	}
}
const rejected = (phase: CatalogBoundaryPhase = "envelope") =>
	new CatalogBoundaryError("rejected", phase);
function object(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: string[]) {
	return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}
function validDescriptor(value: unknown): value is Descriptor {
	return (
		object(value) &&
		typeof value.key === "string" &&
		typeof value.hash === "string" &&
		sha256.test(value.hash) &&
		Number.isSafeInteger(value.bytes) &&
		Number(value.bytes) > 0 &&
		typeof value.mime === "string"
	);
}
function positiveSourceDimension(value: unknown) {
	return (
		Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= PRINT_SOURCE_DIMENSION_MAX
	);
}
export function isPrintSourceDescriptor(value: unknown): value is PrintSourceDescriptor {
	if (!validDescriptor(value) || (value.mime !== "image/jpeg" && value.mime !== "image/png")) {
		return false;
	}
	const dimensions = (value as Descriptor & { dimensions?: unknown }).dimensions;
	return (
		object(dimensions) &&
		exact(dimensions, ["width", "height"]) &&
		positiveSourceDimension(dimensions.width) &&
		positiveSourceDimension(dimensions.height)
	);
}

function endpoint({ origin, bearer }: Config, path: string) {
	if (!origin || !bearer || !token68.test(bearer)) throw new CatalogBoundaryError("unavailable");
	try {
		const parsed = new URL(origin);
		if (parsed.protocol !== "https:" || parsed.origin !== origin || parsed.href !== `${origin}/`)
			throw rejected();
	} catch {
		throw new CatalogBoundaryError("unavailable");
	}
	return `${origin}${path}`;
}
async function readJson(response: Response) {
	if (response.headers.get("content-type") !== "application/json") throw rejected("content_type");
	const contentEncoding = response.headers.get("content-encoding")?.toLowerCase() ?? null;
	const compressed =
		contentEncoding === "gzip" || contentEncoding === "br" || contentEncoding === "deflate";
	if (contentEncoding !== null && contentEncoding !== "identity" && !compressed)
		throw rejected("content_encoding");
	const declared = response.headers.get("content-length");
	if (
		declared !== null &&
		(!/^\d+$/.test(declared) || (!compressed && Number(declared) > 64 * 1024))
	) {
		throw rejected("declared_length");
	}
	const reader = response.body?.getReader();
	if (!reader) throw rejected("stream");
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > 64 * 1024) {
				try {
					void reader.cancel().catch(() => undefined);
				} catch {
					// Cancellation is best-effort cleanup. Preserve the boundary rejection.
				}
				throw rejected("stream");
			}
			chunks.push(value);
		}
	} catch (error) {
		if (error instanceof CatalogBoundaryError) throw error;
		throw new CatalogBoundaryError("unavailable", "stream");
	}
	if (!compressed && declared !== null && Number(declared) !== total)
		throw rejected("declared_length");
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	let decoded: string;
	try {
		decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw rejected("utf8");
	}
	try {
		return JSON.parse(decoded) as unknown;
	} catch {
		throw rejected("json");
	}
}
async function post(config: Config, purpose: keyof typeof PATHS, body: unknown) {
	const encoded = JSON.stringify(body);
	if (new TextEncoder().encode(encoded).byteLength > 4096) throw rejected();
	const url = endpoint(config, PATHS[purpose]);
	let response: Response;
	try {
		response = await (config.fetch ?? fetch)(url, {
			method: "POST",
			headers: { Authorization: `Bearer ${config.bearer}`, "Content-Type": "application/json" },
			body: encoded,
			signal: config.signal
				? AbortSignal.any([config.signal, AbortSignal.timeout(5_000)])
				: AbortSignal.timeout(5_000),
		});
	} catch {
		throw new CatalogBoundaryError("unavailable", "fetch");
	}
	if (!response.ok)
		throw new CatalogBoundaryError(
			response.status === 503 ? "unavailable" : response.status === 409 ? "refunded" : "rejected",
			"status",
		);
	return readJson(response);
}

function parsePaid(value: unknown, purpose: "paid_fulfillment" | "paid_download") {
	if (
		!object(value) ||
		!exact(value, PAID_KEYS) ||
		value.version !== 1 ||
		value.purpose !== purpose ||
		!object(value.item) ||
		!object(value.identity) ||
		typeof value.identity.productKind !== "string" ||
		!object(value.commerce) ||
		!object(value.descriptor)
	)
		throw rejected();
	const descriptor = value.descriptor;
	if (descriptor.kind === "print_sources") {
		if (
			!Array.isArray(descriptor.sources) ||
			descriptor.sources.length < 1 ||
			descriptor.sources.length > 20
		)
			throw rejected();
		for (const source of descriptor.sources) {
			if (!object(source) || !exact(source, SOURCE_KEYS) || !isPrintSourceDescriptor(source))
				throw rejected();
		}
	} else if (descriptor.kind === "paid_zip") {
		if (!exact(descriptor, FILE_KEYS) || !validDescriptor(descriptor)) throw rejected();
	} else if (descriptor.kind !== "merchant" || !exact(descriptor, ["kind", "source"]))
		throw rejected();
	return value as unknown as PaidFulfillmentResolution;
}

type CommercePurpose = "checkout" | "paid_fulfillment" | "paid_download";
type IssuerPurpose = "print_source" | "paid_file";
function configured(purpose: CommercePurpose | IssuerPurpose): Config {
	const commerceOrigin = env.CATALOG_COMMERCE_RESOLVER_ORIGIN;
	const workerOrigin = env.CATALOG_FULFILLMENT_WORKER_ORIGIN;
	switch (purpose) {
		case "checkout":
			return { origin: commerceOrigin, bearer: env.CATALOG_COMMERCE_CHECKOUT_RESOLVER_SECRET };
		case "paid_fulfillment":
			return {
				origin: commerceOrigin,
				bearer: env.CATALOG_COMMERCE_PAID_FULFILLMENT_RESOLVER_SECRET,
			};
		case "paid_download":
			return { origin: commerceOrigin, bearer: env.CATALOG_COMMERCE_PAID_DOWNLOAD_RESOLVER_SECRET };
		case "print_source":
			return { origin: workerOrigin, bearer: env.CATALOG_PRINT_SOURCE_ISSUER_SECRET };
		case "paid_file":
			return { origin: workerOrigin, bearer: env.CATALOG_PAID_DOWNLOAD_ISSUER_SECRET };
	}
}
async function resolve(purpose: CommercePurpose, input: object, config = configured(purpose)) {
	const value = await post(config, purpose, { version: 1, ...input });
	if (!object(value) || value.version !== 1 || value.purpose !== purpose) throw rejected();
	return value;
}
export async function resolveCatalogCheckout(
	item: CheckoutSnapshotItem,
	config?: Config | AbortSignal,
) {
	const selected =
		config instanceof AbortSignal ? { ...configured("checkout"), signal: config } : config;
	const value = await resolve("checkout", { item }, selected);
	if (!exact(value, "version purpose item identity commerce media".split(" "))) throw rejected();
	return value;
}
export async function resolvePaidFulfillment(
	stripeSessionId: string,
	itemIndex: number,
	config?: Config,
) {
	return parsePaid(
		await resolve("paid_fulfillment", { stripeSessionId, itemIndex }, config),
		"paid_fulfillment",
	);
}
export async function resolvePaidDownload(
	stripeSessionId: string,
	itemIndex: number,
	config?: Config,
) {
	const value = parsePaid(
		await resolve("paid_download", { stripeSessionId, itemIndex }, config),
		"paid_download",
	);
	if (value.descriptor.kind !== "paid_zip") throw rejected();
	return value;
}
function canonicalCapabilityToken(token: string) {
	if (
		!capabilityToken.test(token) ||
		token.length > Math.ceil((CAPABILITY_TOKEN_MAX_BYTES * 4) / 3)
	)
		return false;
	let binary: string;
	try {
		binary = atob(
			token.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (token.length % 4)) % 4),
		);
	} catch {
		return false;
	}
	if (binary.length < CAPABILITY_TOKEN_MIN_BYTES || binary.length > CAPABILITY_TOKEN_MAX_BYTES)
		return false;
	let encoded = "";
	for (let index = 0; index < binary.length; index += 1) {
		encoded += String.fromCharCode(binary.charCodeAt(index));
	}
	return btoa(encoded).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "") === token;
}

function capabilityPath(purpose: IssuerPurpose, mime: string, pathname: string) {
	const extension =
		purpose === "print_source"
			? mime === "image/jpeg"
				? "jpg"
				: mime === "image/png"
					? "png"
					: null
			: mime === "application/zip"
				? "zip"
				: null;
	if (!extension) return false;
	const prefix =
		purpose === "print_source"
			? "/v1/catalog-assets/fulfillment/print-source/"
			: "/v1/catalog-assets/fulfillment/paid-file/";
	if (!pathname.startsWith(prefix) || !pathname.endsWith(`.${extension}`)) return false;
	const token = pathname.slice(prefix.length, -(extension.length + 1));
	return canonicalCapabilityToken(token);
}

async function issue(purpose: IssuerPurpose, value: Descriptor, config = configured(purpose)) {
	if (
		(purpose === "print_source" && !isPrintSourceDescriptor(value)) ||
		(purpose === "paid_file" && !validDescriptor(value))
	)
		throw rejected();
	const result = await post(config, purpose, {
		version: 1,
		key: value.key,
		hash: value.hash,
		bytes: value.bytes,
		mime: value.mime,
	});
	if (
		!object(result) ||
		!exact(result, ["version", "url", "expiresAt"]) ||
		result.version !== 1 ||
		typeof result.url !== "string" ||
		result.url.length > 1024 ||
		typeof result.expiresAt !== "string" ||
		!Number.isFinite(Date.parse(result.expiresAt)) ||
		new Date(result.expiresAt).toISOString() !== result.expiresAt
	)
		throw rejected();
	const expiresAt = Date.parse(result.expiresAt);
	const now = Date.now();
	const maximumLifetime =
		purpose === "print_source" ? PRINT_CAPABILITY_TTL_MS : PAID_CAPABILITY_TTL_MS;
	if (
		expiresAt <= now ||
		(purpose === "print_source" && expiresAt - now < PRINT_CAPABILITY_MIN_REMAINING_MS) ||
		expiresAt > now + maximumLifetime + CAPABILITY_FUTURE_SKEW_MS
	) {
		throw rejected();
	}
	try {
		const capability = new URL(result.url);
		if (
			!config.origin ||
			capability.href !== result.url ||
			capability.origin !== config.origin ||
			capability.protocol !== "https:" ||
			capability.username ||
			capability.password ||
			capability.search ||
			capability.hash ||
			!capabilityPath(purpose, value.mime, capability.pathname)
		)
			throw rejected();
	} catch {
		throw rejected();
	}
	return result.url;
}
export const issuePrintSource = (value: PrintSourceDescriptor, config?: Config) =>
	issue("print_source", value, config);
export const issuePaidFile = (value: Descriptor, config?: Config) =>
	issue("paid_file", value, config);
