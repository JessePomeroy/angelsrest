import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { isStripeCheckoutSessionId } from "../../packages/crm-api/convex/helpers/checkoutSnapshot";
import { normalizeLumaPrintsProviderNumber } from "../../src/lib/server/lumaprintsProviderNumber";

const MAX_PAGES = 10;
const MAX_ROWS_PER_PAGE = 100;
const MAX_ROWS = MAX_PAGES * MAX_ROWS_PER_PAGE;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_TARGETS = 50;
const REQUEST_TIMEOUT_MS = 15_000;
const CONTENT_ENCODINGS = new Set(["identity", "gzip", "br", "deflate"]);

export type ProviderInvestigationTarget =
	| { outcome: "ready"; externalId: string }
	| { outcome: "source_conflict" | "target_conflict" | "live_effect_conflict" };

export type ProviderInvestigationResult =
	| "provider_investigation:match_observed"
	| "provider_investigation:match_not_observed"
	| "provider_investigation:inconclusive"
	| "provider_investigation:source_conflict"
	| "provider_investigation:target_conflict"
	| "provider_investigation:live_effect_conflict"
	| "provider_investigation:configuration_error"
	| "provider_investigation:operation_unavailable";

export type ProviderMultiInvestigationTargets =
	| { outcome: "ready"; externalIds: string[] }
	| { outcome: "source_conflict" | "target_conflict" | "live_effect_conflict" };

export type ProviderMultiInvestigationResult =
	| "provider_multi_investigation:all_observed"
	| "provider_multi_investigation:some_observed"
	| "provider_multi_investigation:none_observed"
	| "provider_multi_investigation:inconclusive"
	| "provider_multi_investigation:source_conflict"
	| "provider_multi_investigation:target_conflict"
	| "provider_multi_investigation:live_effect_conflict"
	| "provider_multi_investigation:configuration_error"
	| "provider_multi_investigation:operation_unavailable";

export async function claimProtectedOperationAttempt(
	directory: string,
	markerName: string,
	markerContents: string,
) {
	try {
		if (
			!/^[a-z][a-z0-9-]{0,80}$/.test(markerName) ||
			!/^[a-z][a-z0-9_]{0,80}\n$/.test(markerContents)
		)
			return false;
		const owner = process.getuid?.();
		if (owner === undefined) return false;
		const directoryState = await lstat(directory);
		if (
			!directoryState.isDirectory() ||
			directoryState.isSymbolicLink() ||
			directoryState.uid !== owner ||
			(directoryState.mode & 0o777) !== 0o700
		)
			return false;
		const directoryHandle = await open(
			directory,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		try {
			const openedDirectoryState = await directoryHandle.stat();
			if (
				openedDirectoryState.dev !== directoryState.dev ||
				openedDirectoryState.ino !== directoryState.ino
			)
				return false;
			const markerPath = join(directory, markerName);
			const marker = await open(
				markerPath,
				constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
				0o600,
			);
			try {
				await marker.writeFile(markerContents, { encoding: "utf8" });
				await marker.sync();
				await directoryHandle.sync();
				const markerState = await marker.stat();
				return (
					markerState.isFile() && markerState.uid === owner && (markerState.mode & 0o777) === 0o600
				);
			} finally {
				await marker.close();
			}
		} finally {
			await directoryHandle.close();
		}
	} catch {
		return false;
	}
}

export async function claimProviderInvestigationAttempt(directory: string) {
	return await claimProtectedOperationAttempt(
		directory,
		"production-provider-investigation-attempted",
		"provider_investigation_attempted\n",
	);
}

export async function claimProviderMultiInvestigationAttempt(directory: string) {
	return await claimProtectedOperationAttempt(
		directory,
		"production-provider-multi-investigation-attempted",
		"provider_multi_investigation_attempted\n",
	);
}

export function parseProviderInvestigationTarget(value: string): ProviderInvestigationTarget {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value) as unknown;
	} catch {
		throw new Error("invalid");
	}
	if (!object(parsed)) throw new Error("invalid");
	if (
		parsed.outcome === "ready" &&
		Object.keys(parsed).length === 2 &&
		typeof parsed.externalId === "string" &&
		/^cs_live_[A-Za-z0-9]{16,120}$/.test(parsed.externalId)
	)
		return { outcome: "ready", externalId: parsed.externalId };
	if (
		(parsed.outcome === "source_conflict" ||
			parsed.outcome === "target_conflict" ||
			parsed.outcome === "live_effect_conflict") &&
		Object.keys(parsed).length === 1
	)
		return { outcome: parsed.outcome };
	throw new Error("invalid");
}

