import { describe, expect, it, vi } from "vitest";
import {
	parseLumaPrintsShippingPayload,
	processLumaPrintsShipment,
	verifyLumaPrintsBasicAuthorization,
} from "$lib/server/lumaprintsWebhook";

describe("LumaPrints webhook boundary", () => {
	it("accepts exact Basic credentials, including a colon in the password", () => {
		const header = `Basic ${Buffer.from("lumaprints:secret:part").toString("base64")}`;
		expect(verifyLumaPrintsBasicAuthorization(header, "lumaprints", "secret:part")).toBe(true);
		expect(verifyLumaPrintsBasicAuthorization(header, "lumaprints", "wrong")).toBe(false);
		expect(verifyLumaPrintsBasicAuthorization(null, "lumaprints", "secret:part")).toBe(false);
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

	it("rejects unrelated events, missing shipments, and oversized bodies", () => {
		expect(() => parseLumaPrintsShippingPayload('{"event":"order.created"}')).toThrow(
			"Unsupported LumaPrints webhook event",
		);
		expect(() => parseLumaPrintsShippingPayload('{"orderNumber":"1","shipments":[]}')).toThrow(
			"no shipments",
		);
		expect(() => parseLumaPrintsShippingPayload("x".repeat(256 * 1024 + 1))).toThrow("too large");
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
		const shipment = { orderNumber: "LP-1", trackingNumber: "TRACK", carrier: "UPS" };

		await expect(processLumaPrintsShipment(shipment, deps)).resolves.toEqual({
			status: "processed",
			delivery: { status: "sent" },
		});
		expect(deps.send).toHaveBeenCalledWith(
			expect.objectContaining({
				siteUrl: "tenant.example",
				lumaprintsOrderNumber: "LP-1",
				trackingNumber: "TRACK",
			}),
		);
		expect(deps.record).toHaveBeenCalledWith({
			lumaprintsOrderNumber: "LP-1",
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

		await expect(processLumaPrintsShipment({ orderNumber: "LP-1" }, deps)).resolves.toEqual({
			status: "already_processed",
		});
		expect(deps.send).not.toHaveBeenCalled();
		expect(deps.record).not.toHaveBeenCalled();
	});

	it("records a bounded provider failure instead of losing the claimed outcome", async () => {
		const deps = dependencies();
		deps.send.mockRejectedValue(new Error("Resend unavailable"));

		await expect(processLumaPrintsShipment({ orderNumber: "LP-1" }, deps)).resolves.toEqual({
			status: "processed",
			delivery: { status: "failed", error: "Resend unavailable" },
		});
		expect(deps.record).toHaveBeenCalledWith({
			lumaprintsOrderNumber: "LP-1",
			status: "failed",
			error: "Resend unavailable",
		});
	});
});
