import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InventorySession } from "../../../../../../scripts/commerce/r4-checkout-session-inventory-core";

const mocks = vi.hoisted(() => ({
	verify: vi.fn(),
	stripeList: vi.fn(),
	stripeRetrieve: vi.fn(),
	convexQuery: vi.fn(),
	env: { WEBHOOK_SECRET: "server-only-secret" },
}));

vi.mock("$env/dynamic/private", () => ({ env: mocks.env }));
vi.mock("$lib/server/siteAdminAuthorization", () => ({
	verifySiteAdminRequest: mocks.verify,
}));
vi.mock("$lib/server/stripeClient", () => ({
	getStripe: () => ({
		checkout: { sessions: { list: mocks.stripeList, retrieve: mocks.stripeRetrieve } },
	}),
}));
vi.mock("$lib/server/convexClient", () => ({
	getConvex: () => ({ query: mocks.convexQuery }),
}));

import { r4ReadPurposes, r4ReadSignatureMessage } from "$lib/server/r4ReadAuthorization";
import { POST } from "./+server";

const cutoff = 1_700_000_000;

function request(body: unknown, headers: Record<string, string> = {}) {
	return new Request("https://angelsrest.online/api/admin/commerce/accelerated-inventory", {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: JSON.stringify(body),
	});
}

function expiredSession(): InventorySession {
	return {
		id: "cs_live_1234567890abcdef",
		after_expiration: null,
		created: cutoff - 100,
		expires_at: cutoff - 10,
		livemode: true,
		metadata: { commerceTenantSiteUrl: "angelsrest.online", productId: "product" },
		mode: "payment",
		payment_link: null,
		payment_status: "unpaid",
		recovered_from: null,
		status: "expired",
	};
}

