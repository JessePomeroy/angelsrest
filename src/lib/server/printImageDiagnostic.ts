import { createHash } from "node:crypto";
import type { FunctionReturnType } from "convex/server";
import sharp from "sharp";
import type { api } from "$convex/api";
import { issueTenantPrintSourceCapability } from "$lib/server/catalogCommerceClients";
import { getLumaPrintsRuntimeConfig } from "$lib/server/runtimeConfig";

type Source = NonNullable<FunctionReturnType<typeof api.printImageDiagnostics.source>>;
type Stage = "configuration" | "capability" | "head" | "download" | "image" | "provider";
type Step = { status?: number; bytes?: number; width?: number; height?: number; matches?: boolean };
export type PrintImageDiagnosticReport = {
	version: 1;
	outcome: "passed" | "failed" | "unverified";
	stage: Stage;
	code: string;
	durationMs: number;
	capability?: { urlLength: number; remainingSeconds: number };
	head?: Step;
	download?: Step;
	image?: Step;
	provider?: Step & {
		recommendedWidth?: number;
		recommendedHeight?: number;
		urlMatches?: boolean;
		dimensionComparison?: "exact" | "transposed" | "different" | "unavailable";
	};
};

/** Shared bounded reader for this diagnostic's tiny request and provider response. */
export async function readPrintDiagnosticBytes(
	body: ReadableStream<Uint8Array> | null,
	maximum: number,
) {
	if (!body) throw new Error("missing_body");
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			size += next.value.byteLength;
			if (size > maximum) throw new Error("body_limit");
			chunks.push(next.value);
		}
		return Buffer.concat(chunks, size);
	} finally {
		void reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
}

function imageHeadersMatch(response: Response, source: Source) {
	return (
		response.status === 200 &&
		response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "image/jpeg" &&
		response.headers.get("content-length") === String(source.descriptor.bytes) &&
		[null, "identity"].includes(response.headers.get("content-encoding"))
	);
}

function dimension(value: unknown): value is number {
	return (
		typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 1_000_000
	);
}

