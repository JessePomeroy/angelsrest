import { describe, expect, test } from "vitest";
import {
	compareDecodedPixelBuffers,
	hasExpectedLossyWebpFidelity,
	measureDecodedPixelFidelity,
	pixelParityOptions,
} from "./sanity-blog-pixel-parity";

describe("Blog pixel parity", () => {
	test("requires exact decoded pixel equality", () => {
		expect(compareDecodedPixelBuffers(Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 2, 3]))).toBe(
			true,
		);
		expect(compareDecodedPixelBuffers(Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 2, 4]))).toBe(
			false,
		);
		expect(compareDecodedPixelBuffers(Uint8Array.from([1, 2]), Uint8Array.from([1, 2, 3]))).toBe(
			false,
		);
	});

	test("requires explicit private target and new report paths", () => {
		expect(
			pixelParityOptions([
				"--source-file",
				"source.png",
				"--target-file",
				"master.webp",
				"--out",
				"report.json",
			]),
		).toMatchObject({
			sourceFile: expect.stringMatching(/source\.png$/),
			targetFile: expect.stringMatching(/master\.webp$/),
			out: expect.stringMatching(/report\.json$/),
		});
		expect(() => pixelParityOptions(["--out", "report.json"])).toThrow(/target-file/);
		expect(() => pixelParityOptions(["--target-url", "https://example.com"])).toThrow(
			/Unsupported/,
		);
	});

	test("cannot substitute the source path for the private target path", () => {
		expect(() =>
			pixelParityOptions([
				"--source-file",
				"same-image.png",
				"--target-file",
				"same-image.png",
				"--out",
				"report.json",
			]),
		).toThrow(/distinct/);
	});

	test("accepts only a high-fidelity lossy normalization envelope", () => {
		const exact = measureDecodedPixelFidelity(
			Uint8Array.from([10, 20, 30]),
			Uint8Array.from([10, 20, 30]),
		);
		expect(exact.meanAbsoluteError).toBe(0);
		expect(exact.peakSignalToNoiseRatio).toBeNull();
		const lossy = measureDecodedPixelFidelity(
			Uint8Array.from([10, 20, 30, 40, 50, 60]),
			Uint8Array.from([11, 19, 31, 39, 51, 59]),
		);
		expect(hasExpectedLossyWebpFidelity(lossy)).toBe(true);
		const wrong = measureDecodedPixelFidelity(
			Uint8Array.from([0, 0, 0]),
			Uint8Array.from([255, 255, 255]),
		);
		expect(hasExpectedLossyWebpFidelity(wrong)).toBe(false);
	});
});
