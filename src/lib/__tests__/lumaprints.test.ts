import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "$env/dynamic/private";
import type { OrderItem, Recipient } from "$lib/shop/types";
import {
	buildLumaPrintsOrder,
	checkImageConfig,
	cleanImageUrl,
	createOrder,
	findOrderByExternalId,
	getOrder,
	getShipping,
	getShippingPrice,
	LumaPrintsError,
	LumaPrintsReconciliationError,
	LumaPrintsSubmissionError,
} from "../server/lumaprints";
import { classifyLumaPrintsFailure } from "../server/webhookErrorClassification";

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

function providerJson(value: unknown, init: ResponseInit = {}) {
	const body = JSON.stringify(value);
	const headers = new Headers(init.headers);
	headers.set("content-type", "application/json");
	headers.set("content-length", String(new TextEncoder().encode(body).byteLength));
	return new Response(body, { ...init, headers });
}

function providerPage(
	orders: unknown[],
	{
		totalOrders = orders.length,
		currentPage = 1,
		totalPages = totalOrders === 0 ? 0 : 1,
	}: { totalOrders?: number; currentPage?: number; totalPages?: number } = {},
) {
	return providerJson({ orders, totalOrders, currentPage, totalPages });
}

function listedOrder(
	externalId: string,
	orderNumber: number | string,
	storeId: number | string = 83765,
) {
	return { externalId, orderNumber, storeId, ignoredDocumentedDetail: true };
}

const privateEnv = env as Record<string, string | undefined>;

beforeEach(() => {
	privateEnv.LUMAPRINTS_STORE_ID = "83765";
});

const mockItems: OrderItem[] = [
	{
		imageUrl: "https://cdn.sanity.io/images/proj/dataset/photo.jpg?w=1200&fm=webp&q=80",
		sourcePolicy: "sanity_cdn",
		paperSubcategoryId: 103001,
		width: 8,
		height: 12,
		quantity: 1,
	},
];

