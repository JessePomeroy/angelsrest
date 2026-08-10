import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	retrieve: vi.fn(),
	isOwner: vi.fn(),
	query: vi.fn(),
	paidDownload: vi.fn(),
	paidFile: vi.fn(),
	exactSanity: vi.fn(),
	legacySanity: vi.fn(),
	privateEnv: {
		WEBHOOK_SECRET: "webhook-secret",
		ORDER_PRODUCERS_STATE: "open",
	},
}));
vi.mock("$convex/api", () => ({
	api: { orders: { resolvePaidDownloadOrder: "orders.resolvePaidDownloadOrder" } },
}));
vi.mock("$env/dynamic/private", () => ({ env: mocks.privateEnv }));
vi.mock("$lib/server/stripeClient", () => ({
	getStripe: () => ({ checkout: { sessions: { retrieve: mocks.retrieve } } }),
}));
vi.mock("$lib/server/checkoutBinding", () => ({ isCheckoutSessionOwner: mocks.isOwner }));
vi.mock("$lib/server/convexClient", () => ({ getConvex: () => ({ query: mocks.query }) }));
vi.mock("$lib/server/catalogCommerceClients", () => ({
	resolvePaidDownload: mocks.paidDownload,
	issuePaidFile: mocks.paidFile,
}));
vi.mock("$lib/sanity/client", () => ({
	client: {
		withConfig: () => ({ fetch: mocks.exactSanity }),
		fetch: mocks.legacySanity,
	},
}));

const digital = {
	productKey: "product-id",
	revisionId: "revision-id",
	productKind: "digital_download" as const,
	variantKey: null,
	materialOptionKey: null,
	sizeOptionKey: null,
	borderOptionKey: null,
	frameOptionKey: null,
};
const snapshot = {
	schemaVersion: 1 as const,
	catalogProvider: "convex" as const,
	items: [digital],
};
const event = (query = "session_id=cs_test_paid&slug=legacy") =>
	({
		url: new URL(`https://site.test/api/download?${query}`),
		cookies: {},
	}) as never;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.privateEnv.ORDER_PRODUCERS_STATE = "open";
	mocks.retrieve.mockResolvedValue({
		id: "cs_test_paid",
		payment_status: "paid",
		customer_details: { email: "buyer@example.com" },
		metadata: { productSlug: "legacy", isDigital: "true" },
	});
	mocks.isOwner.mockReturnValue(true);
	mocks.query.mockResolvedValue({ checkoutSnapshot: snapshot, refunded: false });
	mocks.paidDownload.mockResolvedValue({
		item: digital,
		identity: { productKind: "digital_download" },
		descriptor: {
			kind: "paid_zip",
			key: "paid/key",
			hash: "a".repeat(64),
			bytes: 10,
			mime: "application/zip",
		},
	});
	mocks.paidFile.mockResolvedValue("https://opaque.example/sealed.zip?token=opaque");
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () =>
				new Response("zip", {
					headers: { "Content-Type": "application/zip", "Content-Length": "3" },
				}),
		),
	);
});

describe("paid download", () => {
	it("rejects missing or retired order authority before any Stripe read", async () => {
		const { GET } = await import("./+server");
		mocks.query.mockResolvedValueOnce(null);

		await expect(GET(event())).rejects.toMatchObject({ status: 409 });
		expect(mocks.retrieve).not.toHaveBeenCalled();
	});

	it("checks order authority before Stripe paid and buyer authorization", async () => {
		const { GET } = await import("./+server");
		mocks.retrieve.mockResolvedValueOnce({ payment_status: "unpaid" });
		await expect(GET(event())).rejects.toMatchObject({ status: 403 });
		expect(mocks.query).toHaveBeenCalledTimes(1);
		mocks.retrieve.mockResolvedValueOnce({
			payment_status: "paid",
			customer_details: { email: "buyer@example.com" },
		});
		mocks.isOwner.mockReturnValueOnce(false);
		await expect(
			GET(event("session_id=cs_test_paid&email=other%40example.com")),
		).rejects.toMatchObject({ status: 403 });
		expect(mocks.query).toHaveBeenCalledTimes(2);
	});

	it("retains existing paid downloads while order production is quiesced", async () => {
		const { GET } = await import("./+server");
		mocks.privateEnv.ORDER_PRODUCERS_STATE = "closed";

		await expect(GET(event())).resolves.toMatchObject({ status: 303 });
		expect(mocks.query).toHaveBeenCalledTimes(2);
		expect(mocks.retrieve).toHaveBeenCalledOnce();
	});

	it.each([
		"convex",
		"sanity",
	] as const)("accepts valid %s inline-v1 omitted options and canonicalizes the issuer race", async (catalogProvider) => {
		const { GET } = await import("./+server");
		const omitted = {
			productKey: digital.productKey,
			revisionId: digital.revisionId,
			productKind: digital.productKind,
			variantKey: digital.variantKey,
		};
		const initial = { ...snapshot, catalogProvider, items: [omitted] };
		const canonical = { ...snapshot, catalogProvider };
		mocks.query
			.mockResolvedValueOnce({ checkoutSnapshot: initial, refunded: false })
			.mockResolvedValueOnce({ checkoutSnapshot: canonical, refunded: false });
		mocks.exactSanity.mockResolvedValue({
			_id: digital.productKey,
			_rev: digital.revisionId,
			fileUrl: "https://cdn.sanity.io/file.zip",
		});
		const response = await GET(event("session_id=cs_test_paid&item=0"));
		expect(response.status).toBe(catalogProvider === "convex" ? 303 : 200);
		if (catalogProvider === "convex") {
			expect(mocks.paidDownload).toHaveBeenCalledWith("cs_test_paid", 0);
		} else {
			expect(mocks.exactSanity).toHaveBeenCalled();
			expect(await response.text()).toBe("zip");
		}
	});

	it("discards an issued Convex grant when refund or immutable item changes", async () => {
		const { GET } = await import("./+server");
		for (const race of [
			{ checkoutSnapshot: snapshot, refunded: true },
			{
				checkoutSnapshot: { ...snapshot, items: [{ ...digital, revisionId: "changed" }] },
				refunded: false,
			},
		]) {
			mocks.query
				.mockResolvedValueOnce({ checkoutSnapshot: snapshot, refunded: false })
				.mockResolvedValueOnce(race);
			await expect(GET(event())).rejects.toMatchObject({ status: 409 });
		}
	});

	it("exact-resolves Sanity without caller slug and closes a refund race", async () => {
		const { GET } = await import("./+server");
		const sanitySnapshot = { ...snapshot, catalogProvider: "sanity" as const };
		mocks.query
			.mockResolvedValueOnce({ checkoutSnapshot: sanitySnapshot, refunded: false })
			.mockResolvedValueOnce({ checkoutSnapshot: sanitySnapshot, refunded: true });
		mocks.exactSanity.mockResolvedValue({
			_id: "product-id",
			_rev: "revision-id",
			fileUrl: "https://cdn.sanity.io/file.zip",
		});
		await expect(GET(event("session_id=cs_test_paid&slug=wrong"))).rejects.toMatchObject({
			status: 409,
		});
		expect(mocks.exactSanity).toHaveBeenCalledWith(
			expect.stringContaining("_id == $id && _rev == $rev"),
			{
				id: "product-id",
				rev: "revision-id",
			},
		);
		expect(fetch).not.toHaveBeenCalled();
		expect(mocks.paidDownload).not.toHaveBeenCalled();
	});
});
