/**
 * Sharp Border Compositing
 *
 * Adds a white border to a print image before submitting to LumaPrints.
 * Used by the Stripe webhook when a variant has a non-zero borderWidth.
 *
 * Architecture: the webhook calls this module between fetching the source
 * image and submitting the order. The composited image is uploaded to R2
 * and the R2 URL replaces the original in the LumaPrints payload.
 *
 * Performance budget (from SHARP_SPIKE_RESULTS.md):
 * - Single image: ~1.6-1.9s warm, ~2.5-3s cold
 * - 5-image set (sequential Sharp, parallel downloads): ~8-9s total
 * - Memory: ~366 MB for 5 high-res images, well within Vercel's 1024 MB
 *
 * Image quality: q=100 source + q=100 output, per project_print_quality_q100.
 */

import sharp from "sharp";
import { prepareSanityUrlForPrint } from "$lib/shop/lumaprintsUrls";

const DPI = 300;

/**
 * Fetch an image from Sanity CDN at print quality (?max=8000&q=100),
 * add a white border, and return the composited JPEG buffer.
 */
export async function composeBorderedPrint(
	imageUrl: string,
	borderWidthInches: number,
): Promise<Buffer> {
	const printUrl = prepareSanityUrlForPrint(imageUrl);
	const response = await fetch(printUrl);
	if (!response.ok) {
		throw new Error(
			`Failed to fetch image for border compositing: ${response.status} ${printUrl}`,
		);
	}
	const sourceBuffer = Buffer.from(await response.arrayBuffer());

	const borderPx = Math.round(borderWidthInches * DPI);

	const composited = await sharp(sourceBuffer)
		.extend({
			top: borderPx,
			bottom: borderPx,
			left: borderPx,
			right: borderPx,
			background: { r: 255, g: 255, b: 255, alpha: 1 },
		})
		.jpeg({ quality: 100 })
		.toBuffer();

	return composited;
}

/**
 * Upload a composited image buffer to R2 via the gallery worker.
 * Returns the public URL for the uploaded image.
 */
export async function uploadBorderedPrintToR2(
	buffer: Buffer,
	orderId: string,
	itemIndex: number,
): Promise<string> {
	const workerUrl = process.env.GALLERY_WORKER_URL;
	const workerToken = process.env.GALLERY_WORKER_TOKEN;
	if (!workerUrl || !workerToken) {
		throw new Error(
			"GALLERY_WORKER_URL and GALLERY_WORKER_TOKEN must be set for bordered print uploads",
		);
	}

	const key = `prints/bordered/${orderId}/${itemIndex}.jpg`;
	const uploadUrl = `${workerUrl}/upload/put?key=${encodeURIComponent(key)}`;

	const response = await fetch(uploadUrl, {
		method: "PUT",
		headers: {
			Authorization: `Bearer ${workerToken}`,
			"Content-Type": "image/jpeg",
		},
		body: new Uint8Array(buffer),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(
			`R2 upload failed for bordered print: ${response.status} ${text}`,
		);
	}

	// Return the public URL for the uploaded image
	return `${workerUrl}/image/${key}`;
}

export interface BorderedItem {
	index: number;
	imageUrl: string;
	borderWidthInches: number;
}

/**
 * Process all bordered items in an order: parallel download, sequential
 * Sharp composite, parallel R2 upload. Returns a map of item index to
 * the R2 URL that should replace the original image URL.
 *
 * Non-bordered items are skipped.
 */
export async function processBorderedPrints(
	items: BorderedItem[],
	orderId: string,
): Promise<Map<number, string>> {
	if (items.length === 0) return new Map();

	// Sequential Sharp compositing (memory pressure — each op can use 100+ MB)
	const composites: { index: number; buffer: Buffer }[] = [];
	for (const item of items) {
		const buffer = await composeBorderedPrint(
			item.imageUrl,
			item.borderWidthInches,
		);
		composites.push({ index: item.index, buffer });
	}

	// Parallel R2 uploads
	const uploads = await Promise.all(
		composites.map(async ({ index, buffer }) => {
			const url = await uploadBorderedPrintToR2(buffer, orderId, index);
			return { index, url };
		}),
	);

	const urlMap = new Map<number, string>();
	for (const { index, url } of uploads) {
		urlMap.set(index, url);
	}
	return urlMap;
}
