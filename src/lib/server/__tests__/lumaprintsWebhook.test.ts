import { describe, expect, it, vi } from "vitest";
import {
	LumaPrintsWebhookPayloadError,
	parseLumaPrintsShippingPayload,
	processLumaPrintsShipment,
	readLumaPrintsShippingPayload,
	verifyLumaPrintsBasicAuthorization,
} from "$lib/server/lumaprintsWebhook";

describe("LumaPrints webhook boundary", () => {
	it("accepts exact Basic credentials, including a colon in the password", () => {
		const header = `Basic ${Buffer.from("lumaprints:secret:part").toString("base64")}`;
		expect(verifyLumaPrintsBasicAuthorization(header, "lumaprints", "secret:part")).toBe(true);
		expect(verifyLumaPrintsBasicAuthorization(header, "lumaprints", "wrong")).toBe(false);
		expect(verifyLumaPrintsBasicAuthorization(null, "lumaprints", "secret:part")).toBe(false);
	});

	it("accepts a previous password only during an explicit rotation window", () => {
		const previousHeader = `Basic ${Buffer.from("lumaprints:previous-secret").toString("base64")}`;
		expect(
			verifyLumaPrintsBasicAuthorization(
				previousHeader,
				"lumaprints",
				"current-secret",
				"previous-secret",
			),
		).toBe(true);
		expect(verifyLumaPrintsBasicAuthorization(previousHeader, "lumaprints", "current-secret")).toBe(
			false,
		);
	});

	it("parses the documented top-level shipping payload", () => {
		expect(
			parseLumaPrintsShippingPayload(
				JSON.stringify({
					orderNumber: 10000045686,
					externalId: "order-id",
					shipments: [
						{ carrier: "FedEx", trackingNumber: "392964503590", shipmentDate: "2026-07-12" },
					],
				}),
			),
		).toEqual({
			orderNumber: "10000045686",
			carrier: "FedEx",
			trackingNumber: "392964503590",
		});
	});

	it("accepts the 64-digit canonical provider-number boundary", () => {
		const orderNumber = "9".repeat(64);
		expect(
			parseLumaPrintsShippingPayload(JSON.stringify({ orderNumber, shipments: [{}] })),
		).toMatchObject({ orderNumber });
	});

	it.each([
		"",
		"0",
		"01",
		"+1",
		"1.0",
		"1e3",
		" 1",
		"1 ",
		"LP-123",
		"1".repeat(65),
		0,
		-1,
		1.5,
		Number.MAX_SAFE_INTEGER + 1,
	])("rejects non-canonical provider order number %j", (orderNumber) => {
		expect(() =>
			parseLumaPrintsShippingPayload(JSON.stringify({ orderNumber, shipments: [{}] })),
		).toThrow("Invalid LumaPrints orderNumber");
	});

	it("rejects unrelated events, missing shipments, and oversized bodies", () => {
		expect(() => parseLumaPrintsShippingPayload('{"event":"order.created"}')).toThrow(
			"Unsupported LumaPrints webhook event",
		);
		expect(() => parseLumaPrintsShippingPayload('{"orderNumber":"1","shipments":[]}')).toThrow(
			"no shipments",
		);
		expect(() => parseLumaPrintsShippingPayload("x".repeat(256 * 1024 + 1))).toThrow("too large");
	});

	it("bounds a chunked request stream before aggregate body allocation", async () => {
		const canceled = vi.fn();
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(200 * 1024));
				controller.enqueue(new Uint8Array(60 * 1024 + 1));
			},
			cancel: canceled,
		});
		const request = new Request("https://example.test/webhook", {
			method: "POST",
			body,
			duplex: "half",
		} as RequestInit & { duplex: "half" });

		const thrown = await readLumaPrintsShippingPayload(request).catch((error: unknown) => error);
		expect(thrown).toBeInstanceOf(LumaPrintsWebhookPayloadError);
		expect(thrown).toMatchObject({ status: 413, message: expect.stringContaining("too large") });
		expect(canceled).toHaveBeenCalledOnce();
	});

	it("rejects an oversized declared length before reading the stream", async () => {
		const request = new Request("https://example.test/webhook", {
			method: "POST",
			headers: { "content-length": String(256 * 1024 + 1) },
			body: "{}",
		});
		await expect(readLumaPrintsShippingPayload(request)).rejects.toMatchObject({ status: 413 });
	});
});

describe("LumaPrints shipment orchestration", () => {
	function dependencies() {
		return {
			claim: vi.fn().mockResolvedValue({
				claimed: true,
				order: {
					siteUrl: "tenant.example",
					orderNumber: "ORD-001",
					customerEmail: "buyer@example.com",
				},
			}),
			record: vi.fn().mockResolvedValue({ recorded: true }),
			send: vi.fn().mockResolvedValue(undefined),
		};
	}

	it("sends and checkpoints a newly claimed shipment", async () => {
		const deps = dependencies();
		const shipment = { orderNumber: "101", trackingNumber: "TRACK", carrier: "UPS" };

		await expect(processLumaPrintsShipment(shipment, deps)).resolves.toEqual({
			status: "processed",
			delivery: { status: "sent" },
		});
		expect(deps.send).toHaveBeenCalledWith(
			expect.objectContaining({
				siteUrl: "tenant.example",
				lumaprintsOrderNumber: "101",
				trackingNumber: "TRACK",
			}),
		);
		expect(deps.record).toHaveBeenCalledWith({
			lumaprintsOrderNumber: "101",
			status: "sent",
			error: undefined,
		});
	});

	it("does not repeat email for an already-processed claim", async () => {
		const deps = dependencies();
		deps.claim.mockResolvedValue({
			claimed: false,
			order: {
				siteUrl: "tenant.example",
				orderNumber: "ORD-001",
				customerEmail: "buyer@example.com",
			},
		});

		await expect(processLumaPrintsShipment({ orderNumber: "101" }, deps)).resolves.toEqual({
			status: "already_processed",
		});
		expect(deps.send).not.toHaveBeenCalled();
		expect(deps.record).not.toHaveBeenCalled();
	});

	it("records a bounded provider failure instead of losing the claimed outcome", async () => {
		const deps = dependencies();
		deps.send.mockRejectedValue(new Error("Resend unavailable"));

		await expect(processLumaPrintsShipment({ orderNumber: "101" }, deps)).resolves.toEqual({
			status: "processed",
			delivery: { status: "failed", error: "Resend unavailable" },
		});
		expect(deps.record).toHaveBeenCalledWith({
			lumaprintsOrderNumber: "101",
			status: "failed",
			error: "Resend unavailable",
		});
	});
});