describe("cleanImageUrl", () => {
	it("strips query parameters from Sanity CDN URLs", () => {
		const url = "https://cdn.sanity.io/images/proj/dataset/photo.jpg?w=1200&fm=webp&q=80";
		expect(cleanImageUrl(url)).toBe("https://cdn.sanity.io/images/proj/dataset/photo.jpg");
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
		const order = buildLumaPrintsOrder("sanity-order-123", mockRecipient, mockItems);
		expect(order.externalId).toBe("sanity-order-123");
		// from mock env LUMAPRINTS_STORE_ID = "83765" in src/__mocks__/env-dynamic.ts
		expect(order.storeId).toBe(83765);
		expect(order.shippingMethod).toBe("default");
	});

	it("normalizes a decimal store ID to a positive safe integer", () => {
		privateEnv.LUMAPRINTS_STORE_ID = "083765";
		expect(buildLumaPrintsOrder("normalized-store", mockRecipient, mockItems).storeId).toBe(83765);
	});

	it.each([
		undefined,
		"",
		"0",
		"-1",
		"1.5",
		" 83765",
		"8e4",
		"9007199254740992",
	])("rejects a non-positive, unsafe, or malformed store ID", (storeId) => {
		privateEnv.LUMAPRINTS_STORE_ID = storeId;
		expect(() => buildLumaPrintsOrder("invalid-store", mockRecipient, mockItems)).toThrow(
			LumaPrintsError,
		);
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

	it("uses no-bleed only for direct Fine Art Paper", () => {
		const direct = buildLumaPrintsOrder("order-4", mockRecipient, mockItems);
		const framed = buildLumaPrintsOrder("order-framed", mockRecipient, [
			{ ...mockItems[0], frameSubcategoryId: 203001 },
		]);
		const canvas = buildLumaPrintsOrder("order-canvas", mockRecipient, [
			{ ...mockItems[0], canvasSubcategoryId: 303001, canvasWrapHex: "#ffffff" },
		]);

		expect(direct.orderItems[0].orderItemOptions).toEqual([39]);
		expect(framed.orderItems[0].orderItemOptions).toEqual([67, 96]);
		expect(canvas.orderItems[0].orderItemOptions).toEqual([3]);
	});

	it("does NOT include option 36 (Bleed) in orderItemOptions", () => {
		const order = buildLumaPrintsOrder("order-5", mockRecipient, mockItems);
		for (const item of order.orderItems) {
			expect(item.orderItemOptions).not.toContain(36);
		}
	});

	it("transforms image URLs to print quality (max=8000&q=100) for order items", () => {
		// Drive-by 2026-04-11: was "strips query params from image URLs"
		// (cleanImageUrl). Now uses prepareSanityUrlForPrint which strips
		// existing params AND appends ?max=8000&q=100 for max print quality.
		const order = buildLumaPrintsOrder("order-6", mockRecipient, mockItems);
		for (const item of order.orderItems) {
			expect(item.file.imageUrl).toContain("?max=8000&q=100");
			// Original webp/q=80 params from mockItems should be gone
			expect(item.file.imageUrl).not.toContain("fm=webp");
			expect(item.file.imageUrl).not.toContain("w=1200");
		}
	});

	it("preserves opaque capabilities and bordered R2 outputs byte-exact", () => {
		const opaque = "https://opaque.example/source.jpg?sealed=a_b-C";
		const bordered = "https://worker.example/image/bordered.jpg?version=1";
		const order = buildLumaPrintsOrder("exact-urls", mockRecipient, [
			{ ...mockItems[0], imageUrl: opaque, sourcePolicy: "opaque_capability" },
			{ ...mockItems[0], imageUrl: bordered, sourcePolicy: "bordered_r2" },
		]);
		expect(order.orderItems.map(({ file }) => file.imageUrl)).toEqual([opaque, bordered]);
	});

	it("generates correct externalItemId for each item", () => {
		const multiItems: OrderItem[] = [
			{ ...mockItems[0], imageUrl: "https://cdn.example.com/a.jpg" },
			{ ...mockItems[0], imageUrl: "https://cdn.example.com/b.jpg" },
		];
		const order = buildLumaPrintsOrder("multi-order", mockRecipient, multiItems);
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
				sourcePolicy: "sanity_cdn",
				paperSubcategoryId: 103001,
				width: 4,
				height: 6,
				quantity: 1,
			},
			{
				imageUrl: "https://cdn.sanity.io/images/b.jpg?w=1200",
				sourcePolicy: "sanity_cdn",
				paperSubcategoryId: 103001,
				width: 4,
				height: 6,
				quantity: 1,
			},
			{
				imageUrl: "https://cdn.sanity.io/images/c.jpg?w=1200",
				sourcePolicy: "sanity_cdn",
				paperSubcategoryId: 103001,
				width: 4,
				height: 6,
				quantity: 1,
			},
		];
		const order = buildLumaPrintsOrder("print-set-order", mockRecipient, printSetItems);
		expect(order.orderItems).toHaveLength(3);
		expect(order.orderItems[2].externalItemId).toBe("print-set-order-item-3");
		// All items use print quality URLs (existing query params replaced)
		for (const item of order.orderItems) {
			expect(item.file.imageUrl).toContain("?max=8000&q=100");
			expect(item.file.imageUrl).not.toContain("w=1200");
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

describe("LumaPrints request deadlines", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it("applies an active deadline signal to every LumaPrints request", async () => {
		const fetchMock = vi.fn().mockImplementation(async (rawUrl: string) => {
			if (rawUrl.includes("/images/checkImageConfig")) return providerJson({ valid: true });
			if (rawUrl.includes("/pricing/shipping")) return providerJson({ shippingMethods: [] });
			return providerJson({ message: "queued", orderNumber: 10000000001 });
		});
		vi.stubGlobal("fetch", fetchMock);

		await createOrder(buildLumaPrintsOrder("deadline-order", mockRecipient, mockItems));
		await getOrder("LP-123");
		await getShipping("LP-123");
		await checkImageConfig({
			imageUrl: "https://cdn.sanity.io/images/proj/dataset/photo.jpg",
			subcategoryId: 103001,
			width: 8,
			height: 10,
		});
		await getShippingPrice({
			items: [{ subcategoryId: 103001, width: 8, height: 10, quantity: 1 }],
			recipient: mockRecipient,
		});

		expect(fetchMock).toHaveBeenCalledTimes(5);
		for (const [, init] of fetchMock.mock.calls) {
			expect(init.signal).toBeInstanceOf(AbortSignal);
			expect((init.signal as AbortSignal).aborted).toBe(false);
		}
	});

	it("surfaces timeout failures as uncertain create outcomes", async () => {
		const timeoutError = new Error("request timed out");
		timeoutError.name = "TimeoutError";
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeoutError));

		const thrown = await createOrder(
			buildLumaPrintsOrder("timeout-order", mockRecipient, mockItems),
		).catch((error: unknown) => error);

		expect(thrown).toMatchObject({
			name: "LumaPrintsSubmissionError",
			operation: "create_order",
			disposition: "uncertain",
			message: "LumaPrints request timed out after 15000ms",
			details: {
				operation: "create_order",
				disposition: "uncertain",
				phase: "transport",
				kind: "timeout",
				timeoutMs: 15_000,
			},
		});
		expect(classifyLumaPrintsFailure(thrown)).toBe("transient");
	});

	it("distinguishes other network failures from timeouts", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("connection reset")));

		await expect(
			createOrder(buildLumaPrintsOrder("network-order", mockRecipient, mockItems)),
		).rejects.toMatchObject({
			name: "LumaPrintsSubmissionError",
			operation: "create_order",
			disposition: "uncertain",
			message: "LumaPrints network request failed",
			details: {
				operation: "create_order",
				disposition: "uncertain",
				phase: "transport",
				kind: "network",
				timeoutMs: 15_000,
			},
		});
	});
});

