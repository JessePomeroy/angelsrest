import { describe, expect, it } from "vitest";
import {
	CANVAS_AVAILABLE_SIZES,
	FRAMED_BORDER_INCHES,
	getFrameWholesaleCost,
	getPaper,
	getPaperBySlug,
	getSizeBySlug,
	getWholesaleCost,
	LUMA_PAPERS,
	LUMA_SIZES,
	LUMA_WHOLESALE_COSTS,
	PAPER_DROPDOWN_OPTIONS,
	parseCanvasSlug,
	SIZE_DROPDOWN_OPTIONS,
	V2_PAPERS,
	V2_SIZES,
	V2_WHOLESALE_COSTS,
} from ".";

describe("@jessepomeroy/print-catalog", () => {
	it("keeps legacy Luma aliases pointed at the V2 catalog arrays", () => {
		expect(LUMA_PAPERS).toBe(V2_PAPERS);
		expect(LUMA_SIZES).toBe(V2_SIZES);
		expect(LUMA_WHOLESALE_COSTS).toBe(V2_WHOLESALE_COSTS);
	});

	it("contains the expected paper, size, and wholesale matrix", () => {
		expect(V2_PAPERS).toHaveLength(6);
		expect(V2_SIZES).toHaveLength(9);
		expect(V2_WHOLESALE_COSTS).toHaveLength(54);
		expect(getWholesaleCost("archival-matte", "8x10")).toBe(3.19);
		expect(getWholesaleCost("somerset-velvet", "40x60")).toBe(76.24);
	});

	it("supports site-style and studio-style frame wholesale lookup", () => {
		expect(getFrameWholesaleCost("0.875-black", "8x10")).toBe(20.08);
		expect(getFrameWholesaleCost("1.25-oak", "8x10")).toBe(20.8);
		expect(getFrameWholesaleCost("8x10")).toBe(20.08);
	});

	it("resolves canvas metadata for checkout and Studio dropdowns", () => {
		expect(CANVAS_AVAILABLE_SIZES).toEqual(["8x10", "11x14", "16x20", "24x36", "30x40", "40x60"]);
		expect(parseCanvasSlug("canvas-white-1.25")).toEqual({
			color: "white",
			thickness: "1.25",
			subcategoryId: 101002,
			wrapOptionId: 3,
			wrapHex: "#FFFFFF",
		});
		expect(getWholesaleCost("canvas-black-1.25", "16x20")).toBe(25.95);
		expect(getPaper("canvas-black-rolled")?.name).toBe("Canvas Black — rolled");
	});

	it("exports stable Sanity dropdown helpers", () => {
		expect(PAPER_DROPDOWN_OPTIONS[0]).toEqual({ title: "Archival Matte", value: "archival-matte" });
		expect(PAPER_DROPDOWN_OPTIONS.at(-1)).toEqual({
			title: "Canvas White — rolled",
			value: "canvas-white-rolled",
		});
		expect(SIZE_DROPDOWN_OPTIONS[3]).toEqual({ title: "8×10", value: "8x10" });
	});

	it("keeps legacy lookup helper contracts", () => {
		expect(getPaperBySlug("glossy")?.subcategoryId).toBe(103007);
		expect(getPaperBySlug("missing")).toBeNull();
		expect(getSizeBySlug("24x36")?.width).toBe(24);
		expect(FRAMED_BORDER_INCHES).toBe(0.25);
	});
});
