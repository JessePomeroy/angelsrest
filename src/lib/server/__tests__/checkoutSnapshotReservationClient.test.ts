import { describe, expect, it, vi } from "vitest";
import { createCheckoutSnapshotReservationClient } from "$lib/server/checkoutSnapshotReservationClient";

const ATTEMPT = "123e4567-e89b-42d3-a456-426614174000";
const HANDLE = "223e4567-e89b-42d3-a456-426614174000";
const SESSION = "cs_test_1234567890abcdefghijklmnop";
const SECRET = "reservation-secret-that-must-never-escape";
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
			snapshot: { schemaVersion: 1, catalogProvider: "sanity", items: [snapshotItem] },
		});
		expect(fetcher.mock.calls[1]?.[0]).toBe(
			"https://tenant.convex.site/commerce/checkout-snapshots/bind",
		);
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
					items: [snapshotItem],
				})
				.catch((value: unknown) => value);
			expect(error).toBeInstanceOf(Error);
			for (const value of forbidden) expect(String(error)).not.toContain(value);
		}
	});
});
