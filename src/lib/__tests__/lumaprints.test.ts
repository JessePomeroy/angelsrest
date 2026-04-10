import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderItem, Recipient } from "$lib/shop/types";
import {
	buildLumaPrintsOrder,
	cleanImageUrl,
	createOrder,
	LumaPrintsError,
} from "../server/lumaprints";

// Ported from reflecting-pool per audit #22. Guards the pure functions
// (cleanImageUrl, buildLumaPrintsOrder) and the LumaPrints API error
// handling so this stays correct as the catalog expands.

const mockRecipient: Recipient = {
	firstName: "Jane",
	lastName: "Doe",
	address1: "123 Main St",
	address2: "Apt 4",
	city: "Detroit",
	state: "MI",
	zip: "48201",
	country: "US",
	phone: "313-555-1234",
};

const mockItems: OrderItem[] = [
	{
		imageUrl:
			"https://cdn.sanity.io/images/proj/dataset/photo.jpg?w=1200&fm=webp&q=80",
		paperSubcategoryId: 103001,
		width: 8,
		height: 12,
		quantity: 1,
	},
];

describe("cleanImageUrl", () => {
	it("strips query parameters from Sanity CDN URLs", () => {
		const url =
			"https://cdn.sanity.io/images/proj/dataset/photo.jpg?w=1200&fm=webp&q=80";
		expect(cleanImageUrl(url)).toBe(
			"https://cdn.sanity.io/images/proj/dataset/photo.jpg",
		);
	});

	it("handles URLs without query params unchanged", () => {
		const url = "https://cdn.sanity.io/images/proj/dataset/photo.jpg";
		expect(cleanImageUrl(url)).toBe(url);
	});

	it("handles URLs with hash only (no query)", () => {
		const url = "https://example.com/photo.jpg#section";
		expect(cleanImageUrl(url)).toBe(url);
	});

	it("strips only at the ? character", () => {
		const url = "https://cdn.sanity.io/images/a.jpg?foo=bar";
		expect(cleanImageUrl(url)).not.toContain("?");
	});

	it("handles empty string without throwing", () => {
		expect(cleanImageUrl("")).toBe("");
	});
});

