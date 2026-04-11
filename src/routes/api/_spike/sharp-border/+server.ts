/**
 * Sharp Feasibility Spike — audit #24 / PR #2.
 *
 * Standalone measurement endpoint that downloads a source image from a
 * Sanity CDN URL (or any public URL), composites a white border onto it
 * using Sharp, and returns a timing breakdown + memory delta so we can
 * decide whether Vercel serverless + Sharp is viable for Path B of the
 * LumaPrints expansion (bordered unframed prints).
 *
 * **This is NOT production code.** It exists only to measure. It will be
 * deleted in PR #6 (the real Sharp border compositing implementation) and
 * replaced with webhook-integrated logic. The `_spike` path prefix marks
 * the route as temporary.
 *
 * Auth: simple bearer token from SHARP_SPIKE_TOKEN env var. Without a
 * token the endpoint 500s; with a wrong token it 401s. Prevents random
 * strangers from abusing the compute sink.
 *
 * Request:
 *   POST /api/_spike/sharp-border
 *   Authorization: Bearer <SHARP_SPIKE_TOKEN>
 *   Content-Type: application/json
 *   {
 *     "imageUrl": "https://cdn.sanity.io/...",   // OR imageUrls: [...]
 *     "borderInches": 0.5,
 *     "targetDpi": 300,                           // optional, default 300
 *     "returnHash": true                          // optional, default false
 *   }
 *
 * Response: timing breakdown per image + memory delta + total wall time.
 *
 * Pass/fail thresholds (from the spec note):
 *   - Single-item composite total < 5s for ~10 MB input (YOUR photos are
 *     12-38 MB, so this budget may need relaxing before making the call)
 *   - 5-item sequential total < 20s (leaves 10s headroom under the 30s
 *     Stripe webhook timeout)
 *   - Memory RSS delta < 500 MB per composite (Vercel default 1024 MB)
 *   - Cold start adds < 3s
 */

import { createHash } from "node:crypto";
import { json } from "@sveltejs/kit";
import sharp from "sharp";
import { env } from "$env/dynamic/private";
import type { RequestHandler } from "./$types";

export const config = {
	runtime: "nodejs22.x",
	maxDuration: 30,
};

interface SharpSpikeRequest {
	imageUrl?: string;
	imageUrls?: string[];
	borderInches: number;
	targetDpi?: number;
	returnHash?: boolean;
}

interface TimingBreakdown {
	downloadMs: number;
	metadataMs: number;
	sharpPipelineMs: number;
	totalMs: number;
}

interface ImageResult {
	url: string;
	sourceBytes: number;
	sourceWidth: number;
	sourceHeight: number;
	outputBytes: number;
	outputWidth: number;
	outputHeight: number;
	outputSha256?: string;
	timing: TimingBreakdown;
	memoryDeltaMb: number;
}

