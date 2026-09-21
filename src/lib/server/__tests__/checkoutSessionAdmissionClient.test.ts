import { describe, expect, it, vi } from "vitest";
import {
	checkoutRequestFingerprint,
	createCheckoutSessionAdmissionClient,
} from "$lib/server/checkoutSessionAdmissionClient";

const SITE = "angelsrest.online";
const ATTEMPT = "123e4567-e89b-42d3-a456-426614174000";
const TENANT_ID = "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b";

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("Checkout Session admission client", () => {
	it.each([
		["active_prestripe", 1, true],
		["active_prestripe", undefined, false],
		["active_prestripe", 0, false],
		["creation_uncertain", 1, true],
		["creation_uncertain", 0, true],
		["creation_uncertain", undefined, false],
		["creation_uncertain", 2, false],
	] as const)("requires truthful financial acknowledgement for %s/%s", async (state, version, accepted) => {
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({
					outcome: "replayed",
					admissionId: "admission_123",
					state,
					admissionGeneration: 1,
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					state: "creating",
					requestedStripeExpiresAt: 1_800_086_100,
					...(version === undefined ? {} : { financialCaptureVersion: version }),
				}),
			);
		const client = createCheckoutSessionAdmissionClient({
			baseUrl: "https://convex.example",
			fetcher,
			credential: () => "synthetic-authority-0123456789",
		});
		const permit = await client.begin({
			site: "client.example",
			tenantId: TENANT_ID,
			account: "acct_client12345678901",
			identity: {
				attempt: ATTEMPT,
				attemptStartedAt: 1_800_000_000_000,
				proofClass: "signed_bridge_body",
			},
			hostGeneration: 1,
			requestFingerprint: "a".repeat(64),
		});
		const financialIntent = {
			version: 1 as const,
			currency: "usd" as const,
			lines: [{ unitPriceCents: 4200, quantity: 2 }],
			applicationFeeAmountCents: 420,
		};
		const operation = client.markCreating(permit, ATTEMPT, financialIntent);
		if (accepted) await expect(operation).resolves.toBe(1_800_086_100);
		else await expect(operation).rejects.toThrow("unavailable");
		expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({ financialIntent });
	});

	it("replays one deterministic identity through creating and atomic binding", async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({
					outcome: "replayed",
					admissionId: "admission_123",
					state: "creation_uncertain",
					admissionGeneration: 1,
					requestedStripeExpiresAt: 1_800_086_100,
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					state: "creation_uncertain",
					requestedStripeExpiresAt: 1_800_086_100,
				}),
			)
			.mockResolvedValueOnce(jsonResponse({ outcome: "bound" }));
		const client = createCheckoutSessionAdmissionClient({
			baseUrl: "https://convex.example",
			fetcher,
			credential: () => "tenant-authority-secret-0123456789",
		});
		const requestFingerprint = checkoutRequestFingerprint({ product: "print", cents: 4200 });
		const permit = await client.begin({
			tenantId: TENANT_ID,
			site: SITE,
			account: null,
			identity: {
				attempt: ATTEMPT,
				attemptStartedAt: 1_800_000_000_000,
				proofClass: "same_origin_host_proof",
			},
			hostGeneration: 1,
			requestFingerprint,
		});
		expect(permit).toMatchObject({
			admissionId: "admission_123",
			state: "creation_uncertain",
			requestedStripeExpiresAt: 1_800_086_100,
		});
		expect(permit.handleHash).toMatch(/^[0-9a-f]{64}$/);
		expect(permit.stripeIdempotencyKey).toMatch(/^checkout-admission-v1:[0-9a-f]{64}$/);
		expect(await client.markCreating(permit)).toBe(1_800_086_100);
		await client.bind({
			permit,
			session: "cs_test_1234567890abcdefghijklmnop",
			stripeExpiresAt: 1_800_086_100,
			checkoutSnapshotHandle: "223e4567-e89b-42d3-a456-426614174000",
		});

		const beginBody = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
		expect(beginBody).toMatchObject({
			version: 1,
			tenantId: TENANT_ID,
			site: SITE,
			account: null,
			proofClass: "same_origin_host_proof",
			hostGeneration: 1,
			requestFingerprint,
		});
		expect(beginBody).not.toHaveProperty("attempt");
		expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
			Authorization: expect.stringMatching(/^Bearer /),
			"Content-Type": "application/json",
		});
	});

	it.each([true, false])("preserves the confirmed release result (%s)", async (released) => {
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({
					outcome: "created",
					admissionId: "admission_123",
					state: "active_prestripe",
					admissionGeneration: 1,
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({ state: "creating", requestedStripeExpiresAt: 1_800_086_100 }),
			)
			.mockResolvedValueOnce(jsonResponse({ released }));
		const client = createCheckoutSessionAdmissionClient({
			baseUrl: "https://convex.example",
			fetcher,
			credential: () => "synthetic-authority-0123456789",
		});
		const permit = await client.begin({
			site: "client.example",
			account: "acct_1234567890TenantA",
			identity: {
				attempt: ATTEMPT,
				attemptStartedAt: 1_800_000_000_000,
				proofClass: "signed_bridge_body",
			},
			hostGeneration: 1,
			requestFingerprint: "a".repeat(64),
		});
		await client.markCreating(permit, ATTEMPT);
		expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toHaveProperty(
			"checkoutSnapshotHandle",
			ATTEMPT,
		);
		expect(await client.release(permit)).toBe(released);
	});

	it("fails closed on an oversized or non-success response", async () => {
		const client = createCheckoutSessionAdmissionClient({
			baseUrl: "https://convex.example",
			fetcher: vi.fn().mockResolvedValue(jsonResponse({ error: "closed" }, 503)),
			credential: () => "tenant-authority-secret-0123456789",
		});
		await expect(
			client.begin({
				site: SITE,
				account: null,
				identity: {
					attempt: ATTEMPT,
					attemptStartedAt: 1_800_000_000_000,
					proofClass: "same_origin_host_proof",
				},
				hostGeneration: 1,
				requestFingerprint: "a".repeat(64),
			}),
		).rejects.toThrow("Checkout admission is unavailable");
	});

	it("rejects a successful response with unrecognized fields", async () => {
		const client = createCheckoutSessionAdmissionClient({
			baseUrl: "https://convex.example",
			fetcher: vi.fn().mockResolvedValue(
				jsonResponse({
					outcome: "created",
					admissionId: "admission_123",
					state: "active_prestripe",
					admissionGeneration: 1,
					extra: "not-accepted",
				}),
			),
			credential: () => "tenant-authority-secret-0123456789",
		});
		await expect(
			client.begin({
				site: SITE,
				account: null,
				identity: {
					attempt: ATTEMPT,
					attemptStartedAt: 1_800_000_000_000,
					proofClass: "same_origin_host_proof",
				},
				hostGeneration: 1,
				requestFingerprint: "a".repeat(64),
			}),
		).rejects.toThrow("Checkout admission is unavailable");
	});
});