describe("buildLumaPrintsOrder", () => {
	it("creates correct top-level structure", () => {
		const order = buildLumaPrintsOrder(
			"sanity-order-123",
			mockRecipient,
			mockItems,
		);
		expect(order.externalId).toBe("sanity-order-123");
		// from mock env LUMAPRINTS_STORE_ID = "83765" in src/__mocks__/env-dynamic.ts
		expect(order.storeId).toBe(83765);
		expect(order.shippingMethod).toBe("default");
	});

	it("maps recipient fields correctly", () => {
		const order = buildLumaPrintsOrder("order-1", mockRecipient, mockItems);
		expect(order.recipient.firstName).toBe("Jane");
		expect(order.recipient.lastName).toBe("Doe");
		expect(order.recipient.addressLine1).toBe("123 Main St");
		expect(order.recipient.addressLine2).toBe("Apt 4");
		expect(order.recipient.city).toBe("Detroit");
		expect(order.recipient.state).toBe("MI");
		expect(order.recipient.zipCode).toBe("48201");
		expect(order.recipient.country).toBe("US");
		expect(order.recipient.phone).toBe("313-555-1234");
	});

	it("uses empty string for optional address2 when not provided", () => {
		const recipientNoAddr2 = { ...mockRecipient, address2: undefined };
		const order = buildLumaPrintsOrder("order-2", recipientNoAddr2, mockItems);
		expect(order.recipient.addressLine2).toBe("");
	});

	it("uses empty string for optional phone when not provided", () => {
		const recipientNoPhone = { ...mockRecipient, phone: undefined };
		const order = buildLumaPrintsOrder("order-3", recipientNoPhone, mockItems);
		expect(order.recipient.phone).toBe("");
	});

	it("always includes option 39 (No Bleed) in orderItemOptions", () => {
		const order = buildLumaPrintsOrder("order-4", mockRecipient, mockItems);
		for (const item of order.orderItems) {
			expect(item.orderItemOptions).toContain(39);
		}
	});

	it("does NOT include option 36 (Bleed) in orderItemOptions", () => {
		const order = buildLumaPrintsOrder("order-5", mockRecipient, mockItems);
		for (const item of order.orderItems) {
			expect(item.orderItemOptions).not.toContain(36);
		}
	});

	it("strips query params from image URLs in order items", () => {
		const order = buildLumaPrintsOrder("order-6", mockRecipient, mockItems);
		for (const item of order.orderItems) {
			expect(item.file.imageUrl).not.toContain("?");
		}
	});

	it("generates correct externalItemId for each item", () => {
		const multiItems: OrderItem[] = [
			{ ...mockItems[0], imageUrl: "https://cdn.example.com/a.jpg" },
			{ ...mockItems[0], imageUrl: "https://cdn.example.com/b.jpg" },
		];
		const order = buildLumaPrintsOrder(
			"multi-order",
			mockRecipient,
			multiItems,
		);
		expect(order.orderItems[0].externalItemId).toBe("multi-order-item-1");
		expect(order.orderItems[1].externalItemId).toBe("multi-order-item-2");
	});

	it("copies width, height, quantity, and subcategoryId to order items", () => {
		const order = buildLumaPrintsOrder("order-7", mockRecipient, mockItems);
		const item = order.orderItems[0];
		expect(item.subcategoryId).toBe(103001);
		expect(item.width).toBe(8);
		expect(item.height).toBe(12);
		expect(item.quantity).toBe(1);
	});

	it("builds multi-item orders correctly (print set support)", () => {
		const printSetItems: OrderItem[] = [
			{
				imageUrl: "https://cdn.sanity.io/images/a.jpg?w=1200",
				paperSubcategoryId: 103001,
				width: 4,
				height: 6,
				quantity: 1,
			},
			{
				imageUrl: "https://cdn.sanity.io/images/b.jpg?w=1200",
				paperSubcategoryId: 103001,
				width: 4,
				height: 6,
				quantity: 1,
			},
			{
				imageUrl: "https://cdn.sanity.io/images/c.jpg?w=1200",
				paperSubcategoryId: 103001,
				width: 4,
				height: 6,
				quantity: 1,
			},
		];
		const order = buildLumaPrintsOrder(
			"print-set-order",
			mockRecipient,
			printSetItems,
		);
		expect(order.orderItems).toHaveLength(3);
		expect(order.orderItems[2].externalItemId).toBe("print-set-order-item-3");
		// All items stripped of query params
		for (const item of order.orderItems) {
			expect(item.file.imageUrl).not.toContain("?");
		}
	});
});

describe("LumaPrintsError", () => {
	it("has correct name and message", () => {
		const err = new LumaPrintsError("Something failed", { code: 42 });
		expect(err.name).toBe("LumaPrintsError");
		expect(err.message).toBe("Something failed");
		expect(err.details).toEqual({ code: 42 });
	});

	it("is an instance of Error", () => {
		expect(new LumaPrintsError("test")).toBeInstanceOf(Error);
	});
});

describe("createOrder", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("throws LumaPrintsError on non-ok response", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				statusText: "Bad Request",
				json: vi.fn().mockResolvedValue({ message: "Invalid order" }),
			}),
		);

		const order = buildLumaPrintsOrder("fail-order", mockRecipient, mockItems);
		await expect(createOrder(order)).rejects.toBeInstanceOf(LumaPrintsError);
	});

	it("carries API details on the thrown error", async () => {
		const apiError = { message: "Invalid order", code: "VALIDATION_FAILED" };
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				statusText: "Bad Request",
				json: vi.fn().mockResolvedValue(apiError),
			}),
		);

		const order = buildLumaPrintsOrder("fail-order", mockRecipient, mockItems);
		try {
			await createOrder(order);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(LumaPrintsError);
			expect((err as LumaPrintsError).details).toEqual(apiError);
		}
	});

	it("returns parsed JSON on success", async () => {
		const mockResponse = { orderNumber: "LP-12345", status: "pending" };
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue(mockResponse),
			}),
		);

		const order = buildLumaPrintsOrder(
			"success-order",
			mockRecipient,
			mockItems,
		);
		const result = await createOrder(order);
		expect(result).toEqual(mockResponse);
	});
});
