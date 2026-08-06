// Server-only LumaPrints client; see LUMAPRINTS.md for integration constraints.

import { env } from "$env/dynamic/private";
import { normalizeLumaPrintsProviderNumber } from "$lib/server/lumaprintsProviderNumber";
import { prepareSanityUrlForPrint } from "$lib/shop/lumaprintsUrls";
import type {
	LumaPrintsOrder,
	LumaPrintsOrderResponse,
	LumaPrintsShipment,
	OrderItem,
	Recipient,
} from "$lib/shop/types";

const BASE_URL =
	env.LUMAPRINTS_USE_SANDBOX === "true"
		? "https://us.api-sandbox.lumaprints.com"
		: "https://us.api.lumaprints.com";

function getHeaders(): HeadersInit {
	const apiKey = env.LUMAPRINTS_API_KEY ?? "";
	const apiSecret = env.LUMAPRINTS_API_SECRET ?? "";
	return {
		"Content-Type": "application/json",
		Authorization: `Basic ${btoa(`${apiKey}:${apiSecret}`)}`,
	};
}

/**
 * CRITICAL: Strip ALL query params from Sanity image URLs before sending
 * to LumaPrints. Query params (`?w=1200&fm=webp`) cause aspect-ratio
 * validation errors on the LumaPrints side. The raw Sanity CDN URL serves
 * JPEG by default — no format param needed. See LUMAPRINTS.md for the
 * full postmortem.
 */
export function cleanImageUrl(url: string): string {
	return url.split("?")[0];
}

export type LumaPrintsErrorDetails = Readonly<
	Record<string, string | number | boolean | undefined>
>;

/** Custom error class carrying only bounded, non-sensitive failure metadata. */
export class LumaPrintsError extends Error {
	constructor(
		message: string,
		readonly details?: LumaPrintsErrorDetails,
	) {
		super(message);
		this.name = "LumaPrintsError";
	}
}

export type LumaPrintsSubmissionDisposition = "definitely_rejected" | "uncertain";

type LumaPrintsJsonFailurePhase =
	| "content_type"
	| "content_encoding"
	| "declared_length"
	| "stream"
	| "size"
	| "utf8"
	| "json"
	| "envelope";

type LumaPrintsSubmissionEvidence =
	| { phase: "transport"; kind: "network" | "timeout"; timeoutMs: number }
	| { phase: "status"; statusCode: number }
	| { phase: LumaPrintsJsonFailurePhase };

/** Outcome of the create-order operation, without retaining a provider body. */
export class LumaPrintsSubmissionError extends LumaPrintsError {
	readonly operation = "create_order" as const;

	constructor(
		message: string,
		readonly disposition: LumaPrintsSubmissionDisposition,
		evidence: LumaPrintsSubmissionEvidence,
	) {
		super(message, { operation: "create_order", disposition, ...evidence });
		this.name = "LumaPrintsSubmissionError";
	}
}

export type LumaPrintsReconciliationClass =
	| "provider_rejected"
	| "response_contract"
	| "ambiguous_result"
	| "client_error";

export class LumaPrintsReconciliationError extends LumaPrintsError {
	constructor(
		message: string,
		readonly disposition: "retryable" | "blocked",
		readonly reconciliationClass?: LumaPrintsReconciliationClass,
	) {
		super(message, {
			kind: disposition,
			...(reconciliationClass ? { reconciliationClass } : {}),
		});
		this.name = "LumaPrintsReconciliationError";
	}
}

const LUMAPRINTS_REQUEST_TIMEOUT_MS = 15_000;
const LUMAPRINTS_CREATE_RESPONSE_MAX_BYTES = 32 * 1024;
const LUMAPRINTS_DIRECT_RESPONSE_MAX_BYTES = 64 * 1024;
const LUMAPRINTS_RECONCILIATION_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const LUMAPRINTS_RECONCILIATION_MAX_PAGES = 10;
const LUMAPRINTS_RECONCILIATION_MAX_ROWS_PER_PAGE = 100;
const LUMAPRINTS_RECONCILIATION_MAX_ROWS =
	LUMAPRINTS_RECONCILIATION_MAX_PAGES * LUMAPRINTS_RECONCILIATION_MAX_ROWS_PER_PAGE;
