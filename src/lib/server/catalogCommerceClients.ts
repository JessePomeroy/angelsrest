import {
	FRAMED_BORDER_INCHES,
	getBorder,
	getFrame,
	getPaper,
	getSize,
	getWholesaleCost,
	parseCanvasSlug,
} from "@jessepomeroy/print-catalog";
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
const ITEM_KEYS =
	"productKey revisionId productKind variantKey materialOptionKey sizeOptionKey borderOptionKey frameOptionKey".split(
		" ",
	);
const IDENTITY_KEYS = "productId revisionId productKind title slug variantKey".split(" ");
const COMMERCE_KEYS = "currency amountCents finish".split(" ");
const FINISH_KEYS = "materialKey sizeKey borderKey frameKey paper size border frame canvas".split(
	" ",
);
const CURRENT_KEYS = "kindEnabled publishedRevision slugMatches available variantEnabled".split(
	" ",
);
const SOURCE_KEYS = "memberKey relationKey key mime bytes hash dimensions".split(" ");
const FILE_KEYS = "kind relationKey key mime bytes hash filename version".split(" ");
const token68 = /^[A-Za-z0-9._~+/-]{32,512}$/;
const sha256 = /^[a-f0-9]{64}$/;
const sixDigitHex = /^#[0-9A-Fa-f]{6}$/;
const PRINT_SOURCE_DIMENSION_MAX = 100_000;
const PRINT_SOURCE_BYTES_MAX = 100_000_000;
const PAID_FILE_BYTES_MAX = 16 * 1024 * 1024;
const capabilityToken = /^[A-Za-z0-9_-]+$/;
const CAPABILITY_TOKEN_MIN_BYTES = 12 + 16;
const CAPABILITY_TOKEN_MAX_BYTES = 720;
const CAPABILITY_FUTURE_SKEW_MS = 60_000;
const PRINT_CAPABILITY_TTL_MS = 24 * 60 * 60 * 1000;
const PRINT_CAPABILITY_MIN_REMAINING_MS = PRINT_CAPABILITY_TTL_MS - 60 * 60 * 1000;
const PAID_CAPABILITY_TTL_MS = 15 * 60 * 1000;
const CATALOG_RESPONSE_BODY_MAX_BYTES = 64 * 1024;

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
	materialKey: string;
	sizeKey: string;
	borderKey: string | null;
	frameKey: string | null;
	paper: { name: string; subcategoryId: number };
	size: { label: string; width: number; height: number };
	border: { inches: number };
	frame: { subcategoryId: number };
	canvas: null | {
		color: "black" | "white";
		thickness: string;
		subcategoryId: number;
		wrapOptionId: number;
		wrapHex: string;
	};
};
export type PaidFulfillmentResolution = {
	item: CheckoutSnapshotItem;
	identity: {
		productId: string;
		revisionId: string;
		productKind: CheckoutSnapshotItem["productKind"];
		title: string;
		slug: string;
		variantKey: string | null;
	};
	commerce: { currency: "usd"; amountCents: number; finish: Finish | null };
	current: {
		kindEnabled: boolean;
		publishedRevision: boolean;
		slugMatches: boolean;
		available: boolean;
		variantEnabled: boolean;
	};
	descriptor:
		| {
				kind: "print_sources";
				sources: Array<PrintSourceDescriptor & { memberKey: string | null; relationKey: string }>;
		  }
		| (Descriptor & {
				kind: "paid_zip";
				relationKey: string;
				filename: string;
				version: string | null;
		  })
		| { kind: "merchant"; source: null };
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
function boundedString(value: unknown, maximum: number): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= maximum;
}
function parseDescriptor(value: unknown, maximumBytes: number): Descriptor | null {
	if (!object(value)) return null;
	return boundedString(value.key, 1_024) &&
		typeof value.hash === "string" &&
		sha256.test(value.hash) &&
		Number.isSafeInteger(value.bytes) &&
		Number(value.bytes) > 0 &&
		Number(value.bytes) <= maximumBytes &&
		boundedString(value.mime, 100)
		? { key: value.key, hash: value.hash, bytes: Number(value.bytes), mime: value.mime }
		: null;
}
function positiveSourceDimension(value: unknown) {
	return (
		Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= PRINT_SOURCE_DIMENSION_MAX
	);
}
export function isPrintSourceDescriptor(value: unknown): value is PrintSourceDescriptor {
	if (!object(value) || (value.mime !== "image/jpeg" && value.mime !== "image/png")) {
		return false;
	}
	if (!parseDescriptor(value, PRINT_SOURCE_BYTES_MAX)) return false;
	const dimensions = value.dimensions;
	return (
		object(dimensions) &&
		exact(dimensions, ["width", "height"]) &&
		positiveSourceDimension(dimensions.width) &&
		positiveSourceDimension(dimensions.height)
	);
}