export function parseProviderMultiInvestigationTargets(
	value: string,
): ProviderMultiInvestigationTargets {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value) as unknown;
	} catch {
		throw new Error("invalid");
	}
	if (!object(parsed)) throw new Error("invalid");
	const externalIds = parsed.externalIds;
	if (
		parsed.outcome === "ready" &&
		Object.keys(parsed).length === 2 &&
		Array.isArray(externalIds) &&
		externalIds.length >= 2 &&
		externalIds.length <= MAX_TARGETS &&
		externalIds.every(
			(externalId) =>
				typeof externalId === "string" && /^cs_live_[A-Za-z0-9]{16,120}$/.test(externalId),
		) &&
		externalIds.every((externalId, index) => index === 0 || externalIds[index - 1] < externalId)
	)
		return { outcome: "ready", externalIds: [...externalIds] };
	if (
		(parsed.outcome === "source_conflict" ||
			parsed.outcome === "target_conflict" ||
			parsed.outcome === "live_effect_conflict") &&
		Object.keys(parsed).length === 1
	)
		return { outcome: parsed.outcome };
	throw new Error("invalid");
}

export function productionProviderModeIsSafe(value: string | undefined) {
	return value === undefined || value === "false";
}

export interface ProviderConfiguration {
	apiKey: string;
	apiSecret: string;
	storeId: number;
	baseUrl: "https://us.api.lumaprints.com";
}

interface ProviderPage {
	orders: Array<{ externalId: string; orderNumber: string }>;
	totalOrders: number;
	currentPage: number;
	totalPages: number;
}

class InconclusiveProviderRead extends Error {}

function object(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: string[]) {
	return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function nonNegativeSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isJsonContentType(value: string | null) {
	if (value === null) return false;
	const [mediaType, ...parameters] = value.split(";");
	if (mediaType.trim().toLowerCase() !== "application/json") return false;
	if (parameters.length === 0) return true;
	return parameters.length === 1 && /^\s*charset\s*=\s*(?:"utf-8"|utf-8)\s*$/i.test(parameters[0]);
}

function parseContentEncodings(value: string | null): string[] | null {
	if (value === null) return [];
	const encodings = value.split(",").map((encoding) => encoding.trim().toLowerCase());
	if (
		encodings.length === 0 ||
		encodings.some((encoding) => !/^[!#$%&'*+\-.^_`|~0-9a-z]+$/.test(encoding)) ||
		encodings.some((encoding) => !CONTENT_ENCODINGS.has(encoding))
	)
		return null;
	return encodings;
}

async function discardBody(response: Response) {
	try {
		await response.body?.cancel();
	} catch {
		// Best-effort transport cleanup. The normalized provider class is unchanged.
	}
}

async function readBoundedJson(response: Response) {
	if (!isJsonContentType(response.headers.get("content-type"))) {
		throw new InconclusiveProviderRead("response_contract");
	}
	const contentEncodings = parseContentEncodings(response.headers.get("content-encoding"));
	if (contentEncodings === null) throw new InconclusiveProviderRead("response_contract");
	const compressed = contentEncodings.some((encoding) => encoding !== "identity");
	const declared = response.headers.get("content-length");
	if (declared !== null) {
		if (!/^\d+$/.test(declared)) throw new InconclusiveProviderRead("response_contract");
		if (!compressed && BigInt(declared) > BigInt(MAX_RESPONSE_BYTES)) {
			throw new InconclusiveProviderRead("response_bound");
		}
	}
	const reader = response.body?.getReader();
	if (!reader) throw new InconclusiveProviderRead("response_contract");
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > MAX_RESPONSE_BYTES) {
				void reader.cancel().catch(() => undefined);
				throw new InconclusiveProviderRead("response_bound");
			}
			chunks.push(value);
		}
	} catch (error) {
		if (error instanceof InconclusiveProviderRead) throw error;
		throw new InconclusiveProviderRead("response_stream");
	}
	if (!compressed && declared !== null && BigInt(declared) !== BigInt(total)) {
		throw new InconclusiveProviderRead("response_contract");
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
		throw new InconclusiveProviderRead("response_contract");
	}
	let decoded: string;
	try {
		decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new InconclusiveProviderRead("response_contract");
	}
	try {
		return JSON.parse(decoded) as unknown;
	} catch {
		throw new InconclusiveProviderRead("response_contract");
	}
}

