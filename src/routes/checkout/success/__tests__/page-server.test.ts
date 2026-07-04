import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	retrieveSession: vi.fn(),
}));

vi.mock("$lib/server/stripeClient", () => ({
	getStripe: () => ({
		checkout: { sessions: { retrieve: mocks.retrieveSession } },
	}),
}));

import { actions, load } from "../+page.server";

function cookies(initial: Record<string, string> = {}) {
	const jar = new Map(Object.entries(initial));
	return {
		get: vi.fn((name: string) => jar.get(name)),
		set: vi.fn((name: string, value: string) => jar.set(name, value)),
		delete: vi.fn((name: string) => jar.delete(name)),
	};
}

function paidSession(overrides: Record<string, unknown> = {}) {
	return {
		id: "cs_test_123",
		customer_details: { email: "buyer@example.com", name: "Buyer" },
		collected_information: null,
		line_items: { data: [] },
		metadata: { isDigital: "true", productSlug: "digital-zine" },
		amount_total: 1200,
		currency: "usd",
		payment_status: "paid",
		...overrides,
	};
}

async function expectRedirect(promise: Promise<unknown>, location: string) {
	try {
		await promise;
		expect.fail("expected redirect");
	} catch (err) {
		expect(err).toMatchObject({ status: 303, location });
	}
}

describe("checkout success session verification", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.retrieveSession.mockResolvedValue(paidSession());
	});

	it("returns an unverified state without PII when the browser has no session proof", async () => {
		const result = await load({
			url: new URL("https://angelsrest.test/checkout/success?session_id=cs_test_123"),
			cookies: cookies(),
		} as never);

		expect(result).toEqual({
			orderDetails: null,
			unverified: true,
			sessionId: "cs_test_123",
		});
	});

	it("sets an httpOnly session proof after the buyer verifies by email", async () => {
		const cookieJar = cookies();

		await expectRedirect(
			actions.verify({
				request: new Request("https://angelsrest.test/checkout/success?/verify", {
					method: "POST",
					body: new URLSearchParams({
						session_id: "cs_test_123",
						email: "buyer@example.com",
					}),
				}),
				cookies: cookieJar,
			} as never),
			"/checkout/success?session_id=cs_test_123",
		);

		expect(cookieJar.set).toHaveBeenCalledWith(
			"ar_checkout_sid",
			"cs_test_123",
			expect.objectContaining({ httpOnly: true, path: "/", sameSite: "lax" }),
		);
	});

	it("keeps the verifier form state available after a failed action posts with the session id query", async () => {
		const result = await load({
			url: new URL("https://angelsrest.test/checkout/success?/verify&session_id=cs_test_123"),
			cookies: cookies(),
		} as never);

		expect(result).toEqual({
			orderDetails: null,
			unverified: true,
			sessionId: "cs_test_123",
		});
	});

	it("returns a form error when buyer email verification fails", async () => {
		const result = await actions.verify({
			request: new Request(
				"https://angelsrest.test/checkout/success?/verify&session_id=cs_test_123",
				{
					method: "POST",
					body: new URLSearchParams({
						session_id: "cs_test_123",
						email: "wrong@example.com",
					}),
				},
			),
			cookies: cookies(),
		} as never);

		expect(result).toMatchObject({
			status: 403,
			data: {
				verifyError: "that email doesn't match this order.",
				sessionId: "cs_test_123",
			},
		});
	});

	it("cleans legacy emailed links that still contain the buyer email query", async () => {
		const cookieJar = cookies();

		await expectRedirect(
			load({
				url: new URL(
					"https://angelsrest.test/checkout/success?session_id=cs_test_123&email=buyer%40example.com",
				),
				cookies: cookieJar,
			} as never),
			"/checkout/success?session_id=cs_test_123",
		);

		expect(cookieJar.set).toHaveBeenCalledWith(
			"ar_checkout_sid",
			"cs_test_123",
			expect.objectContaining({ httpOnly: true, path: "/", sameSite: "lax" }),
		);
	});

	it("cleans legacy email query links even when the browser already has session proof", async () => {
		const cookieJar = cookies({ ar_checkout_sid: "cs_test_123" });

		await expectRedirect(
			load({
				url: new URL(
					"https://angelsrest.test/checkout/success?session_id=cs_test_123&email=buyer%40example.com",
				),
				cookies: cookieJar,
			} as never),
			"/checkout/success?session_id=cs_test_123",
		);

		expect(mocks.retrieveSession).not.toHaveBeenCalled();
		expect(cookieJar.set).not.toHaveBeenCalled();
	});
});