function productKind(value: unknown): value is CheckoutSnapshotItem["productKind"] {
	return (
		value === "print" ||
		value === "print_set" ||
		value === "postcard" ||
		value === "tapestry" ||
		value === "digital_download" ||
		value === "merchandise"
	);
}

function nullableKey(value: unknown): value is string | null {
	return value === null || boundedString(value, 128);
}

function parseItem(value: unknown): CheckoutSnapshotItem | null {
	if (
		!object(value) ||
		!exact(value, ITEM_KEYS) ||
		!boundedString(value.productKey, 128) ||
		!boundedString(value.revisionId, 128) ||
		!productKind(value.productKind) ||
		!nullableKey(value.variantKey) ||
		!nullableKey(value.materialOptionKey) ||
		!nullableKey(value.sizeOptionKey) ||
		!nullableKey(value.borderOptionKey) ||
		!nullableKey(value.frameOptionKey)
	)
		return null;
	return {
		productKey: value.productKey,
		revisionId: value.revisionId,
		productKind: value.productKind,
		variantKey: value.variantKey,
		materialOptionKey: value.materialOptionKey,
		sizeOptionKey: value.sizeOptionKey,
		borderOptionKey: value.borderOptionKey,
		frameOptionKey: value.frameOptionKey,
	};
}

function parseIdentity(
	value: unknown,
	item: CheckoutSnapshotItem,
): PaidFulfillmentResolution["identity"] | null {
	if (
		!object(value) ||
		!exact(value, IDENTITY_KEYS) ||
		value.productId !== item.productKey ||
		value.revisionId !== item.revisionId ||
		value.productKind !== item.productKind ||
		value.variantKey !== item.variantKey ||
		!boundedString(value.title, 500) ||
		!boundedString(value.slug, 200)
	)
		return null;
	return {
		productId: item.productKey,
		revisionId: item.revisionId,
		productKind: item.productKind,
		title: value.title,
		slug: value.slug,
		variantKey: item.variantKey,
	};
}

