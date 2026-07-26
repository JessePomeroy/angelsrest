import { describe, expect, it, vi } from "vitest";

vi.mock("$lib/utils/images", async () => {
	const actual = await vi.importActual<typeof import("$lib/utils/images")>("$lib/utils/images");
	return {
		...actual,
		originalUrl: () => null,
		previewUrl: () => null,
		imageSet: (image: unknown) =>
			typeof image === "string"
				? { full: "", thumb: "", original: `https://cdn.example/${image}.jpg`, alt: "" }
				: null,
	};
});

import { resolveCheckoutItem } from "$lib/server/checkoutCatalog";

type CheckoutFetcher = Parameters<typeof resolveCheckoutItem>[0];

describe("resolveCheckoutItem", () => {
	it("resolves V2 product price from Sanity variant, not request price", async () => {
		let query = "";
		const fetcher = (async (candidate: string) => {
			query = candidate;
			return {
				_id: "published-print",
				_rev: "print-rev",
				title: "real print",
				image: null,
				variants: [
					{ _key: "variant-matte-8x10", paper: "archival-matte", size: "8x10", retailPrice: 42 },
				],
				bordersEnabled: true,
				framedEnabled: true,
				frameMarkupMultiplier: 2,
				inStock: true,
			};
		}) as CheckoutFetcher;

		const item = await resolveCheckoutItem(fetcher, {
			productId: "real-print",
			paperSlug: "archival-matte",
			sizeSlug: "8x10",
			// Simulates a tampered legacy/browser payload. The resolver ignores it.
			price: 1,
			title: "fake title",
		} as unknown as Parameters<typeof resolveCheckoutItem>[1]);

		expect(item.title).toBe("real print");
		expect(item.unitPriceCents).toBe(4200);
		expect(query).toMatch(/_id[\s\S]*_rev[\s\S]*_key/);
		expect(item.snapshot).toEqual({
			productKey: "published-print",
			revisionId: "print-rev",
			productKind: "print",
			variantKey: "variant-matte-8x10",
			materialOptionKey: "archival-matte",
			sizeOptionKey: "8x10",
			borderOptionKey: "none",
			frameOptionKey: "none",
		});
		expect(item.legacyFulfillment.paper).toMatchObject({
			name: "Archival Matte",
			subcategoryId: 103001,
			width: 8,
			height: 10,
		});
	});

	it("adds the server-computed frame surcharge and fulfillment metadata", async () => {
		const fetcher = (async () => ({
			_id: "published-framed",
			_rev: "framed-rev",
			title: "framed print",
			image: null,
			variants: [{ _key: "variant-glossy-8x10", paper: "glossy", size: "8x10", retailPrice: 40 }],
			bordersEnabled: true,
			framedEnabled: true,
			frameMarkupMultiplier: 2,
			inStock: true,
		})) as CheckoutFetcher;

		const item = await resolveCheckoutItem(fetcher, {
			productId: "framed-print",
			paperSlug: "glossy",
			sizeSlug: "8x10",
			frame: "0.875-black",
			borderWidth: "none",
		});

		expect(item.unitPriceCents).toBe(8016);
		expect(item.legacyFulfillment.paper).toMatchObject({
			subcategoryId: 103007,
			borderWidth: 0.25,
			frameSubcategoryId: 105001,
		});
	});

	it("resolves V2 print set price and images server-side", async () => {
		const fetcher = (async () => ({
			_id: "published-set",
			_rev: "set-rev",
			title: "current set",
			previewImage: null,
			images: ["img-a", "img-b"],
			variants: [{ _key: "set-variant", paper: "archival-matte", size: "8x10", retailPrice: 70 }],
			bordersEnabled: true,
			framedEnabled: false,
			inStock: true,
		})) as CheckoutFetcher;

		const item = await resolveCheckoutItem(fetcher, {
			productId: "current-set",
			isPrintSet: true,
			paperSlug: "archival-matte",
			sizeSlug: "8x10",
		});

		expect(item.legacyFulfillment.isPrintSet).toBe(true);
		expect(item.unitPriceCents).toBe(7000);
		expect(item.legacyFulfillment.imageUrls).toHaveLength(2);
	});

	it("returns a 404 after one V2 query when a print set is missing", async () => {
		const fetcher = vi.fn().mockResolvedValue(null) as CheckoutFetcher;

		await expect(
			resolveCheckoutItem(fetcher, {
				productId: "missing-set",
				isPrintSet: true,
				paperSlug: "archival-matte",
				sizeSlug: "8x10",
			}),
		).rejects.toMatchObject({ status: 404 });
		expect(fetcher).toHaveBeenCalledOnce();
	});

	it("falls back from V2 to V1 only on null and never on an upstream error", async () => {
		const v1 = {
			_id: "general-product",
			_rev: "general-rev",
			title: "Trusted tapestry",
			price: 189,
			category: "tapestries",
			images: [],
		};
		const fallback = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(v1);
		await expect(resolveCheckoutItem(fallback, { productId: "tapestry" })).resolves.toMatchObject({
			unitPriceCents: 18_900,
			snapshot: { productKind: "tapestry", variantKey: null },
		});
		expect(fallback).toHaveBeenCalledTimes(2);
		expect(String(fallback.mock.calls[1]?.[0])).toMatch(/availablePapers[\s\S]*_key/);
		const failed = vi.fn().mockRejectedValue(new Error("sanity unavailable"));
		await expect(resolveCheckoutItem(failed, { productId: "tapestry" })).rejects.toThrow(
			"sanity unavailable",
		);
		expect(failed).toHaveBeenCalledOnce();
	});

	it("rejects only explicit false stock and maps every supported general category exactly", async () => {
		for (const [category, kind] of [
			["prints", "print"],
			["postcards", "postcard"],
			["tapestries", "tapestry"],
			["digital", "digital_download"],
			["merchandise", "merchandise"],
		] as const) {
			const fetcher = vi
				.fn()
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce({
					_id: `product-${kind}`,
					_rev: `revision-${kind}`,
					title: `Trusted ${kind}`,
					price: 10,
					category,
					images: [],
					inStock: undefined,
				});
			const item = await resolveCheckoutItem(fetcher, { productId: kind });
			expect(item.snapshot.productKind).toBe(kind);
		}
		const unsupported = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
			_id: "unsupported",
			_rev: "unsupported-rev",
			title: "Unsupported",
			price: 1,
			category: "postcard",
			images: [],
		});
		await expect(
			resolveCheckoutItem(unsupported, { productId: "unsupported" }),
		).rejects.toMatchObject({ status: 400 });
	});

	it("preserves legacy paper matching while capturing the selected Sanity key", async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({
				_id: "legacy-paper-product",
				_rev: "legacy-paper-rev",
				title: "Legacy paper",
				price: 20,
				category: "prints",
				images: [],
				availablePapers: [
					{
						_key: "paper-source-key",
						name: "Glossy 8x10|103007|8|10",
						price: 30,
					},
				],
			});
		const item = await resolveCheckoutItem(fetcher, {
			productId: "legacy-paper",
			paper: { name: "Glossy 8x10", subcategoryId: "103007", width: 8, height: 10 },
		});
		expect(item.snapshot).toMatchObject({
			productKind: "print",
			variantKey: "paper-source-key",
			materialOptionKey: null,
			sizeOptionKey: null,
		});
	});
});