/** No order client, mutations, uploads, or retries belong in this diagnostic. */
export async function diagnosePreparedPrintImage(
	source: Source,
	dependencies = {
		issue: issueTenantPrintSourceCapability,
		fetch,
		configuration: getLumaPrintsRuntimeConfig,
	},
): Promise<PrintImageDiagnosticReport> {
	const started = Date.now();
	const report: PrintImageDiagnosticReport = {
		version: 1,
		outcome: "failed",
		stage: "configuration",
		code: "configuration_unavailable",
		durationMs: 0,
	};
	try {
		const configuration = dependencies.configuration();
		if (configuration.baseUrl !== "https://us.api.lumaprints.com") return report;
		if (
			source.descriptor.mime !== "image/jpeg" ||
			!Number.isSafeInteger(source.descriptor.bytes) ||
			source.descriptor.bytes <= 0 ||
			source.descriptor.bytes > 10_000_000 ||
			!/^[a-f0-9]{64}$/.test(source.descriptor.hash)
		)
			return report;
		report.stage = "capability";
		report.code = "capability_unavailable";
		const capability = await dependencies.issue(source.descriptor, "angelsrest.online");
		const url = new URL(capability.url);
		if (
			url.origin !== "https://cms-media-worker.thinkingofview.workers.dev" ||
			!/^\/v1\/catalog-assets\/fulfillment\/print-source\/[A-Za-z0-9_-]+\.jpg$/.test(
				url.pathname,
			) ||
			url.search ||
			url.hash ||
			url.username ||
			url.password ||
			capability.url.length > 1024 ||
			!Number.isFinite(capability.expiresAt) ||
			capability.expiresAt < Date.now() + 23 * 3_600_000
		)
			return report;
		report.capability = {
			urlLength: capability.url.length,
			remainingSeconds: Math.floor((capability.expiresAt - Date.now()) / 1000),
		};
		const headers = { accept: "image/jpeg", "accept-encoding": "identity" };
		report.stage = "head";
		report.code = "image_head_rejected";
		const head = await dependencies.fetch(capability.url, {
			method: "HEAD",
			headers,
			redirect: "error",
			signal: AbortSignal.timeout(5000),
		});
		report.head = { status: head.status, matches: imageHeadersMatch(head, source) };
		if (!report.head.matches) return report;
		report.stage = "download";
		report.code = "image_download_rejected";
		const download = await dependencies.fetch(capability.url, {
			method: "GET",
			headers,
			redirect: "error",
			signal: AbortSignal.timeout(15_000),
		});
		report.download = { status: download.status, matches: false };
		if (!imageHeadersMatch(download, source)) {
			void download.body?.cancel().catch(() => undefined);
			return report;
		}
		const bytes = await readPrintDiagnosticBytes(download.body, source.descriptor.bytes);
		report.download.bytes = bytes.byteLength;
		report.download.matches =
			bytes.byteLength === source.descriptor.bytes &&
			createHash("sha256").update(bytes).digest("hex") === source.descriptor.hash;
		if (!report.download.matches) return report;
		report.stage = "image";
		report.code = "image_metadata_mismatch";
		const metadata = await sharp(bytes, {
			limitInputPixels: 40_000_000,
			failOn: "warning",
		}).metadata();
		report.image = {
			width: metadata.width,
			height: metadata.height,
			matches:
				metadata.format === "jpeg" &&
				metadata.width === source.descriptor.dimensions.width &&
				metadata.height === source.descriptor.dimensions.height,
		};
		if (!report.image.matches) return report;
		report.stage = "provider";
		report.code = "provider_unavailable";
		const response = await dependencies.fetch(
			`${configuration.baseUrl}/api/v1/images/checkImageConfig`,
			{
				method: "POST",
				redirect: "error",
				signal: AbortSignal.timeout(20_000),
				headers: {
					Authorization: `Basic ${Buffer.from(`${configuration.apiKey}:${configuration.apiSecret}`).toString("base64")}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					subcategoryId: source.product.subcategoryId,
					printWidth: source.printWidth,
					printHeight: source.printHeight,
					orderItemOptions: source.product.orderItemOptions,
					imageUrl: capability.url,
				}),
			},
		);
		report.provider = { status: response.status };
		// HTTP success is distinct from validating the response contract. Keep a
		// transposed or malformed success unverified, not a provider rejection.
		if (response.status === 200) report.outcome = "unverified";
		report.code =
			response.status === 400
				? "provider_image_request_rejected"
				: response.status === 406
					? "provider_image_size_rejected"
					: "provider_response_unverified";
		if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
			void response.body?.cancel().catch(() => undefined);
			return report;
		}
		const payload: unknown = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(
				await readPrintDiagnosticBytes(response.body, 65_536),
			),
		);
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) return report;
		if ("recommendedWidth" in payload && dimension(payload.recommendedWidth))
			report.provider.recommendedWidth = payload.recommendedWidth;
		if ("recommendedHeight" in payload && dimension(payload.recommendedHeight))
			report.provider.recommendedHeight = payload.recommendedHeight;
		if ("actualImageWidth" in payload && dimension(payload.actualImageWidth))
			report.provider.width = payload.actualImageWidth;
		if ("actualImageHeight" in payload && dimension(payload.actualImageHeight))
			report.provider.height = payload.actualImageHeight;
		report.provider.urlMatches = "imageUrl" in payload && payload.imageUrl === capability.url;
		const { width, height } = report.provider;
		report.provider.dimensionComparison =
			width === undefined || height === undefined
				? "unavailable"
				: width === metadata.width && height === metadata.height
					? "exact"
					: width === metadata.height && height === metadata.width
						? "transposed"
						: "different";
		report.provider.matches =
			report.provider.urlMatches && report.provider.dimensionComparison === "exact";
		if (response.status === 200 && report.provider.matches) {
			report.outcome = "passed";
			report.code = "provider_image_validated";
		}
	} catch {
		// Upstream exceptions and echoed image URLs must never reach logs or the response.
	} finally {
		report.durationMs = Date.now() - started;
	}
	return report;
}