function parseFinish(value: unknown, item: CheckoutSnapshotItem): Finish | null {
	const printable = item.productKind === "print" || item.productKind === "print_set";
	if (!printable) {
		if (value !== null) throw rejected();
		return null;
	}
	if (
		!object(value) ||
		!exact(value, FINISH_KEYS) ||
		value.materialKey !== item.materialOptionKey ||
		value.sizeKey !== item.sizeOptionKey ||
		value.borderKey !== item.borderOptionKey ||
		value.frameKey !== item.frameOptionKey ||
		typeof item.materialOptionKey !== "string" ||
		typeof item.sizeOptionKey !== "string"
	)
		throw rejected();
	const paper = getPaper(item.materialOptionKey);
	const size = getSize(item.sizeOptionKey);
	const border = getBorder(item.borderOptionKey ?? "none");
	const frame = getFrame(item.frameOptionKey ?? "none");
	if (!paper || !size || !border || !frame || getWholesaleCost(paper.slug, size.slug) === null) {
		throw rejected();
	}
	const canvas = parseCanvasSlug(paper.slug);
	if (
		(canvas !== null && (border.inches !== 0 || frame.subcategoryId !== 0)) ||
		(frame.subcategoryId !== 0 && border.inches !== FRAMED_BORDER_INCHES)
	)
		throw rejected();
	if (
		!object(value.paper) ||
		!exact(value.paper, ["name", "subcategoryId"]) ||
		value.paper.name !== paper.name ||
		value.paper.subcategoryId !== (canvas?.subcategoryId ?? paper.subcategoryId) ||
		!object(value.size) ||
		!exact(value.size, ["label", "width", "height"]) ||
		value.size.label !== size.label ||
		value.size.width !== size.width ||
		value.size.height !== size.height ||
		!Number.isSafeInteger(value.size.width) ||
		!Number.isSafeInteger(value.size.height) ||
		!object(value.border) ||
		!exact(value.border, ["inches"]) ||
		typeof value.border.inches !== "number" ||
		!Number.isFinite(value.border.inches) ||
		value.border.inches < 0 ||
		value.border.inches !== border.inches ||
		!object(value.frame) ||
		!exact(value.frame, ["subcategoryId"]) ||
		!Number.isSafeInteger(value.frame.subcategoryId) ||
		value.frame.subcategoryId !== frame.subcategoryId
	)
		throw rejected();
	if (canvas === null) {
		if (value.canvas !== null) throw rejected();
	} else if (
		!object(value.canvas) ||
		!exact(value.canvas, ["color", "thickness", "subcategoryId", "wrapOptionId", "wrapHex"]) ||
		value.canvas.color !== canvas.color ||
		value.canvas.thickness !== canvas.thickness ||
		!Number.isSafeInteger(value.canvas.subcategoryId) ||
		value.canvas.subcategoryId !== canvas.subcategoryId ||
		!Number.isSafeInteger(value.canvas.wrapOptionId) ||
		value.canvas.wrapOptionId !== canvas.wrapOptionId ||
		typeof value.canvas.wrapHex !== "string" ||
		!sixDigitHex.test(value.canvas.wrapHex) ||
		value.canvas.wrapHex !== canvas.wrapHex
	) {
		throw rejected();
	}
	return {
		materialKey: item.materialOptionKey,
		sizeKey: item.sizeOptionKey,
		borderKey: item.borderOptionKey,
		frameKey: item.frameOptionKey,
		paper: { name: paper.name, subcategoryId: canvas?.subcategoryId ?? paper.subcategoryId },
		size: { label: size.label, width: size.width, height: size.height },
		border: { inches: border.inches },
		frame: { subcategoryId: frame.subcategoryId },
		canvas,
	};
}

function parseCommerce(
	value: unknown,
	item: CheckoutSnapshotItem,
): PaidFulfillmentResolution["commerce"] | null {
	if (
		!object(value) ||
		!exact(value, COMMERCE_KEYS) ||
		value.currency !== "usd" ||
		!Number.isSafeInteger(value.amountCents) ||
		Number(value.amountCents) < 0
	)
		return null;
	return {
		currency: "usd",
		amountCents: Number(value.amountCents),
		finish: parseFinish(value.finish, item),
	};
}

function parseCurrent(value: unknown): PaidFulfillmentResolution["current"] | null {
	if (!object(value) || !exact(value, CURRENT_KEYS)) return null;
	if (
		typeof value.kindEnabled !== "boolean" ||
		typeof value.publishedRevision !== "boolean" ||
		typeof value.slugMatches !== "boolean" ||
		typeof value.available !== "boolean" ||
		typeof value.variantEnabled !== "boolean"
	)
		return null;
	return {
		kindEnabled: value.kindEnabled,
		publishedRevision: value.publishedRevision,
		slugMatches: value.slugMatches,
		available: value.available,
		variantEnabled: value.variantEnabled,
	};
}

function parsePrintSource(
	value: unknown,
): (PrintSourceDescriptor & { memberKey: string | null; relationKey: string }) | null {
	if (!object(value) || !exact(value, SOURCE_KEYS)) return null;
	const memberKey = value.memberKey;
	const relationKey = value.relationKey;
	if (
		!isPrintSourceDescriptor(value) ||
		!nullableKey(memberKey) ||
		!boundedString(relationKey, 160)
	)
		return null;
	return {
		memberKey,
		relationKey,
		key: value.key,
		hash: value.hash,
		bytes: value.bytes,
		mime: value.mime,
		dimensions: { width: value.dimensions.width, height: value.dimensions.height },
	};
}

