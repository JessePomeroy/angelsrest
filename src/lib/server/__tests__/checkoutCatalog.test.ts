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
		const fetcher = (async () => ({
			title: "real print",
			image: null,
			variants: [{ paper: "archival-matte", size: "8x10", retailPrice: 42 }],
			bordersEnabled: true,
			framedEnabled: true,
			frameMarkupMultiplier: 2,
			inStock: true,
		})) as CheckoutFetcher;

		const item = await resolveCheckoutItem(fetcher, {
			productId: "real-print",
			paperSlug: "archival-matte",
			sizeSlug: "8x10",
			// Simulates a tampered legacy/browser payload. The resolver ignores it.
			price: 1,
			title: "fake title",
		} as any);

		expect(item.title).toBe("real print");
		expect(item.price).toBe(42);
		expect(item.paper).toMatchObject({
			name: "Archival Matte",
			subcategoryId: 103001,
			width: 8,
			height: 10,
		});
	});

	it("adds the server-computed frame surcharge and fulfillment metadata", async () => {
		const fetcher = (async () => ({
			title: "framed print",
			image: null,
			variants: [{ paper: "glossy", size: "8x10", retailPrice: 40 }],
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

		expect(item.price).toBe(80.16);
		expect(item.paper).toMatchObject({
			subcategoryId: 103007,
			borderWidth: 0.25,
			frameSubcategoryId: 105001,
		});
	});

	it("uses V1 paperIndex as a selector and ignores browser-supplied title/price", async () => {
		let queryCount = 0;
		const fetcher = (async () => {
			queryCount += 1;
			if (queryCount === 1) return null;
			return {
				title: "legacy print",
				price: 20,
				category: "prints",
				inStock: true,
				images: [],
				availablePapers: [
					{ name: "Archival Matte 4x6|103001|4|6", price: 12 },
					{ name: "Glossy 8x10|103007|8|10", price: 30 },
				],
			};
		}) as CheckoutFetcher;

		const item = await resolveCheckoutItem(fetcher, {
			productId: "legacy-print",
			paperIndex: 1,
			price: 1,
			title: "fake title",
		} as any);

		expect(item.title).toBe("legacy print");
		expect(item.price).toBe(30);
		expect(item.paper).toMatchObject({
			name: "Glossy 8x10",
			subcategoryId: 103007,
			width: 8,
			height: 10,
		});
	});

	it("resolves print set images server-side", async () => {
		let queryCount = 0;
		const fetcher = (async () => {
			queryCount += 1;
			if (queryCount === 1) return null;
			return {
				title: "legacy set",
				previewImage: null,
				images: ["img-a", "img-b"],
				price: 70,
				availablePapers: ["Archival Matte 8x10|103001|8|10"],
			};
		}) as CheckoutFetcher;

		const item = await resolveCheckoutItem(fetcher, {
			productId: "legacy-set",
			isPrintSet: true,
			paperIndex: 0,
		});

		expect(item.isPrintSet).toBe(true);
		expect(item.price).toBe(70);
		expect(item.images).toHaveLength(2);
	});
});
