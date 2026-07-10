import { describe, expect, it } from "vitest";
import { load } from "../+page.server";

async function expectRedirect(callback: () => Promise<unknown> | unknown, location: string) {
	try {
		await callback();
		expect.fail("expected redirect");
	} catch (err) {
		expect((err as { status: number }).status).toBe(303);
		expect((err as { location: string }).location).toBe(location);
	}
}

describe("orders page privacy redirect", () => {
	it("strips legacy email query params while preserving order number", async () => {
		await expectRedirect(
			() =>
				load({
					url: new URL("https://angelsrest.test/orders?email=buyer%40example.com&order=ORD-001"),
				} as never),
			"/orders?order=ORD-001",
		);
	});

	it("strips empty or duplicated legacy email query params", async () => {
		await expectRedirect(
			() =>
				load({
					url: new URL(
						"https://angelsrest.test/orders?email=&email=buyer%40example.com&order=ORD-001",
					),
				} as never),
			"/orders?order=ORD-001",
		);
	});

	it("does not redirect clean order lookup URLs", () => {
		expect(
			load({
				url: new URL("https://angelsrest.test/orders?order=ORD-001"),
			} as never),
		).toEqual({});
	});
});