function parsePaidZip(
	value: Record<string, unknown>,
): Extract<PaidFulfillmentResolution["descriptor"], { kind: "paid_zip" }> | null {
	const descriptor = parseDescriptor(value, PAID_FILE_BYTES_MAX);
	if (
		!descriptor ||
		!exact(value, FILE_KEYS) ||
		value.kind !== "paid_zip" ||
		value.mime !== "application/zip" ||
		!boundedString(value.relationKey, 160) ||
		!boundedString(value.filename, 255) ||
		(value.version !== null && !boundedString(value.version, 64))
	)
		return null;
	return {
		...descriptor,
		kind: "paid_zip",
		mime: "application/zip",
		relationKey: value.relationKey,
		filename: value.filename,
		version: value.version,
	};
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
		(!/^\d+$/.test(declared) || (!compressed && Number(declared) > CATALOG_RESPONSE_BODY_MAX_BYTES))
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
			if (total > CATALOG_RESPONSE_BODY_MAX_BYTES) {
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
function isCommerceResolverPurpose(purpose: keyof typeof PATHS) {
	return purpose === "checkout" || purpose === "paid_fulfillment" || purpose === "paid_download";
}
async function isExactResolverRejection(response: Response) {
	try {
		const body = await readJson(response);
		return object(body) && exact(body, ["error"]) && body.error === "rejected";
	} catch {
		// Status bodies are untrusted boundary data. Keep malformed, missing, and
		// over-limit details out of both classification and surfaced errors.
		return false;
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
	if (!response.ok) {
		if (response.status === 404 && isCommerceResolverPurpose(purpose)) {
			throw new CatalogBoundaryError(
				(await isExactResolverRejection(response)) ? "rejected" : "unavailable",
				"status",
			);
		}
		throw new CatalogBoundaryError(response.status === 409 ? "refunded" : "unavailable", "status");
	}
	return readJson(response);
}

function parsePaid(value: unknown, purpose: "paid_fulfillment" | "paid_download") {
	if (
		!object(value) ||
		!exact(value, PAID_KEYS) ||
		value.version !== 1 ||
		value.purpose !== purpose ||
		!Array.isArray(value.media) ||
		value.media.length < 1 ||
		value.media.length > 50
	)
		throw rejected();
	const item = parseItem(value.item);
	if (!item) throw rejected();
	const identity = parseIdentity(value.identity, item);
	const commerce = parseCommerce(value.commerce, item);
	const current = parseCurrent(value.current);
	if (!identity || !commerce || !current || !object(value.descriptor)) throw rejected();
	const rawDescriptor = value.descriptor;
	let descriptor: PaidFulfillmentResolution["descriptor"];
	if (rawDescriptor.kind === "print_sources") {
		if (
			!exact(rawDescriptor, ["kind", "sources"]) ||
			!Array.isArray(rawDescriptor.sources) ||
			rawDescriptor.sources.length < 1 ||
			rawDescriptor.sources.length > 20 ||
			(item.productKind !== "print" && item.productKind !== "print_set") ||
			purpose !== "paid_fulfillment"
		)
			throw rejected();
		const sources = rawDescriptor.sources.map(parsePrintSource);
		if (sources.some((source) => source === null)) throw rejected();
		const parsedSources = sources.filter((source) => source !== null);
		if (
			parsedSources.length !== rawDescriptor.sources.length ||
			(item.productKind === "print" &&
				(parsedSources.length !== 1 || parsedSources[0]?.memberKey !== null)) ||
			(item.productKind === "print_set" &&
				parsedSources.some((source) => source.memberKey === null))
		)
			throw rejected();
		descriptor = { kind: "print_sources", sources: parsedSources };
	} else if (rawDescriptor.kind === "paid_zip") {
		const parsed = parsePaidZip(rawDescriptor);
		if (!parsed || purpose !== "paid_download" || item.productKind !== "digital_download") {
			throw rejected();
		}
		descriptor = parsed;
	} else if (
		rawDescriptor.kind !== "merchant" ||
		!exact(rawDescriptor, ["kind", "source"]) ||
		rawDescriptor.source !== null ||
		purpose !== "paid_fulfillment" ||
		item.productKind === "digital_download"
	) {
		throw rejected();
	} else {
		descriptor = { kind: "merchant", source: null };
	}
	return { item, identity, commerce, current, descriptor };
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
		(purpose === "paid_file" &&
			(!parseDescriptor(value, PAID_FILE_BYTES_MAX) || value.mime !== "application/zip"))
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