describe("accelerated R4 fixed-point inventory", () => {
	beforeEach(() => {
		mocks.verify.mockReset().mockResolvedValue(true);
		mocks.stripeList.mockReset().mockResolvedValue({
			data: [expiredSession()],
			has_more: false,
		});
		mocks.stripeRetrieve.mockReset();
		mocks.convexQuery.mockReset().mockImplementation(async (_reference, args) => {
			if ("siteUrl" in args && !("stripeSessionId" in args)) {
				return {
					cutoffCreatedSeconds: cutoff,
					acceptUntilMs: cutoff * 1_000 + 3_222_000_000,
					activationGeneration: 1,
					accountScopeClass: "platform",
				};
			}
			return null;
		});
	});

	it("requires a valid session with stored site membership before provider access", async () => {
		mocks.verify.mockResolvedValue(false);
		await expect(
			POST({ request: request({ authorization: "r4_accelerated_fixed_point_read_v1" }) }),
		).rejects.toMatchObject({ status: 401 });
		expect(mocks.stripeList).not.toHaveBeenCalled();
	});

	it("requires the exact bounded authorization body", async () => {
		await expect(POST({ request: request({ authorization: "wrong" }) })).rejects.toMatchObject({
			status: 400,
		});
		expect(mocks.stripeList).not.toHaveBeenCalled();
	});

	it("accepts only a fresh fixed-purpose server HMAC when no admin session exists", async () => {
		mocks.verify.mockResolvedValue(false);
		const body = { authorization: "r4_accelerated_fixed_point_read_v1" };
		const rawBody = JSON.stringify(body);
		const timestamp = String(Math.floor(Date.now() / 1_000));
		const unsigned = request(body);
		const signature = createHmac("sha256", mocks.env.WEBHOOK_SECRET)
			.update(
				r4ReadSignatureMessage(unsigned, r4ReadPurposes.acceleratedInventory, rawBody, timestamp),
			)
			.digest("hex");
		const response = await POST({
			request: request(body, { "x-r4-timestamp": timestamp, "x-r4-signature": signature }),
		});
		expect(response.status).toBe(200);
		const readsAfterFreshSignature = mocks.stripeList.mock.calls.length;
		const legacySignature = createHmac("sha256", mocks.env.WEBHOOK_SECRET)
			.update(`r4-accelerated-inventory-v1:${timestamp}`)
			.digest("hex");
		await expect(
			POST({
				request: request(body, {
					"x-r4-timestamp": timestamp,
					"x-r4-signature": legacySignature,
				}),
			}),
		).rejects.toMatchObject({ status: 401 });
		await expect(
			POST({
				request: request(
					{ authorization: "r4_accelerated_legacy_paid_diagnostic_v1" },
					{ "x-r4-timestamp": timestamp, "x-r4-signature": signature },
				),
			}),
		).rejects.toMatchObject({ status: 401 });
		expect(mocks.stripeList).toHaveBeenCalledTimes(readsAfterFreshSignature);

		const staleTimestamp = String(Number(timestamp) - 301);
		const staleSignature = createHmac("sha256", mocks.env.WEBHOOK_SECRET)
			.update(
				r4ReadSignatureMessage(
					unsigned,
					r4ReadPurposes.acceleratedInventory,
					rawBody,
					staleTimestamp,
				),
			)
			.digest("hex");
		await expect(
			POST({
				request: request(body, {
					"x-r4-timestamp": staleTimestamp,
					"x-r4-signature": staleSignature,
				}),
			}),
		).rejects.toMatchObject({ status: 401 });
	});

	it("returns only normalized fixed-point evidence", async () => {
		const response = await POST({
			request: request({ authorization: "r4_accelerated_fixed_point_read_v1" }),
		});
		const text = await response.text();
		expect(response.status).toBe(200);
		expect(JSON.parse(text)).toEqual({
			version: 1,
			outcome: "clear",
			scanClass: "complete",
			evidenceClasses: [
				"expired_unpaid_provider_verified",
				"full_history_fixed_point",
				"full_history_paginated",
				"head_reread_stable",
			],
			blockerClasses: [],
		});
		expect(mocks.stripeList).toHaveBeenCalledTimes(4);
		expect(text).not.toContain("cs_live_");
		expect(text).not.toContain("server-only-secret");
	});

	it("suppresses raw provider errors", async () => {
		mocks.stripeList.mockRejectedValue(new Error("raw provider secret fragment"));
		const response = await POST({
			request: request({ authorization: "r4_accelerated_fixed_point_read_v1" }),
		});
		const text = await response.text();
		expect(response.status).toBe(409);
		expect(JSON.parse(text)).toMatchObject({
			outcome: "incomplete",
			blockerClasses: ["provider_error"],
		});
		expect(text).not.toContain("raw provider secret fragment");
	});

	it("returns bounded masked details only for an unresolved historical paid candidate", async () => {
		const paid = { ...expiredSession(), payment_status: "paid" as const };
		const paidWithSummary = {
			...paid,
			amount_total: 1500,
			currency: "usd",
			customer_details: { email: "owner@example.com" },
			customer_email: null,
		};
		mocks.stripeList.mockResolvedValue({ data: [paidWithSummary], has_more: false });
		const response = await POST({
			request: request({ authorization: "r4_accelerated_legacy_paid_diagnostic_v1" }),
		});
		const text = await response.text();
		expect(response.status).toBe(200);
		expect(JSON.parse(text)).toEqual({
			version: 1,
			outcome: "diagnostic",
			candidateCount: 1,
			profiles: [
				{
					createdDay: "2023-11-14",
					amountTotalMinor: 1500,
					currency: "usd",
					customerEmailMasked: "ow***@example.com",
					occurrences: 1,
				},
			],
		});
		expect(mocks.stripeRetrieve).not.toHaveBeenCalled();
		expect(text).not.toContain("cs_live_");
		expect(text).not.toContain("owner@example.com");
	});

	it("clears only the exact accepted 38-session owner-test history profile", async () => {
		const acceptedCutoff = 1_786_400_000;
		const profiles = [
			["2026-02-15", 6],
			["2026-03-06", 1],
			["2026-03-07", 16],
			["2026-03-09", 15],
		] as const;
		let index = 0;
		const sessions = profiles
			.flatMap(([day, occurrences]) =>
				Array.from({ length: occurrences }, () => {
					index += 1;
					const created = Math.floor(Date.parse(`${day}T12:00:00Z`) / 1_000);
					return {
						...expiredSession(),
						id: `cs_live_${String(index).padStart(16, "0")}`,
						created,
						expires_at: created + 86_100,
						payment_status: "paid" as const,
						amount_total: 100,
						currency: "usd",
						customer_details: { email: "thinkingofview@gmail.com" },
						customer_email: null,
					};
				}),
			)
			.reverse();
		mocks.stripeList.mockResolvedValue({ data: sessions, has_more: false });
		mocks.convexQuery.mockImplementation(async (_reference, args) => {
			if ("siteUrl" in args && !("stripeSessionId" in args)) {
				return {
					cutoffCreatedSeconds: acceptedCutoff,
					acceptUntilMs: acceptedCutoff * 1_000 + 3_222_000_000,
					activationGeneration: 1,
					accountScopeClass: "platform",
				};
			}
			return null;
		});

		const response = await POST({
			request: request({ authorization: "r4_accelerated_fixed_point_read_v1" }),
		});
		const body = await response.json();
		expect(response.status).toBe(200);
		expect(body).toMatchObject({
			outcome: "clear",
			blockerClasses: [],
			evidenceClasses: expect.arrayContaining(["owner_test_history_disposition_verified"]),
		});
	});
});
