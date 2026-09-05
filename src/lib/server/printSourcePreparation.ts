import { createHash } from "node:crypto";
import { getPrintTargetDpi } from "@jessepomeroy/print-catalog";
import sharp from "sharp";
import { storeRenderedPrintSource } from "$lib/server/catalogCommerceClients";
import { FulfillmentValidationError } from "$lib/server/fulfillmentValidationError";
import type { OrderItem } from "$lib/shop/types";

const MAX_INPUT_BYTES = 100_000_000;
const MAX_INPUT_PIXELS = 100_000_000;
const MAX_OUTPUT_PIXELS = 40_000_000;

export type PrintGeometry = {
	dpi: number;
	widthInches: number;
	heightInches: number;
	outerWidth: number;
	outerHeight: number;
	innerWidth: number;
	innerHeight: number;
	left: number;
	top: number;
	right: number;
	bottom: number;
};

function positive(value: number) {
	return Number.isFinite(value) && value > 0;
}

export function printGeometry(
	item: Pick<
		OrderItem,
		"width" | "height" | "borderWidth" | "paperSubcategoryId" | "frameSubcategoryId"
	>,
	source: { width: number; height: number },
): PrintGeometry {
	if (![item.width, item.height, source.width, source.height].every(positive)) {
		throw new FulfillmentValidationError("Print dimensions are invalid");
	}
	const sourceIsLandscape = source.width > source.height;
	const itemIsLandscape = item.width > item.height;
	const swap = source.width !== source.height && sourceIsLandscape !== itemIsLandscape;
	const widthInches = swap ? item.height : item.width;
	const heightInches = swap ? item.width : item.height;
	const border = item.borderWidth ?? 0;
	const innerWidthInches = widthInches - 2 * border;
	const innerHeightInches = heightInches - 2 * border;
	if (
		!Number.isFinite(border) ||
		border < 0 ||
		!positive(innerWidthInches) ||
		!positive(innerHeightInches)
	) {
		throw new FulfillmentValidationError("Print border is invalid");
	}
	const targetDpi = getPrintTargetDpi(item.frameSubcategoryId ?? item.paperSubcategoryId);
	if (!targetDpi) throw new FulfillmentValidationError("Print product is unsupported");
	// Density is a rendering target, not a provider acceptance floor. Never upscale.
	const dpi = Math.floor(
		Math.min(
			targetDpi,
			source.width / innerWidthInches,
			source.height / innerHeightInches,
			Math.sqrt(MAX_OUTPUT_PIXELS / (widthInches * heightInches)),
		),
	);
	const outerWidth = Math.round(widthInches * dpi);
	const outerHeight = Math.round(heightInches * dpi);
	const innerWidth = Math.round(innerWidthInches * dpi);
	const innerHeight = Math.round(innerHeightInches * dpi);
	if (
		![outerWidth, outerHeight, innerWidth, innerHeight].every(positive) ||
		outerWidth * outerHeight > MAX_OUTPUT_PIXELS ||
		source.width < innerWidth ||
		source.height < innerHeight
	) {
		throw new FulfillmentValidationError("Print source resolution is invalid");
	}
	const horizontal = outerWidth - innerWidth;
	const vertical = outerHeight - innerHeight;
	return {
		dpi,
		widthInches,
		heightInches,
		outerWidth,
		outerHeight,
		innerWidth,
		innerHeight,
		left: Math.floor(horizontal / 2),
		right: Math.ceil(horizontal / 2),
		top: Math.floor(vertical / 2),
		bottom: Math.ceil(vertical / 2),
	};
}

export async function readPrintSource(response: Response, maximumBytes = MAX_INPUT_BYTES) {
	const declared = response.headers.get("content-length");
	if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) {
		throw new FulfillmentValidationError("Print source is too large");
	}
	if (!response.body) throw new FulfillmentValidationError("Print source is empty");
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > maximumBytes) {
				await reader.cancel();
				throw new FulfillmentValidationError("Print source is too large");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	if (bytes === 0) throw new FulfillmentValidationError("Print source is empty");
	return Buffer.concat(chunks, bytes);
}

async function fetchSource(imageUrl: string) {
	const response = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
	if (!response.ok) throw new Error(`Print source rejected (${response.status})`);
	return readPrintSource(response);
}

export async function renderPrintSource(item: OrderItem) {
	const source = await fetchSource(item.imageUrl);
	const options = {
		autoOrient: true,
		failOn: "warning" as const,
		limitInputPixels: MAX_INPUT_PIXELS,
	};
	const metadata = await sharp(source, options).metadata();
	const geometry = printGeometry(item, metadata.autoOrient);
	const { data, info } = await sharp(source, options)
		.resize(geometry.innerWidth, geometry.innerHeight, {
			fit: "cover",
			position: "centre",
			withoutEnlargement: true,
		})
		.flatten({ background: "#fff" })
		.extend({
			top: geometry.top,
			bottom: geometry.bottom,
			left: geometry.left,
			right: geometry.right,
			background: "#fff",
		})
		.toColourspace("srgb")
		.withMetadata({ density: geometry.dpi })
		.jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
		.timeout({ seconds: 6 })
		.toBuffer({ resolveWithObject: true });
	if (
		info.format !== "jpeg" ||
		info.width !== geometry.outerWidth ||
		info.height !== geometry.outerHeight ||
		data.byteLength > MAX_INPUT_BYTES
	) {
		throw new FulfillmentValidationError("Prepared print source is invalid");
	}
	return {
		bytes: data,
		hash: createHash("sha256").update(data).digest("hex"),
		width: info.width,
		height: info.height,
		geometry,
	};
}

export async function preparePrintSources(
	items: readonly OrderItem[],
	{
		siteUrl,
		store = storeRenderedPrintSource,
	}: {
		siteUrl: string;
		store?: typeof storeRenderedPrintSource;
	},
) {
	const prepared: OrderItem[] = [];
	for (const item of items) {
		const rendered = await renderPrintSource(item);
		prepared.push({
			...item,
			width: rendered.geometry.widthInches,
			height: rendered.geometry.heightInches,
			imageUrl: await store(siteUrl, rendered),
			sourcePolicy: "opaque_capability",
		});
	}
	return prepared;
}
