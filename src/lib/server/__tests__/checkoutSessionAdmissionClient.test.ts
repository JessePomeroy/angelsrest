import { describe, expect, it, vi } from "vitest";
import {
	checkoutRequestFingerprint,
	createCheckoutSessionAdmissionClient,
} from "$lib/server/checkoutSessionAdmissionClient";

const SITE = "angelsrest.online";
const ATTEMPT = "123e4567-e89b-42d3-a456-426614174000";

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("Checkout Session admission client", () => {
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
