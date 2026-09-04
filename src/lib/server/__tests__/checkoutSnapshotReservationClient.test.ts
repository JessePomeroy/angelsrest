import { describe, expect, it, vi } from "vitest";
import {
	createCheckoutSnapshotReservationClient,
	isCheckoutSnapshotReservationConflict,
} from "$lib/server/checkoutSnapshotReservationClient";

const ATTEMPT = "123e4567-e89b-42d3-a456-426614174000";
const HANDLE = "223e4567-e89b-42d3-a456-426614174000";
const SESSION = "cs_test_1234567890abcdefghijklmnop";
const SECRET = "reservation-secret-that-must-never-escape";
const TENANT_ID = "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b";
const snapshotItem = {
	productKey: "product-secret-selection",
	revisionId: "revision-secret-selection",
	productKind: "print" as const,
	variantKey: "variant-secret-selection",
	materialOptionKey: "paper-secret-selection",
	sizeOptionKey: "size-secret-selection",
	borderOptionKey: null,
	frameOptionKey: null,
};

describe("checkout snapshot reservation client", () => {
	it("sends exact bounded reserve and bind contracts with per-request auth", async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ version: 2, handle: HANDLE, replayed: false }), {
					status: 200,
				}),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ bound: true, replayed: false }), { status: 200 }),
			);
		const client = createCheckoutSnapshotReservationClient({
			baseUrl: "https://tenant.convex.site",
			fetcher,
			credential: () => SECRET,
		});
		await expect(
			client.reserve({
				site: "angelsrest.test",
				attempt: ATTEMPT,
				account: null,
				catalogProvider: "convex",
				items: [snapshotItem],
			}),
		).resolves.toEqual({ handle: HANDLE });
		await client.bind({
			site: "angelsrest.test",
			handle: HANDLE,
			account: null,
			session: SESSION,
			stripeExpiresAt: 1_800_086_100,
		});
		const reserve = fetcher.mock.calls[0];
		expect(reserve?.[0]).toBe("https://tenant.convex.site/commerce/checkout-snapshots/reserve");
		expect(reserve?.[1]?.headers).toEqual({
			Authorization: `Bearer ${SECRET}`,
			"Content-Type": "application/json",
		});
		expect(JSON.parse(String(reserve?.[1]?.body))).toEqual({
			version: 1,
			site: "angelsrest.test",
			attempt: ATTEMPT,
			account: null,
			snapshot: { schemaVersion: 1, catalogProvider: "convex", items: [snapshotItem] },
		});
		expect(fetcher.mock.calls[1]?.[0]).toBe(
			"https://tenant.convex.site/commerce/checkout-snapshots/bind",
		);
	});

	it("adds the opaque tenant ID only when the host supplies it", async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ version: 2, handle: HANDLE, replayed: false })),
			)
			.mockResolvedValueOnce(new Response(JSON.stringify({ bound: true, replayed: false })));
		const client = createCheckoutSnapshotReservationClient({
			baseUrl: "https://tenant.convex.site",
			fetcher,
			credential: () => SECRET,
		});
		await client.reserve({
			tenantId: TENANT_ID,
			site: "angelsrest.online",
			attempt: ATTEMPT,
			account: null,
			catalogProvider: "convex",
			items: [snapshotItem],
		});
		await client.bind({
			tenantId: TENANT_ID,
			site: "angelsrest.online",
			handle: HANDLE,
			account: null,
			session: SESSION,
			stripeExpiresAt: 1_800_086_100,
		});
		expect(fetcher.mock.calls.map((call) => JSON.parse(String(call[1]?.body)))).toEqual([
			expect.objectContaining({ tenantId: TENANT_ID }),
			expect.objectContaining({ tenantId: TENANT_ID }),
		]);
	});

	it("aborts stalled streams and stops chunked responses above 2 KiB", async () => {
		const stalled = vi.fn<typeof fetch>((_input, init) =>
			Promise.resolve(
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(new Uint8Array(1));
							init?.signal?.addEventListener("abort", () => controller.error(new Error(SECRET)));
						},
					}),
				),
			),
		);
		const input = {
			site: "angelsrest.test",
			attempt: ATTEMPT,
			account: null,
			catalogProvider: "convex" as const,
			items: [snapshotItem],
		};
		await expect(
			createCheckoutSnapshotReservationClient({
				baseUrl: "https://tenant.convex.site",
				fetcher: stalled,
				credential: () => SECRET,
				timeoutMs: 5,
			}).reserve(input),
		).rejects.toThrow("Checkout reservation is unavailable");

		const oversized = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(1_500));
				controller.enqueue(new Uint8Array(600));
				controller.close();
			},
		});
		await expect(
			createCheckoutSnapshotReservationClient({
				baseUrl: "https://tenant.convex.site",
				fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response(oversized)),
				credential: () => SECRET,
			}).reserve(input),
		).rejects.toThrow("Checkout reservation is unavailable");
	});

	it("classifies only a bounded returned conflict as definitive", async () => {
		const client = createCheckoutSnapshotReservationClient({
			baseUrl: "https://tenant.convex.site",
			fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 409 })),
			credential: () => SECRET,
		});
		const error = await client
			.reserve({
				site: "angelsrest.test",
				attempt: ATTEMPT,
				account: null,
				catalogProvider: "convex",
				items: [snapshotItem],
			})
			.catch((value: unknown) => value);
		expect(isCheckoutSnapshotReservationConflict(error)).toBe(true);
		expect(String(error)).not.toContain(SECRET);
	});

	it("redacts credentials, handles, snapshots, IDs, URLs, and response bodies", async () => {
		const forbidden = [SECRET, HANDLE, SESSION, "product-secret", "tenant.convex.site"];
		for (const fetcher of [
			vi.fn<typeof fetch>().mockRejectedValue(new Error(forbidden.join(" "))),
			vi.fn<typeof fetch>().mockResolvedValue(new Response(forbidden.join(" "), { status: 500 })),
		]) {
			const client = createCheckoutSnapshotReservationClient({
				baseUrl: "https://tenant.convex.site",
				fetcher,
				credential: () => SECRET,
			});
			const error = await client
				.reserve({
					site: "angelsrest.test",
					attempt: ATTEMPT,
					account: null,
					catalogProvider: "convex",
					items: [snapshotItem],
				})
				.catch((value: unknown) => value);
			expect(error).toBeInstanceOf(Error);
			for (const value of forbidden) expect(String(error)).not.toContain(value);
		}
	});
});