describe("createOrder", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("throws an operation-aware submission error on non-ok response", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response(null, { status: 400, statusText: "Bad Request" })),
		);

		const order = buildLumaPrintsOrder("fail-order", mockRecipient, mockItems);
		await expect(createOrder(order)).rejects.toBeInstanceOf(LumaPrintsSubmissionError);
	});

	it("keeps non-success response details bounded", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("private upstream detail", { status: 400 })),
		);

		const order = buildLumaPrintsOrder("fail-order", mockRecipient, mockItems);
		try {
			await createOrder(order);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(LumaPrintsSubmissionError);
			expect((err as LumaPrintsError).details).toEqual({
				operation: "create_order",
				disposition: "definitely_rejected",
				phase: "status",
				statusCode: 400,
			});
			expect(JSON.stringify((err as LumaPrintsError).details)).not.toContain(
				"private upstream detail",
			);
		}
	});

	it.each([
		[10000000001, "10000000001"],
		["10000000002", "10000000002"],
		["9007199254740992", "9007199254740992"],
	] as const)("normalizes documented numeric or canonical-string order numbers", async (value, expected) => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(providerJson({ message: "queued", orderNumber: value })),
		);

		const result = await createOrder(
			buildLumaPrintsOrder("success-order", mockRecipient, mockItems),
		);
		expect(result).toEqual({ orderNumber: expected });
	});

	it.each([
		{},
		{ message: "queued" },
		{ message: "", orderNumber: 10000000001 },
		{ message: 1, orderNumber: 10000000001 },
		{ message: "queued", orderNumber: 0 },
		{ message: "queued", orderNumber: -1 },
		{ message: "queued", orderNumber: 1.5 },
		{ message: "queued", orderNumber: Number.MAX_SAFE_INTEGER + 1 },
		{ message: "queued", orderNumber: "01" },
		{ message: "queued", orderNumber: "1.0" },
		{ message: "queued", orderNumber: "+1" },
		{ message: "queued", orderNumber: "0" },
		{ message: "queued", orderNumber: "1".repeat(65) },
		{ message: "queued", orderNumber: "10000000001", unexpected: true },
	])("rejects malformed create response envelopes", async (body) => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(providerJson(body)));
		await expect(
			createOrder(buildLumaPrintsOrder("response-order", mockRecipient, mockItems)),
		).rejects.toMatchObject({
			name: "LumaPrintsSubmissionError",
			disposition: "uncertain",
			details: { operation: "create_order", phase: "envelope" },
		});
	});

	it.each([
		"Application/JSON ; Charset = UTF-8",
		'application/json;charset="uTf-8"',
	])("accepts JSON media types and UTF-8 charset case with optional whitespace", async (contentType) => {
		const body = JSON.stringify({ message: "queued", orderNumber: 10000000001 });
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(body, {
					headers: {
						"content-type": contentType,
						"content-encoding": " GZip , BR ",
					},
				}),
			),
		);

		await expect(
			createOrder(buildLumaPrintsOrder("media-order", mockRecipient, mockItems)),
		).resolves.toEqual({ orderNumber: "10000000001" });
	});

	it("bounds and strictly media-checks the create response before parsing", async () => {
		for (const response of [
			new Response("{}", { headers: { "content-type": "text/json" } }),
			new Response("{}", { headers: { "content-type": "application/problem+json" } }),
			new Response("{}", {
				headers: { "content-type": "application/json; charset=utf-16" },
			}),
			new Response("{}", {
				headers: { "content-type": "application/json; charset=utf-8; charset=utf-8" },
			}),
			new Response("{}", {
				headers: { "content-type": "application/json", "content-encoding": "zstd" },
			}),
			new Response("{}", {
				headers: { "content-type": "application/json", "content-encoding": "gzip,,br" },
			}),
			new Response(`{"padding":"${"x".repeat(33 * 1024)}"}`, {
				headers: { "content-type": "application/json" },
			}),
		]) {
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
			await expect(
				createOrder(buildLumaPrintsOrder("bounded-order", mockRecipient, mockItems)),
			).rejects.toMatchObject({
				name: "LumaPrintsSubmissionError",
				disposition: "uncertain",
			});
		}
	});

	it.each([
		400, 406, 429,
	])("treats documented create non-acceptance status %s as definitely rejected", async (status) => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
		const thrown = await createOrder(
			buildLumaPrintsOrder("rejected-order", mockRecipient, mockItems),
		).catch((error: unknown) => error);
		expect(thrown).toMatchObject({
			name: "LumaPrintsSubmissionError",
			disposition: "definitely_rejected",
			details: { operation: "create_order", phase: "status", statusCode: status },
		});
		expect(classifyLumaPrintsFailure(thrown)).toBe("permanent");
	});

	it.each([
		401, 403, 408, 418, 422, 500, 503,
	])("keeps unexpected create status %s uncertain", async (status) => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
		const thrown = await createOrder(
			buildLumaPrintsOrder("uncertain-order", mockRecipient, mockItems),
		).catch((error: unknown) => error);
		expect(thrown).toMatchObject({
			name: "LumaPrintsSubmissionError",
			disposition: "uncertain",
			details: { operation: "create_order", phase: "status", statusCode: status },
		});
		expect(classifyLumaPrintsFailure(thrown)).toBe("transient");
	});
});