async function processOne(
	imageUrl: string,
	borderInches: number,
	targetDpi: number,
	returnHash: boolean,
): Promise<ImageResult> {
	const t0 = Date.now();
	const memBefore = process.memoryUsage().rss;

	// Download the source image
	const downloadRes = await fetch(imageUrl);
	if (!downloadRes.ok) {
		throw new Error(
			`Download failed: ${downloadRes.status} ${downloadRes.statusText}`,
		);
	}
	const sourceBuffer = Buffer.from(await downloadRes.arrayBuffer());
	const t1 = Date.now();

	// Read metadata (cheap — just parses the JPEG header)
	const metadata = await sharp(sourceBuffer).metadata();
	if (!metadata.width || !metadata.height) {
		throw new Error("Unable to read source image dimensions");
	}
	const t2 = Date.now();

	// Compute border in pixels. For real LumaPrints orders the border-in-pixels
	// depends on the final print size's DPI, not the source image. For the
	// spike we use targetDpi (300 DPI default) as a reasonable approximation.
	const borderPx = Math.round(borderInches * targetDpi);

	// Chained Sharp pipeline: decode → extend → re-encode as a single
	// libvips stream. This is what production would look like. Measuring
	// each stage separately would create unrealistic numbers because
	// libvips fuses operations internally.
	//
	// Encoding at q100 to match Jesse's PR #6 target (maximum quality for
	// print). Source images should be fetched at `?q=100` from the Sanity
	// CDN — the default no-param URL serves ~q80, `?q=95` serves 11 MB,
	// `?q=100` serves 25 MB for the 5152×7728 event-gallery assets. q=100
	// is the highest quality Sanity's CDN will serve.
	const encoded = await sharp(sourceBuffer)
		.extend({
			top: borderPx,
			bottom: borderPx,
			left: borderPx,
			right: borderPx,
			background: { r: 255, g: 255, b: 255, alpha: 1 },
		})
		.jpeg({ quality: 100 })
		.toBuffer();
	const t3 = Date.now();

	const memAfter = process.memoryUsage().rss;

	const outputSha256 = returnHash
		? createHash("sha256").update(encoded).digest("hex")
		: undefined;

	return {
		url: imageUrl,
		sourceBytes: sourceBuffer.length,
		sourceWidth: metadata.width,
		sourceHeight: metadata.height,
		outputBytes: encoded.length,
		outputWidth: metadata.width + 2 * borderPx,
		outputHeight: metadata.height + 2 * borderPx,
		outputSha256,
		timing: {
			downloadMs: t1 - t0,
			metadataMs: t2 - t1,
			sharpPipelineMs: t3 - t2,
			totalMs: t3 - t0,
		},
		memoryDeltaMb: Math.round((memAfter - memBefore) / (1024 * 1024)),
	};
}

export const POST: RequestHandler = async ({ request }) => {
	// Bearer token auth
	const expectedToken = env.SHARP_SPIKE_TOKEN;
	if (!expectedToken) {
		return json(
			{ error: "SHARP_SPIKE_TOKEN env var not set on the server" },
			{ status: 500 },
		);
	}
	const authHeader = request.headers.get("authorization");
	if (authHeader !== `Bearer ${expectedToken}`) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}

	// Parse request body
	let body: SharpSpikeRequest;
	try {
		body = (await request.json()) as SharpSpikeRequest;
	} catch {
		return json({ error: "Invalid JSON body" }, { status: 400 });
	}

	const borderInches = body.borderInches;
	const targetDpi = body.targetDpi ?? 300;
	const returnHash = body.returnHash ?? false;

	if (
		typeof borderInches !== "number" ||
		borderInches <= 0 ||
		borderInches > 5
	) {
		return json(
			{ error: "borderInches must be a number between 0 and 5" },
			{ status: 400 },
		);
	}

	const urls = body.imageUrls ?? (body.imageUrl ? [body.imageUrl] : []);
	if (urls.length === 0) {
		return json({ error: "imageUrl or imageUrls required" }, { status: 400 });
	}
	if (urls.length > 10) {
		return json({ error: "max 10 URLs per request" }, { status: 400 });
	}

	const overallStart = Date.now();
	const memOverallBefore = process.memoryUsage().rss;
	const results: ImageResult[] = [];
	const errors: { url: string; error: string }[] = [];

	// Sequential processing — matches what the webhook would do for a
	// print set. Parallel would be faster but Sharp is memory-hungry and
	// concurrent calls risk OOM on Vercel's 1024 MB default.
	for (const url of urls) {
		try {
			results.push(await processOne(url, borderInches, targetDpi, returnHash));
		} catch (err) {
			errors.push({
				url,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	const overallMs = Date.now() - overallStart;
	const memOverallAfter = process.memoryUsage().rss;

	return json({
		sharpVersions: sharp.versions,
		runtime: {
			node: process.version,
			platform: process.platform,
			arch: process.arch,
		},
		request: {
			borderInches,
			targetDpi,
			imageCount: urls.length,
		},
		summary: {
			overallMs,
			successCount: results.length,
			errorCount: errors.length,
			totalSourceBytes: results.reduce((sum, r) => sum + r.sourceBytes, 0),
			totalOutputBytes: results.reduce((sum, r) => sum + r.outputBytes, 0),
			memOverallDeltaMb: Math.round(
				(memOverallAfter - memOverallBefore) / (1024 * 1024),
			),
		},
		perImage: results,
		errors,
	});
};