const STRIPE_CHECKOUT_SESSION_ID = /^cs_(?:test|live)_[A-Za-z0-9]{16,120}$/;
const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const CONTENT_ENCODINGS = new Set(["identity", "gzip", "br", "deflate"]);

function object(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: string[]) {
	return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function getStoreId(): number {
	const raw = env.LUMAPRINTS_STORE_ID;
	const numeric = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
	if (!Number.isSafeInteger(numeric) || numeric <= 0) {
		throw new LumaPrintsError("LumaPrints store configuration was invalid", {
			kind: "configuration",
		});
	}
	return numeric;
}

function parseParameterValue(value: string): string | null {
	if (HTTP_TOKEN.test(value)) return value;
	if (value.length < 2 || value[0] !== '"' || value.at(-1) !== '"') return null;
	const inner = value.slice(1, -1);
	return /^[\t\x20-\x21\x23-\x5b\x5d-\x7e]*$/.test(inner) ? inner : null;
}

function isJsonContentType(value: string | null): boolean {
	if (value === null) return false;
	const [mediaType, ...parameters] = value.split(";");
	if (mediaType.trim().toLowerCase() !== "application/json") return false;
	let sawCharset = false;
	for (const parameter of parameters) {
		const match = parameter.match(/^\s*([!#$%&'*+\-.^_`|~0-9A-Za-z]+)\s*=\s*(.*?)\s*$/);
		if (!match) return false;
		const [, rawName, rawValue] = match;
		if (rawName.toLowerCase() !== "charset" || sawCharset) return false;
		const charset = parseParameterValue(rawValue);
		if (charset?.toLowerCase() !== "utf-8") return false;
		sawCharset = true;
	}
	return true;
}

function parseContentEncodings(value: string | null): string[] | null {
	if (value === null) return [];
	const encodings = value.split(",").map((encoding) => encoding.trim());
	if (
		encodings.length === 0 ||
		encodings.some(
			(encoding) => !HTTP_TOKEN.test(encoding) || !CONTENT_ENCODINGS.has(encoding.toLowerCase()),
		)
	)
		return null;
	return encodings.map((encoding) => encoding.toLowerCase());
}

async function readBoundedJson(
	response: Response,
	maxBytes: number,
	contractFailure: (reason: LumaPrintsJsonFailurePhase) => Error,
	streamFailure: () => Error,
	resourceFailure: () => Error,
) {
	if (!isJsonContentType(response.headers.get("content-type"))) {
		throw contractFailure("content_type");
	}
	const contentEncodings = parseContentEncodings(response.headers.get("content-encoding"));
	if (contentEncodings === null) {
		throw contractFailure("content_encoding");
	}
	const compressed = contentEncodings.some((encoding) => encoding !== "identity");
	const declared = response.headers.get("content-length");
	let declaredBytes: bigint | null = null;
	if (declared !== null) {
		if (!/^\d+$/.test(declared)) throw contractFailure("declared_length");
		declaredBytes = BigInt(declared);
		if (!compressed && declaredBytes > BigInt(maxBytes)) {
			throw resourceFailure();
		}
	}
	const reader = response.body?.getReader();
	if (!reader) throw contractFailure("stream");
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) {
				try {
					void reader.cancel().catch(() => undefined);
				} catch {
					// Cancellation is best-effort cleanup. Keep the selected boundary failure.
				}
				throw resourceFailure();
			}
			chunks.push(value);
		}
	} catch (error) {
		if (error instanceof LumaPrintsError) throw error;
		throw streamFailure();
	}
	if (!compressed && declaredBytes !== null && declaredBytes !== BigInt(total)) {
		throw contractFailure("declared_length");
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
		throw contractFailure("utf8");
	}
	let decoded: string;
	try {
		decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw contractFailure("utf8");
	}
	try {
		return JSON.parse(decoded) as unknown;
	} catch {
		throw contractFailure("json");
	}
}

function parseOrderResponse(value: unknown): LumaPrintsOrderResponse {
	if (!object(value) || !exact(value, ["message", "orderNumber"])) {
		throw new LumaPrintsSubmissionError("Order submission response was malformed", "uncertain", {
			phase: "envelope",
		});
	}
	const orderNumber = normalizeLumaPrintsProviderNumber(value.orderNumber);
	if (typeof value.message !== "string" || value.message.length === 0 || orderNumber === null) {
		throw new LumaPrintsSubmissionError("Order submission response was malformed", "uncertain", {
			phase: "envelope",
		});
	}
	return { orderNumber };
}

async function fetchLumaPrints(path: string, init: RequestInit = {}): Promise<Response> {
	try {
		return await fetch(`${BASE_URL}${path}`, {
			...init,
			signal: AbortSignal.timeout(LUMAPRINTS_REQUEST_TIMEOUT_MS),
		});
	} catch (error) {
		const cause = error instanceof Error ? error.name : typeof error;
		const kind = cause === "TimeoutError" || cause === "AbortError" ? "timeout" : "network";
		throw new LumaPrintsError(
			kind === "timeout"
				? `LumaPrints request timed out after ${LUMAPRINTS_REQUEST_TIMEOUT_MS}ms`
				: "LumaPrints network request failed",
			{ kind, timeoutMs: LUMAPRINTS_REQUEST_TIMEOUT_MS, cause },
		);
	}
}

/** Submit an order to LumaPrints. */
export async function createOrder(order: LumaPrintsOrder): Promise<LumaPrintsOrderResponse> {
	let res: Response;
	try {
		res = await fetchLumaPrints("/api/v1/orders", {
			method: "POST",
			headers: getHeaders(),
			body: JSON.stringify(order),
		});
	} catch (error) {
		const details =
			error instanceof LumaPrintsError && object(error.details) ? error.details : null;
		const kind = details?.kind === "timeout" ? "timeout" : "network";
		throw new LumaPrintsSubmissionError(
			kind === "timeout"
				? `LumaPrints request timed out after ${LUMAPRINTS_REQUEST_TIMEOUT_MS}ms`
				: "LumaPrints network request failed",
			"uncertain",
			{ phase: "transport", kind, timeoutMs: LUMAPRINTS_REQUEST_TIMEOUT_MS },
		);
	}
	if (!res.ok) {
		throw new LumaPrintsSubmissionError(
			"Order submission failed",
			res.status === 400 || res.status === 406 || res.status === 429
				? "definitely_rejected"
				: "uncertain",
			{ phase: "status", statusCode: res.status },
		);
	}
	const body = await readBoundedJson(
		res,
		LUMAPRINTS_CREATE_RESPONSE_MAX_BYTES,
		(reason) =>
			new LumaPrintsSubmissionError("Order submission response was malformed", "uncertain", {
				phase: reason,
			}),
		() =>
			new LumaPrintsSubmissionError("Order submission response stream failed", "uncertain", {
				phase: "transport",
				kind: "network",
				timeoutMs: LUMAPRINTS_REQUEST_TIMEOUT_MS,
			}),
		() =>
			new LumaPrintsSubmissionError(
				"Order submission response exceeded its size bound",
				"uncertain",
				{ phase: "size" },
			),
	);
	return parseOrderResponse(body);
}

function reconciliationFailure(
	message: string,
	reconciliationClass: LumaPrintsReconciliationClass,
) {
	return new LumaPrintsReconciliationError(message, "blocked", reconciliationClass);
}

function reconciliationRetryable(message: string) {
	return new LumaPrintsReconciliationError(message, "retryable");
}

function isRetryableProviderStatus(status: number) {
	return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

interface ReconciliationPage {
	orders: Array<{ externalId: string; orderNumber: string }>;
	totalOrders: number;
	currentPage: number;
	totalPages: number;
}

function nonNegativeSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseReconciliationPage(value: unknown, storeId: number): ReconciliationPage {
	if (
		!object(value) ||
		!exact(value, ["orders", "totalOrders", "currentPage", "totalPages"]) ||
		!Array.isArray(value.orders) ||
		!nonNegativeSafeInteger(value.totalOrders) ||
		!nonNegativeSafeInteger(value.totalPages) ||
		!Number.isSafeInteger(value.currentPage) ||
		(value.currentPage as number) < 1
	) {
		throw reconciliationFailure("Order reconciliation response was malformed", "response_contract");
	}
	if (value.orders.length > LUMAPRINTS_RECONCILIATION_MAX_ROWS_PER_PAGE) {
		throw reconciliationRetryable("Order reconciliation response exceeded its row bound");
	}
	const orders: ReconciliationPage["orders"] = [];
	for (const row of value.orders) {
		if (!object(row) || typeof row.externalId !== "string" || row.externalId.length === 0) {
			throw reconciliationFailure("Order reconciliation row was malformed", "response_contract");
		}
		const orderNumber = normalizeLumaPrintsProviderNumber(row.orderNumber);
		const rowStoreId = normalizeLumaPrintsProviderNumber(row.storeId);
		if (orderNumber === null || rowStoreId !== String(storeId)) {
			throw reconciliationFailure("Order reconciliation row was malformed", "response_contract");
		}
		orders.push({ externalId: row.externalId, orderNumber });
	}
	return {
		orders,
		totalOrders: value.totalOrders,
		currentPage: value.currentPage as number,
		totalPages: value.totalPages,
	};
}

/** Reconcile an uncertain submit by its stable external ID. */
export async function findOrderByExternalId(
	externalId: string,
): Promise<LumaPrintsOrderResponse | null> {
	if (!STRIPE_CHECKOUT_SESSION_ID.test(externalId)) {
		throw reconciliationFailure("Order reconciliation identity was invalid", "client_error");
	}
	let storeId: number;
	try {
		storeId = getStoreId();
	} catch (error) {
		throw reconciliationFailure("Order reconciliation client failed", "client_error");
	}
	let expectedTotalOrders: number | null = null;
	let expectedTotalPages: number | null = null;
	let rowsRead = 0;
	let match: LumaPrintsOrderResponse | null = null;
	const seenOrderNumbers = new Set<string>();

	for (let page = 1; page <= LUMAPRINTS_RECONCILIATION_MAX_PAGES; page += 1) {
		const query = new URLSearchParams({ storeId: String(storeId), page: String(page) });
		let res: Response;
		try {
			res = await fetchLumaPrints(`/api/v1/orders?${query}`, { headers: getHeaders() });
		} catch (error) {
			const details =
				error instanceof LumaPrintsError && object(error.details) ? error.details : null;
			if (details?.kind === "network" || details?.kind === "timeout") {
				throw reconciliationRetryable("Order reconciliation transport failed");
			}
			throw reconciliationFailure("Order reconciliation client failed", "client_error");
		}
		if (res.status === 404 && page === 1) return null;
		if (!res.ok) {
			if (isRetryableProviderStatus(res.status) || res.status === 404) {
				throw reconciliationRetryable("Order reconciliation is unavailable");
			}
			throw reconciliationFailure("Order reconciliation was rejected", "provider_rejected");
		}
		const body = await readBoundedJson(
			res,
			LUMAPRINTS_RECONCILIATION_RESPONSE_MAX_BYTES,
			() =>
				reconciliationFailure("Order reconciliation response was malformed", "response_contract"),
			() => reconciliationRetryable("Order reconciliation stream failed"),
			() => reconciliationRetryable("Order reconciliation response exceeded its size bound"),
		);
		const parsed = parseReconciliationPage(body, storeId);
		if (
			parsed.currentPage !== page ||
			(parsed.totalOrders === 0
				? page !== 1 ||
					parsed.orders.length !== 0 ||
					(parsed.totalPages !== 0 && parsed.totalPages !== 1)
				: parsed.totalPages < page || parsed.totalPages > parsed.totalOrders)
		) {
			throw reconciliationFailure(
				"Order reconciliation response was malformed",
				"response_contract",
			);
		}
		if (
			parsed.totalPages > LUMAPRINTS_RECONCILIATION_MAX_PAGES ||
			parsed.totalOrders > LUMAPRINTS_RECONCILIATION_MAX_ROWS
		) {
			throw reconciliationRetryable("Order reconciliation response exceeded its pagination bound");
		}
		if (expectedTotalOrders === null) {
			expectedTotalOrders = parsed.totalOrders;
			expectedTotalPages = parsed.totalPages;
		} else if (
			parsed.totalOrders !== expectedTotalOrders ||
			parsed.totalPages !== expectedTotalPages
		) {
			throw reconciliationRetryable("Order reconciliation pagination changed");
		}
		if (parsed.totalOrders === 0) return null;
		if (page < parsed.totalPages && parsed.orders.length === 0) {
			throw reconciliationRetryable("Order reconciliation pagination was unstable");
		}
		rowsRead += parsed.orders.length;
		if (rowsRead > parsed.totalOrders || rowsRead > LUMAPRINTS_RECONCILIATION_MAX_ROWS) {
			throw reconciliationRetryable("Order reconciliation pagination was unstable");
		}
		for (const row of parsed.orders) {
			if (seenOrderNumbers.has(row.orderNumber)) {
				throw reconciliationRetryable("Order reconciliation pagination contained a duplicate");
			}
			seenOrderNumbers.add(row.orderNumber);
			if (row.externalId !== externalId) continue;
			if (match !== null) {
				throw reconciliationFailure("Order reconciliation was ambiguous", "ambiguous_result");
			}
			match = { orderNumber: row.orderNumber };
		}
		if (page === parsed.totalPages) {
			if (rowsRead !== parsed.totalOrders) {
				throw reconciliationRetryable("Order reconciliation pagination was unstable");
			}
			return match;
		}
	}
	throw reconciliationRetryable("Order reconciliation response exceeded its pagination bound");
}

/** Get order status from LumaPrints */
export async function getOrder(
	orderNumber: string,
): Promise<{ orderNumber: string; status: string }> {
	const res = await fetchLumaPrints(`/api/v1/orders/${orderNumber}`, {
		headers: getHeaders(),
	});
	if (!res.ok) {
		throw new LumaPrintsError(`Failed to get order ${orderNumber}`);
	}
	return res.json();
}

/** Get shipment tracking for an order */
export async function getShipping(orderNumber: string): Promise<LumaPrintsShipment[]> {
	const res = await fetchLumaPrints(`/api/v1/orders/${orderNumber}/shipments`, {
		headers: getHeaders(),
	});
	if (!res.ok) {
		throw new LumaPrintsError(`Failed to get shipments for ${orderNumber}`);
	}
	return res.json();
}

type LumaPrintsDirectOperation = "check_image_config" | "get_shipping_price";

function directResponseFailure(
	operation: LumaPrintsDirectOperation,
	message: string,
	phase: LumaPrintsJsonFailurePhase | "status",
	statusCode?: number,
) {
	return new LumaPrintsError(message, {
		operation,
		phase,
		...(statusCode === undefined ? {} : { statusCode }),
	});
}

function cancelProviderBody(response: Response) {
	try {
		void response.body?.cancel().catch(() => undefined);
	} catch {
		// Cancellation is best-effort. Do not inspect or retain the provider body.
	}
}

async function readDirectResponseJson(
	response: Response,
	operation: LumaPrintsDirectOperation,
	failureMessage: string,
) {
	if (!response.ok) {
		cancelProviderBody(response);
		throw directResponseFailure(operation, failureMessage, "status", response.status);
	}
	return readBoundedJson(
		response,
		LUMAPRINTS_DIRECT_RESPONSE_MAX_BYTES,
		(phase) => directResponseFailure(operation, `${failureMessage} response was malformed`, phase),
		() => directResponseFailure(operation, `${failureMessage} response stream failed`, "stream"),
		() =>
			directResponseFailure(
				operation,
				`${failureMessage} response exceeded its size bound`,
				"size",
			),
	);
}

export interface LumaPrintsImageConfigResult {
	valid: boolean;
	message?: string;
	recommendedWidth?: number;
	recommendedHeight?: number;
	expectedAspectRatio?: number;
}

function parseImageConfigResponse(value: unknown): LumaPrintsImageConfigResult {
	if (!object(value) || typeof value.valid !== "boolean") {
		throw directResponseFailure(
			"check_image_config",
			"Image validation response was malformed",
			"envelope",
		);
	}
	if (
		value.message !== undefined &&
		(typeof value.message !== "string" || value.message.length > 1000)
	) {
		throw directResponseFailure(
			"check_image_config",
			"Image validation response was malformed",
			"envelope",
		);
	}
	for (const field of ["recommendedWidth", "recommendedHeight", "expectedAspectRatio"] as const) {
		const candidate = value[field];
		if (candidate !== undefined && (typeof candidate !== "number" || !Number.isFinite(candidate))) {
			throw directResponseFailure(
				"check_image_config",
				"Image validation response was malformed",
				"envelope",
			);
		}
	}
	return {
		valid: value.valid,
		...(typeof value.message === "string" ? { message: value.message } : {}),
		...(typeof value.recommendedWidth === "number"
			? { recommendedWidth: value.recommendedWidth }
			: {}),
		...(typeof value.recommendedHeight === "number"
			? { recommendedHeight: value.recommendedHeight }
			: {}),
		...(typeof value.expectedAspectRatio === "number"
			? { expectedAspectRatio: value.expectedAspectRatio }
			: {}),
	};
}

/** Pre-validates a print image at checkout; provider failures remain typed and body-redacted. */
export async function checkImageConfig(input: {
	imageUrl: string;
	subcategoryId: number;
	width: number;
	height: number;
}): Promise<LumaPrintsImageConfigResult> {
	const res = await fetchLumaPrints("/api/v1/images/checkImageConfig", {
		method: "POST",
		headers: getHeaders(),
		body: JSON.stringify({
			imageUrl: cleanImageUrl(input.imageUrl),
			subcategoryId: input.subcategoryId,
			width: input.width,
			height: input.height,
		}),
	});

	const body = await readDirectResponseJson(
		res,
		"check_image_config",
		"Image validation request failed",
	);
	return parseImageConfigResponse(body);
}

/** Shipping method returned by the provider pricing endpoint. */
export interface LumaPrintsShippingMethod {
	carrier: string;
	method: string;
	cost: number;
}

function parseShippingPriceResponse(value: unknown): {
	shippingMethods: LumaPrintsShippingMethod[];
} {
	if (
		!object(value) ||
		!Array.isArray(value.shippingMethods) ||
		value.shippingMethods.length > 50
	) {
		throw directResponseFailure(
			"get_shipping_price",
			"Shipping price response was malformed",
			"envelope",
		);
	}
	const shippingMethods = value.shippingMethods.map((method) => {
		if (
			!object(method) ||
			typeof method.carrier !== "string" ||
			method.carrier.length === 0 ||
			method.carrier.length > 100 ||
			typeof method.method !== "string" ||
			method.method.length === 0 ||
			method.method.length > 100 ||
			typeof method.cost !== "number" ||
			!Number.isFinite(method.cost) ||
			method.cost < 0
		) {
			throw directResponseFailure(
				"get_shipping_price",
				"Shipping price response was malformed",
				"envelope",
			);
		}
		return { carrier: method.carrier, method: method.method, cost: method.cost };
	});
	return { shippingMethods };
}

/** Returns provider shipping prices; callers fail closed rather than inventing a fallback. */
export async function getShippingPrice(input: {
	items: Array<{
		subcategoryId: number;
		width: number;
		height: number;
		quantity: number;
		orderItemOptions?: number[];
	}>;
	recipient: Recipient;
}): Promise<{
	shippingMethods: LumaPrintsShippingMethod[];
}> {
	const res = await fetchLumaPrints("/api/v1/pricing/shipping", {
		method: "POST",
		headers: getHeaders(),
		body: JSON.stringify({
			storeId: getStoreId(),
			shippingMethod: "default",
			recipient: {
				firstName: input.recipient.firstName,
				lastName: input.recipient.lastName,
				addressLine1: input.recipient.address1,
				addressLine2: input.recipient.address2 || "",
				city: input.recipient.city,
				state: input.recipient.state,
				zipCode: input.recipient.zip,
				country: input.recipient.country,
				phone: input.recipient.phone || "",
			},
			orderItems: input.items.map((item) => ({
				subcategoryId: item.subcategoryId,
				quantity: item.quantity,
				width: item.width,
				height: item.height,
				orderItemOptions: item.orderItemOptions ?? [39],
			})),
		}),
	});

	const body = await readDirectResponseJson(
		res,
		"get_shipping_price",
		"Shipping price request failed",
	);
	return parseShippingPriceResponse(body);
}

/** Pure payload builder. Sanity sources retain print-quality transforms;
 * direct paper uses option 39, framed paper [67, 96], and canvas [3]. */
export function buildLumaPrintsOrder(
	externalId: string,
	recipient: Recipient,
	items: OrderItem[],
): LumaPrintsOrder {
	return {
		externalId,
		storeId: getStoreId(),
		shippingMethod: "default",
		recipient: {
			firstName: recipient.firstName,
			lastName: recipient.lastName,
			addressLine1: recipient.address1,
			addressLine2: recipient.address2 || "",
			city: recipient.city,
			state: recipient.state,
			zipCode: recipient.zip,
			country: recipient.country,
			phone: recipient.phone || "",
		},
		orderItems: items.map((item, i) => {
			const isCanvas = typeof item.canvasSubcategoryId === "number" && item.canvasSubcategoryId > 0;
			const isFramed = typeof item.frameSubcategoryId === "number" && item.frameSubcategoryId > 0;
			// Priority: canvas > frame > paper subcategory
			const subcategoryId = isCanvas
				? (item.canvasSubcategoryId as number)
				: isFramed
					? (item.frameSubcategoryId as number)
					: item.paperSubcategoryId;
			const imageUrl =
				item.sourcePolicy === "sanity_cdn"
					? prepareSanityUrlForPrint(item.imageUrl)
					: item.imageUrl;
			const options: number[] = [];
			let solidColorHexCode: string | undefined;
			if (isCanvas) {
				options.push(3); // Solid Color wrap
				solidColorHexCode = item.canvasWrapHex || "#000000";
			} else if (isFramed) {
				// Framed Fine Art Paper has its own option groups. The direct-paper
				// no-bleed option is not valid for this subcategory.
				options.push(67); // Mat size: 2"
				options.push(96); // Mat color: White
			} else {
				options.push(39); // No Bleed (direct Fine Art Paper)
			}
			return {
				externalItemId: `${externalId}-item-${i + 1}`,
				subcategoryId,
				quantity: item.quantity,
				width: item.width,
				height: item.height,
				file: { imageUrl },
				orderItemOptions: options,
				...(solidColorHexCode ? { solidColorHexCode } : {}),
			};
		}),
	};
}
