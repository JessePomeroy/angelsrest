import { describe, expect, test } from "vitest";
import { compareDecodedPixelBuffers } from "./sanity-blog-pixel-parity";

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
});