function parsePage(value: unknown, storeId: number): ProviderPage {
	if (
		!object(value) ||
		!exact(value, ["orders", "totalOrders", "currentPage", "totalPages"]) ||
		!Array.isArray(value.orders) ||
		value.orders.length > MAX_ROWS_PER_PAGE ||
		!nonNegativeSafeInteger(value.totalOrders) ||
		!nonNegativeSafeInteger(value.totalPages) ||
		!Number.isSafeInteger(value.currentPage) ||
		(value.currentPage as number) < 1
	)
		throw new InconclusiveProviderRead("response_contract");
	const orders: ProviderPage["orders"] = [];
	for (const row of value.orders) {
		if (!object(row) || typeof row.externalId !== "string" || row.externalId.length === 0) {
			throw new InconclusiveProviderRead("response_contract");
		}
		const orderNumber = normalizeLumaPrintsProviderNumber(row.orderNumber);
		const rowStoreId = normalizeLumaPrintsProviderNumber(row.storeId);
		if (orderNumber === null || rowStoreId !== String(storeId)) {
			throw new InconclusiveProviderRead("response_contract");
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

export async function observeProviderMatches(
	externalIds: readonly string[],
	configuration: ProviderConfiguration,
	fetcher: typeof fetch = fetch,
): Promise<"all_observed" | "some_observed" | "none_observed" | "inconclusive"> {
	if (
		externalIds.length === 0 ||
		externalIds.length > MAX_TARGETS ||
		externalIds.some((externalId) => !isStripeCheckoutSessionId(externalId)) ||
		new Set(externalIds).size !== externalIds.length
	)
		return "inconclusive";
	const targets = new Set(externalIds);
	let expectedTotalOrders: number | null = null;
	let expectedTotalPages: number | null = null;
	let rowsRead = 0;
	const matchedExternalIds = new Set<string>();
	const seenOrderNumbers = new Set<string>();

	try {
		for (let page = 1; page <= MAX_PAGES; page += 1) {
			const query = new URLSearchParams({
				storeId: String(configuration.storeId),
				page: String(page),
			});
			let response: Response;
			try {
				response = await fetcher(`${configuration.baseUrl}/api/v1/orders?${query}`, {
					method: "GET",
					cache: "no-store",
					redirect: "error",
					headers: {
						Accept: "application/json",
						"Content-Type": "application/json",
						Authorization: `Basic ${Buffer.from(
							`${configuration.apiKey}:${configuration.apiSecret}`,
						).toString("base64")}`,
					},
					signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
				});
			} catch {
				return "inconclusive";
			}
			if (response.status === 404 && page === 1) {
				await discardBody(response);
				return "none_observed";
			}
			if (!response.ok) {
				await discardBody(response);
				return "inconclusive";
			}
			const parsed = parsePage(await readBoundedJson(response), configuration.storeId);
			if (
				parsed.currentPage !== page ||
				(parsed.totalOrders === 0
					? page !== 1 ||
						parsed.orders.length !== 0 ||
						(parsed.totalPages !== 0 && parsed.totalPages !== 1)
					: parsed.totalPages < page || parsed.totalPages > parsed.totalOrders) ||
				parsed.totalPages > MAX_PAGES ||
				parsed.totalOrders > MAX_ROWS
			)
				return "inconclusive";
			if (expectedTotalOrders === null) {
				expectedTotalOrders = parsed.totalOrders;
				expectedTotalPages = parsed.totalPages;
			} else if (
				parsed.totalOrders !== expectedTotalOrders ||
				parsed.totalPages !== expectedTotalPages
			)
				return "inconclusive";
			if (parsed.totalOrders === 0) return "none_observed";
			if (page < parsed.totalPages && parsed.orders.length === 0) return "inconclusive";
			rowsRead += parsed.orders.length;
			if (rowsRead > parsed.totalOrders || rowsRead > MAX_ROWS) return "inconclusive";
			for (const row of parsed.orders) {
				if (seenOrderNumbers.has(row.orderNumber)) return "inconclusive";
				seenOrderNumbers.add(row.orderNumber);
				if (!targets.has(row.externalId)) continue;
				if (matchedExternalIds.has(row.externalId)) return "inconclusive";
				matchedExternalIds.add(row.externalId);
			}
			if (page === parsed.totalPages) {
				if (rowsRead !== parsed.totalOrders) return "inconclusive";
				if (matchedExternalIds.size === 0) return "none_observed";
				return matchedExternalIds.size === targets.size ? "all_observed" : "some_observed";
			}
		}
	} catch {
		return "inconclusive";
	}
	return "inconclusive";
}

export async function observeProviderMatch(
	externalId: string,
	configuration: ProviderConfiguration,
	fetcher: typeof fetch = fetch,
): Promise<"observed" | "not_observed" | "inconclusive"> {
	const result = await observeProviderMatches([externalId], configuration, fetcher);
	if (result === "all_observed") return "observed";
	if (result === "none_observed") return "not_observed";
	return "inconclusive";
}

export async function runProviderInvestigation(dependencies: {
	getTarget: () => Promise<ProviderInvestigationTarget>;
	observeMatch: (externalId: string) => Promise<"observed" | "not_observed" | "inconclusive">;
}): Promise<ProviderInvestigationResult> {
	let target: ProviderInvestigationTarget;
	try {
		target = await dependencies.getTarget();
	} catch {
		return "provider_investigation:configuration_error";
	}
	if (target.outcome !== "ready") return `provider_investigation:${target.outcome}`;
	let observation: "observed" | "not_observed" | "inconclusive";
	try {
		observation = await dependencies.observeMatch(target.externalId);
	} catch {
		observation = "inconclusive";
	}
	let confirmed: ProviderInvestigationTarget;
	try {
		confirmed = await dependencies.getTarget();
	} catch {
		return "provider_investigation:target_conflict";
	}
	if (confirmed.outcome !== "ready" || confirmed.externalId !== target.externalId) {
		return "provider_investigation:target_conflict";
	}
	if (observation === "observed") return "provider_investigation:match_observed";
	if (observation === "not_observed") return "provider_investigation:match_not_observed";
	return "provider_investigation:inconclusive";
}

export async function runProviderMultiInvestigation(dependencies: {
	getTargets: () => Promise<ProviderMultiInvestigationTargets>;
	observeMatches: (
		externalIds: readonly string[],
	) => Promise<"all_observed" | "some_observed" | "none_observed" | "inconclusive">;
}): Promise<ProviderMultiInvestigationResult> {
	let targets: ProviderMultiInvestigationTargets;
	try {
		targets = await dependencies.getTargets();
	} catch {
		return "provider_multi_investigation:configuration_error";
	}
	if (targets.outcome !== "ready") return `provider_multi_investigation:${targets.outcome}`;
	let observation: "all_observed" | "some_observed" | "none_observed" | "inconclusive";
	try {
		observation = await dependencies.observeMatches(targets.externalIds);
	} catch {
		observation = "inconclusive";
	}
	let confirmed: ProviderMultiInvestigationTargets;
	try {
		confirmed = await dependencies.getTargets();
	} catch {
		return "provider_multi_investigation:target_conflict";
	}
	if (
		confirmed.outcome !== "ready" ||
		confirmed.externalIds.length !== targets.externalIds.length ||
		confirmed.externalIds.some((externalId, index) => externalId !== targets.externalIds[index])
	)
		return "provider_multi_investigation:target_conflict";
	return `provider_multi_investigation:${observation}`;
}
