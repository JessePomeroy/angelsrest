import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrderItem } from "$lib/shop/types";
import { preparePrintSources, printGeometry, readPrintSource } from "../printSourcePreparation";

describe("print source preparation", () => {
	afterEach(() => vi.unstubAllGlobals());

	it.each([
		[
			"4x6",
			{ width: 4, height: 6, paperSubcategoryId: 103001 },
			{ width: 6000, height: 4000 },
			[1800, 1200, 300],
		],
		[
			"11x14",
			{ width: 11, height: 14, paperSubcategoryId: 103001 },
			{ width: 6000, height: 4000 },
			[4200, 3300, 300],
		],
		[
			"quarter-inch border",
			{ width: 6, height: 4, borderWidth: 0.25, paperSubcategoryId: 103001 },
			{ width: 6000, height: 4000 },
			[1800, 1200, 300],
		],
		[
			"one-inch border",
			{ width: 6, height: 4, borderWidth: 1, paperSubcategoryId: 103001 },
			{ width: 6000, height: 4000 },
			[1800, 1200, 300],
		],
		[
			"portrait",
			{ width: 6, height: 4, paperSubcategoryId: 103001 },
			{ width: 4000, height: 6000 },
			[1200, 1800, 300],
		],
		[
			"24x36 canvas",
			{ width: 24, height: 36, paperSubcategoryId: 101001 },
			{ width: 8000, height: 6000 },
			[7200, 4800, 200],
		],
	])("renders %s inside the bounded ordered canvas", (_name, item, source, expected) => {
		const geometry = printGeometry(item, source);
		expect([geometry.outerWidth, geometry.outerHeight, geometry.dpi]).toEqual(expected);
		expect(geometry.outerWidth * geometry.outerHeight).toBeLessThanOrEqual(40_000_000);
	});

	it.each([
		[
			{ width: 40, height: 60, paperSubcategoryId: 101001 },
			{ width: 30_000, height: 20_000 },
			[7740, 5160, 129],
		],
		[
			{ width: 16, height: 20, paperSubcategoryId: 103001 },
			{ width: 4_000, height: 3_000 },
			[3740, 2992, 187],
		],
	])("caps rendering density without rejecting native-resolution prints", (item, source, expected) => {
		const geometry = printGeometry(item, source);
		expect([geometry.outerWidth, geometry.outerHeight, geometry.dpi]).toEqual(expected);
		expect(geometry.outerWidth * geometry.outerHeight).toBeLessThanOrEqual(40_000_000);
		expect(geometry.innerWidth).toBeLessThanOrEqual(source.width);
		expect(geometry.innerHeight).toBeLessThanOrEqual(source.height);
	});

	it("renders an exact JPEG with an inset white border and flattened artwork", async () => {
		const input = await sharp({
			create: {
				width: 1800,
				height: 1200,
				channels: 4,
				background: { r: 220, g: 0, b: 0, alpha: 0.5 },
			},
		})
			.png()
			.toBuffer();
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(new Uint8Array(input), {
						headers: { "Content-Length": String(input.byteLength), "Content-Type": "image/png" },
					}),
			),
		);
		let output = new Uint8Array();
		const store = vi.fn(async (_siteUrl, rendered) => {
			output = rendered.bytes;
			return "https://worker.example/prepared.jpg";
		});
		const item: OrderItem = {
			imageUrl: "https://worker.example/source.png",
			paperSubcategoryId: 103001,
			width: 6,
			height: 4,
			quantity: 1,
			borderWidth: 0.25,
		};

		const [prepared] = await preparePrintSources([item], { siteUrl: "angelsrest.online", store });
		const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
		const center = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 3;

		expect(prepared).toMatchObject({
			imageUrl: "https://worker.example/prepared.jpg",
			sourcePolicy: "opaque_capability",
			width: 6,
			height: 4,
		});
		expect([info.width, info.height, info.channels]).toEqual([1800, 1200, 3]);
		expect([...data.subarray(0, 3)]).toEqual([255, 255, 255]);
		expect(data[center]).toBeGreaterThan(data[center + 1]);
		expect(prepared.borderWidth).toBe(0.25);
		expect(store.mock.calls[0]?.[1].geometry).toMatchObject({
			left: 75,
			right: 75,
			top: 75,
			bottom: 75,
		});
	});

	it("stops reading an undeclared oversized response", async () => {
		const cancel = vi.fn();
		const response = {
			headers: new Headers(),
			body: {
				getReader: () => ({
					read: vi
						.fn()
						.mockResolvedValueOnce({ done: false, value: new Uint8Array(2) })
						.mockResolvedValueOnce({ done: false, value: new Uint8Array(2) }),
					cancel,
					releaseLock: vi.fn(),
				}),
			},
		} as unknown as Response;

		await expect(readPrintSource(response, 3)).rejects.toThrow("Print source is too large");
		expect(cancel).toHaveBeenCalledOnce();
	});
});