describe("findOrderByExternalId", () => {
	const externalId = "cs_test_1234567890abcdef";

	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it("uses documented store-scoped page pagination and matches locally", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				providerPage([listedOrder("cs_test_ABCDEFGHIJKLMNOP", "10000000001")], {
					totalOrders: 2,
					currentPage: 1,
					totalPages: 2,
				}),
			)
			.mockResolvedValueOnce(
				providerPage([listedOrder(externalId, 10000000002)], {
					totalOrders: 2,
					currentPage: 2,
					totalPages: 2,
				}),
			);
		vi.stubGlobal("fetch", fetchMock);

		await expect(findOrderByExternalId(externalId)).resolves.toEqual({
			orderNumber: "10000000002",
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
		for (const [index, [rawUrl]] of fetchMock.mock.calls.entries()) {
			const requested = new URL(String(rawUrl));
			expect([...requested.searchParams.entries()]).toEqual([
				["storeId", "83765"],
				["page", String(index + 1)],
			]);
			expect(requested.search).not.toContain(externalId);
		}
	});

	it("uses exact case-sensitive external ID equality and treats stable absence as pending", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(providerPage([listedOrder(externalId.toUpperCase(), "10000000001")])),
		);
		await expect(findOrderByExternalId(externalId)).resolves.toBeNull();
	});

	it.each([
		() => new Response(null, { status: 404 }),
		() => providerPage([]),
		() => providerPage([], { totalPages: 1 }),
	])("treats documented delayed absence as null", async (response) => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
		await expect(findOrderByExternalId(externalId)).resolves.toBeNull();
	});

	it.each([
		[],
		{ data: [], totalOrders: 0, currentPage: 1, totalPages: 0 },
		{ orders: [], totalOrders: 0, currentPage: 1 },
		{ orders: [], totalOrders: 0, currentPage: 1, totalPages: 0, extra: true },
		{ orders: [], totalOrders: "0", currentPage: 1, totalPages: 0 },
		{ orders: [], totalOrders: 0, currentPage: 0, totalPages: 0 },
		{ orders: [], totalOrders: 1, currentPage: 1, totalPages: 0 },
		{
			orders: [listedOrder(externalId, "01")],
			totalOrders: 1,
			currentPage: 1,
			totalPages: 1,
		},
		{
			orders: [listedOrder(externalId, "10000000001", "083765")],
			totalOrders: 1,
			currentPage: 1,
			totalPages: 1,
		},
	] as const)("blocks malformed or guessed list envelopes and rows", async (body) => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(providerJson(body)));
		await expect(findOrderByExternalId(externalId)).rejects.toMatchObject({
			name: "LumaPrintsReconciliationError",
			disposition: "blocked",
			reconciliationClass: "response_contract",
		});
	});

	it("blocks distinct provider orders with the same exact external ID", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					providerPage([
						listedOrder(externalId, "10000000001"),
						listedOrder(externalId, "10000000002"),
					]),
				),
		);
		await expect(findOrderByExternalId(externalId)).rejects.toMatchObject({
			disposition: "blocked",
			reconciliationClass: "ambiguous_result",
		});
	});

	it.each([
		providerPage([
			listedOrder("cs_test_ABCDEFGHIJKLMNOP", "10000000001"),
			listedOrder("cs_test_QRSTUVWXYZabcdef", "10000000001"),
		]),
	])("retries duplicate pagination rows as instability", async (response) => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
		await expect(findOrderByExternalId(externalId)).rejects.toMatchObject({
			disposition: "retryable",
		});
	});

	it("retries pagination metadata changes and final row-count drift", async () => {
		const changingTotals = vi
			.fn()
			.mockResolvedValueOnce(
				providerPage([listedOrder("cs_test_ABCDEFGHIJKLMNOP", "10000000001")], {
					totalOrders: 2,
					currentPage: 1,
					totalPages: 2,
				}),
			)
			.mockResolvedValueOnce(
				providerPage([listedOrder(externalId, "10000000002")], {
					totalOrders: 3,
					currentPage: 2,
					totalPages: 2,
				}),
			);
		vi.stubGlobal("fetch", changingTotals);
		await expect(findOrderByExternalId(externalId)).rejects.toMatchObject({
			disposition: "retryable",
		});

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				providerPage([listedOrder(externalId, "10000000001")], {
					totalOrders: 2,
					currentPage: 1,
					totalPages: 1,
				}),
			),
		);
		await expect(findOrderByExternalId(externalId)).rejects.toMatchObject({
			disposition: "retryable",
		});
	});

	it("enforces page, row, and total-row bounds before further requests", async () => {
		for (const response of [
			providerPage([], { totalOrders: 11, totalPages: 11 }),
			providerPage([], { totalOrders: 1001, totalPages: 10 }),
			providerPage(
				Array.from({ length: 101 }, (_, index) =>
					listedOrder(`other-${index}`, String(10000000000 + index)),
				),
			),
		]) {
			const fetchMock = vi.fn().mockResolvedValue(response);
			vi.stubGlobal("fetch", fetchMock);
			await expect(findOrderByExternalId(externalId)).rejects.toMatchObject({
				disposition: "retryable",
			});
			expect(fetchMock).toHaveBeenCalledTimes(1);
		}
	});

	it("accepts token case and whitespace but strictly enforces response media", async () => {
		const validBody = JSON.stringify({
			orders: [listedOrder(externalId, "10000000001")],
			totalOrders: 1,
			currentPage: 1,
			totalPages: 1,
		});
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(validBody, {
					headers: {
						"content-type": " APPLICATION/JSON ; CHARSET = utf-8 ",
						"content-encoding": " GZIP , Br ",
					},
				}),
			),
		);
		await expect(findOrderByExternalId(externalId)).resolves.toEqual({
			orderNumber: "10000000001",
		});

		for (const response of [
			new Response("{}", { headers: { "content-type": "text/json" } }),
			new Response("{}", {
				headers: { "content-type": "application/json; charset=latin1" },
			}),
			new Response("{}", {
				headers: { "content-type": "application/json", "content-encoding": "gzip, zstd" },
			}),
		]) {
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
			await expect(findOrderByExternalId(externalId)).rejects.toMatchObject({
				disposition: "blocked",
				reconciliationClass: "response_contract",
			});
		}
	});

	it("accepts practical full-detail pages while keeping the finite byte bound retryable", async () => {
		const fullDetailPage = providerPage(
			Array.from({ length: 100 }, (_, index) => ({
				...listedOrder(`other-${index}`, String(10000000000 + index)),
				documentedFullDetail: "x".repeat(4 * 1024),
			})),
		);
		expect(Number(fullDetailPage.headers.get("content-length"))).toBeGreaterThan(32 * 1024);
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fullDetailPage));
		await expect(findOrderByExternalId(externalId)).resolves.toBeNull();

		const overBound = providerJson({
			orders: [],
			totalOrders: 0,
			currentPage: 1,
			totalPages: 0,
			padding: "x".repeat(2 * 1024 * 1024),
		});
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(overBound));
		await expect(findOrderByExternalId(externalId)).rejects.toMatchObject({
			disposition: "retryable",
		});
	});

	it.each([
		Object.assign(new Error("timeout"), { name: "TimeoutError" }),
		new TypeError("network"),
	])("keeps transport failures retryable", async (error) => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
		await expect(findOrderByExternalId(externalId)).rejects.toMatchObject({
			disposition: "retryable",
		});
	});

	it("keeps response-stream failures and a later-page disappearance retryable", async () => {
		const failedStream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.error(new TypeError("stream failed"));
			},
		});
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					new Response(failedStream, { headers: { "content-type": "application/json" } }),
				),
		);
		await expect(findOrderByExternalId(externalId)).rejects.toMatchObject({
			disposition: "retryable",
		});

		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(
					providerPage([listedOrder("other", "10000000001")], {
						totalOrders: 2,
						currentPage: 1,
						totalPages: 2,
					}),
				)
				.mockResolvedValueOnce(new Response(null, { status: 404 })),
		);
		await expect(findOrderByExternalId(externalId)).rejects.toMatchObject({
			disposition: "retryable",
		});
	});

	it.each([408, 429, 500, 503])("keeps retryable provider statuses transient", async (status) => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
		await expect(findOrderByExternalId(externalId)).rejects.toMatchObject({
			name: "LumaPrintsReconciliationError",
			disposition: "retryable",
		});
	});

	it.each([400, 401, 403, 422])("blocks deterministic provider rejection", async (status) => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
		await expect(findOrderByExternalId(externalId)).rejects.toMatchObject({
			disposition: "blocked",
			reconciliationClass: "provider_rejected",
		});
	});

	it("blocks local identity and store configuration faults without fetching", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const invalid = await findOrderByExternalId("invalid").catch((error: unknown) => error);
		expect(invalid).toBeInstanceOf(LumaPrintsReconciliationError);
		expect(invalid).toMatchObject({
			disposition: "blocked",
			reconciliationClass: "client_error",
		});

		for (const invalidStoreId of [
			undefined,
			"",
			"0",
			"-1",
			"1.5",
			" 83765",
			"8e4",
			"9007199254740992",
		]) {
			privateEnv.LUMAPRINTS_STORE_ID = invalidStoreId;
			await expect(findOrderByExternalId(externalId)).rejects.toMatchObject({
				disposition: "blocked",
				reconciliationClass: "client_error",
			});
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

// ─── audit #23 PR #3: checkImageConfig + getShippingPrice helpers ─────────

describe("checkImageConfig", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	const input = {
		imageUrl: "https://cdn.sanity.io/images/proj/dataset/photo.jpg",
		subcategoryId: 103001,
		width: 8,
		height: 10,
	};

	it("returns a validated API response on success", async () => {
		const mockResponse = { valid: true };
		const fetchMock = vi.fn().mockResolvedValue(providerJson(mockResponse));
		vi.stubGlobal("fetch", fetchMock);

		await expect(checkImageConfig(input)).resolves.toEqual(mockResponse);
	});

	it("returns a valid:false response with recommendations when image is unsuitable", async () => {
		const mockResponse = {
			valid: false,
			message: "Resolution too low for requested size",
			recommendedWidth: 4,
			recommendedHeight: 5,
			expectedAspectRatio: 0.8,
		};
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(providerJson(mockResponse)));

		await expect(checkImageConfig({ ...input, width: 16, height: 20 })).resolves.toEqual(
			mockResponse,
		);
	});

	it("strips query params from the image URL before sending to LumaPrints", async () => {
		const fetchMock = vi.fn().mockResolvedValue(providerJson({ valid: true }));
		vi.stubGlobal("fetch", fetchMock);

		await checkImageConfig({
			...input,
			imageUrl: `${input.imageUrl}?w=1200&fm=webp&q=80`,
		});

		const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
		expect(body.imageUrl).toBe(input.imageUrl);
	});

	it("redacts the provider body on non-ok responses", async () => {
		const providerSecret = "private upstream validation detail";
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(providerJson({ message: providerSecret }, { status: 400 })),
		);

		const thrown = await checkImageConfig(input).catch((error: unknown) => error);
		expect(thrown).toBeInstanceOf(LumaPrintsError);
		expect(thrown).toMatchObject({
			details: {
				operation: "check_image_config",
				phase: "status",
				statusCode: 400,
			},
		});
		expect(JSON.stringify(thrown)).not.toContain(providerSecret);
	});

	it("does not inspect a non-JSON failure body", async () => {
		const providerSecret = "private non-JSON provider detail";
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(providerSecret, {
					status: 500,
					headers: { "content-type": "text/plain" },
				}),
			),
		);

		const thrown = await checkImageConfig(input).catch((error: unknown) => error);
		expect(thrown).toMatchObject({
			details: {
				operation: "check_image_config",
				phase: "status",
				statusCode: 500,
			},
		});
		expect(JSON.stringify(thrown)).not.toContain(providerSecret);
	});

	it("bounds and validates successful provider responses", async () => {
		for (const response of [
			providerJson({ valid: "yes" }),
			new Response("not json", { headers: { "content-type": "application/json" } }),
			providerJson({ valid: true, padding: "x".repeat(64 * 1024) }),
		]) {
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
			await expect(checkImageConfig(input)).rejects.toMatchObject({
				name: "LumaPrintsError",
				details: { operation: "check_image_config" },
			});
		}
	});
});

