import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	verify: vi.fn(),
	env: { WEBHOOK_SECRET: "server-only-secret" as string | undefined },
}));

vi.mock("$env/dynamic/private", () => ({ env: mocks.env }));
vi.mock("$lib/server/siteAdminAuthorization", () => ({
	verifySiteAdminRequest: mocks.verify,
}));

import {
	authorizeR4ReadRequest,
	r4ReadPurposes,
	r4ReadSignatureMessage,
	verifyR4ReadHmac,
} from "$lib/server/r4ReadAuthorization";

const nowMs = Date.parse("2026-08-10T12:00:00.000Z");
const timestamp = String(Math.floor(nowMs / 1_000));

function signed(
	purpose: Parameters<typeof r4ReadSignatureMessage>[1],
	options: { method?: string; pathname?: string; body?: string; timestamp?: string } = {},
) {
	const method = options.method ?? "GET";
	const pathname = options.pathname ?? "/api/admin/commerce/closure-state";
	const body = options.body ?? "";
	const signedTimestamp = options.timestamp ?? timestamp;
	const unsigned = new Request(`https://angelsrest.online${pathname}`, {
		method,
		...(body ? { headers: { "content-type": "application/json" }, body } : {}),
	});
	const signature = createHmac("sha256", mocks.env.WEBHOOK_SECRET as string)
		.update(r4ReadSignatureMessage(unsigned, purpose, body, signedTimestamp))
		.digest("hex");
	const request = new Request(unsigned, {
		headers: {
			...Object.fromEntries(unsigned.headers),
			"x-r4-timestamp": signedTimestamp,
			"x-r4-signature": signature,
		},
	});
	return { body, request };
}

describe("R4 fixed-purpose read authorization", () => {
	beforeEach(() => {
		mocks.verify.mockReset().mockResolvedValue(false);
		mocks.env.WEBHOOK_SECRET = "server-only-secret";
	});

	it("retains the Better Auth plus stored-membership path after exact envelope validation", async () => {
		mocks.verify.mockResolvedValue(true);
		await expect(
			authorizeR4ReadRequest(
				new Request("https://angelsrest.online/api/admin/commerce/closure-state"),
				r4ReadPurposes.closureState,
			),
		).resolves.toEqual({ rawBody: "" });
	});

	it("accepts only a fresh lowercase SHA-256 signature for the exact purpose", () => {
		const signedCheckout = signed(r4ReadPurposes.checkoutCatalogSentinel, {
			method: "POST",
			pathname: "/api/admin/commerce/catalog-sentinel",
			body: '{"authorization":"r4_checkout_catalog_sentinel_v1"}',
		});
		expect(
			verifyR4ReadHmac(
				signedCheckout.request,
				r4ReadPurposes.checkoutCatalogSentinel,
				signedCheckout.body,
				nowMs,
			),
		).toBe(true);
		expect(
			verifyR4ReadHmac(
				signedCheckout.request,
				r4ReadPurposes.shopCatalogSentinel,
				signedCheckout.body,
				nowMs,
			),
		).toBe(false);
		const uppercase = new Request(signedCheckout.request, {
			headers: signedCheckout.request.headers,
		});
		uppercase.headers.set(
			"x-r4-signature",
			uppercase.headers.get("x-r4-signature")?.toUpperCase() ?? "",
		);
		expect(
			verifyR4ReadHmac(
				uppercase,
				r4ReadPurposes.checkoutCatalogSentinel,
				signedCheckout.body,
				nowMs,
			),
		).toBe(false);
	});

	it("binds method, path, and exact raw body so a signature cannot switch reads", () => {
		const original = signed(r4ReadPurposes.acceleratedInventory, {
			method: "POST",
			pathname: "/api/admin/commerce/accelerated-inventory",
			body: '{"authorization":"r4_accelerated_fixed_point_read_v1"}',
		});
		for (const [request, body] of [
			[
				new Request("https://angelsrest.online/api/admin/commerce/catalog-sentinel", {
					method: "POST",
					headers: original.request.headers,
					body: original.body,
				}),
				original.body,
			],
			[original.request, '{"authorization":"r4_accelerated_legacy_paid_diagnostic_v1"}'],
		] as const) {
			expect(verifyR4ReadHmac(request, r4ReadPurposes.acceleratedInventory, body, nowMs)).toBe(
				false,
			);
		}
	});

	it("allows the exact 300-second boundary and rejects stale, future, malformed, and unconfigured requests", () => {
		for (const offset of [-300, 300]) {
			const boundary = signed(r4ReadPurposes.closureState, {
				timestamp: String(Number(timestamp) + offset),
			});
			expect(verifyR4ReadHmac(boundary.request, r4ReadPurposes.closureState, "", nowMs)).toBe(true);
		}
		for (const offset of [-301, 301]) {
			const outside = signed(r4ReadPurposes.closureState, {
				timestamp: String(Number(timestamp) + offset),
			});
			expect(verifyR4ReadHmac(outside.request, r4ReadPurposes.closureState, "", nowMs)).toBe(false);
		}
		expect(
			verifyR4ReadHmac(
				new Request("https://angelsrest.online/api/admin/commerce/closure-state"),
				r4ReadPurposes.closureState,
				"",
				nowMs,
			),
		).toBe(false);
		const configured = signed(r4ReadPurposes.closureState);
		mocks.env.WEBHOOK_SECRET = undefined;
		expect(verifyR4ReadHmac(configured.request, r4ReadPurposes.closureState, "", nowMs)).toBe(
			false,
		);
	});

	it("rejects query strings, wrong methods/content types, and over-limit bodies before membership", async () => {
		for (const request of [
			new Request("https://angelsrest.online/api/admin/commerce/closure-state?extra=true"),
			new Request("https://angelsrest.online/api/admin/commerce/closure-state", {
				method: "POST",
			}),
			new Request("https://angelsrest.online/api/admin/commerce/catalog-sentinel", {
				method: "POST",
				headers: { "content-type": "text/plain" },
				body: "{}",
			}),
			new Request("https://angelsrest.online/api/admin/commerce/catalog-sentinel", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "x".repeat(97),
			}),
		]) {
			await expect(
				authorizeR4ReadRequest(request, r4ReadPurposes.checkoutCatalogSentinel),
			).resolves.toBeNull();
		}
		expect(mocks.verify).not.toHaveBeenCalled();
	});
});
