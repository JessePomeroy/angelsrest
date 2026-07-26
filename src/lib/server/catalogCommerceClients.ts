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

type Config = { origin?: string; bearer?: string; fetch?: typeof globalThis.fetch };
type Descriptor = { key: string; hash: string; bytes: number; mime: string };
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
		| { kind: "print_sources"; sources: Array<Descriptor & { memberKey: string | null }> }
		| ({ kind: "paid_zip" } & Descriptor)
		| { kind: "merchant" };
};

export class CatalogBoundaryError extends Error {
	constructor(readonly kind: "unavailable" | "rejected") {
		super(`Catalog boundary ${kind}`);
	}
}
const rejected = () => new CatalogBoundaryError("rejected");
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
	if (response.headers.get("content-type") !== "application/json") throw rejected();
	const declared = response.headers.get("content-length");
	if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 64 * 1024)) {
		throw rejected();
	}
	const reader = response.body?.getReader();
	if (!reader) throw rejected();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > 64 * 1024) {
			await reader.cancel();
			throw rejected();
		}
		chunks.push(value);
	}
	if (declared !== null && Number(declared) !== total) throw rejected();
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
	} catch {
		throw rejected();
	}
}
async function post(config: Config, purpose: keyof typeof PATHS, body: unknown) {
	const encoded = JSON.stringify(body);
	if (new TextEncoder().encode(encoded).byteLength > 4096) throw rejected();
	let response: Response;
	try {
		response = await (config.fetch ?? fetch)(endpoint(config, PATHS[purpose]), {
			method: "POST",
			headers: { Authorization: `Bearer ${config.bearer}`, "Content-Type": "application/json" },
			body: encoded,
			signal: AbortSignal.timeout(5_000),
		});
	} catch {
		throw new CatalogBoundaryError("unavailable");
	}
	if (!response.ok)
		throw new CatalogBoundaryError(response.status === 503 ? "unavailable" : "rejected");
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
			if (!object(source) || !exact(source, SOURCE_KEYS) || !validDescriptor(source))
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
export async function resolveCatalogCheckout(item: CheckoutSnapshotItem, config?: Config) {
	const value = await resolve("checkout", { item }, config);
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
async function issue(purpose: IssuerPurpose, value: Descriptor, config = configured(purpose)) {
	if (!validDescriptor(value)) throw rejected();
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
	try {
		const capability = new URL(result.url);
		if (capability.protocol !== "https:" || capability.username || capability.password)
			throw rejected();
	} catch {
		throw rejected();
	}
	return result.url;
}
export const issuePrintSource = (value: Descriptor, config?: Config) =>
	issue("print_source", value, config);
export const issuePaidFile = (value: Descriptor, config?: Config) =>
	issue("paid_file", value, config);