describe("getShippingPrice", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	const input = {
		items: [{ subcategoryId: 103001, width: 8, height: 10, quantity: 1 }],
		recipient: mockRecipient,
	};

	it("returns parsed shipping methods on success", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				providerJson({
					message: "",
					shippingMethods: [
						{ carrier: "USPS", method: "usps_ground_advantage", cost: 6.31 },
						{ carrier: "FedEx/UPS/GLS", method: "ground", cost: 13.71 },
					],
				}),
			),
		);

		const result = await getShippingPrice(input);
		expect(result.shippingMethods).toHaveLength(2);
		expect(result.shippingMethods[0]).toEqual({
			carrier: "USPS",
			method: "usps_ground_advantage",
			cost: 6.31,
		});
	});

	it("maps our Recipient type to LumaPrints' address schema in the payload", async () => {
		const fetchMock = vi.fn().mockResolvedValue(providerJson({ shippingMethods: [] }));
		vi.stubGlobal("fetch", fetchMock);

		await getShippingPrice({
			...input,
			items: [{ ...input.items[0], quantity: 2 }],
		});

		const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
		expect(body.recipient).toEqual({
			firstName: "Jane",
			lastName: "Doe",
			addressLine1: "123 Main St",
			addressLine2: "Apt 4",
			city: "Detroit",
			state: "MI",
			zipCode: "48201",
			country: "US",
			phone: "313-555-1234",
		});
		expect(body.orderItems[0]).toEqual({
			subcategoryId: 103001,
			quantity: 2,
			width: 8,
			height: 10,
			orderItemOptions: [39],
		});
	});

	it("respects custom orderItemOptions when provided", async () => {
		const fetchMock = vi.fn().mockResolvedValue(providerJson({ shippingMethods: [] }));
		vi.stubGlobal("fetch", fetchMock);

		await getShippingPrice({
			...input,
			items: [{ ...input.items[0], orderItemOptions: [36] }],
		});

		const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
		expect(body.orderItems[0].orderItemOptions).toEqual([36]);
	});

	it("redacts the provider body on non-ok responses", async () => {
		const providerSecret = "private invalid address detail";
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(providerJson({ message: providerSecret }, { status: 400 })),
		);

		const thrown = await getShippingPrice(input).catch((error: unknown) => error);
		expect(thrown).toBeInstanceOf(LumaPrintsError);
		expect(thrown).toMatchObject({
			details: {
				operation: "get_shipping_price",
				phase: "status",
				statusCode: 400,
			},
		});
		expect(JSON.stringify(thrown)).not.toContain(providerSecret);
	});

	it("bounds and validates successful provider responses", async () => {
		for (const response of [
			providerJson({
				shippingMethods: [{ carrier: "USPS", method: "ground", cost: "6.31" }],
			}),
			new Response("not json", { headers: { "content-type": "application/json" } }),
			providerJson({ shippingMethods: [], padding: "x".repeat(64 * 1024) }),
		]) {
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
			await expect(getShippingPrice(input)).rejects.toMatchObject({
				name: "LumaPrintsError",
				details: { operation: "get_shipping_price" },
			});
		}
	});
});
