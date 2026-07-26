import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	retrieve: vi.fn(),
	isOwner: vi.fn(),
	query: vi.fn(),
	paidDownload: vi.fn(),
	paidFile: vi.fn(),
	exactSanity: vi.fn(),
	legacySanity: vi.fn(),
}));
vi.mock("$convex/api", () => ({
	api: { orders: { resolvePaidDownloadOrder: "orders.resolvePaidDownloadOrder" } },
}));
vi.mock("$env/dynamic/private", () => ({ env: { WEBHOOK_SECRET: "webhook-secret" } }));
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
	it("finishes Stripe paid and buyer authorization before any order resolution", async () => {
		const { GET } = await import("./+server");
		mocks.retrieve.mockResolvedValueOnce({ payment_status: "unpaid" });
		await expect(GET(event())).rejects.toMatchObject({ status: 403 });
		expect(mocks.query).not.toHaveBeenCalled();
		mocks.retrieve.mockResolvedValueOnce({
			payment_status: "paid",
			customer_details: { email: "buyer@example.com" },
		});
		mocks.isOwner.mockReturnValueOnce(false);
		await expect(
			GET(event("session_id=cs_test_paid&email=other%40example.com")),
		).rejects.toMatchObject({ status: 403 });
		expect(mocks.query).not.toHaveBeenCalled();
		expect(mocks.paidDownload).not.toHaveBeenCalled();
		expect(mocks.paidFile).not.toHaveBeenCalled();
	});

	it("uses the exact snapshot ordinal, paid resolver, and issuer for Convex only", async () => {
		const { GET } = await import("./+server");
		const response = await GET(event("session_id=cs_test_paid&slug=ignored&item=0"));
		expect(mocks.query).toHaveBeenCalledTimes(2);
		expect(mocks.query).toHaveBeenCalledWith("orders.resolvePaidDownloadOrder", {
			stripeSessionId: "cs_test_paid",
			webhookSecret: "webhook-secret",
		});
		expect(mocks.paidDownload).toHaveBeenCalledWith("cs_test_paid", 0);
		expect(mocks.paidFile).toHaveBeenCalledWith(expect.objectContaining({ key: "paid/key" }));
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("https://opaque.example/sealed.zip?token=opaque");
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("referrer-policy")).toBe("no-referrer");
	});

	it("rejects refunded, wrong-kind, missing, and ambiguous ordinals before issuing", async () => {
		const { GET } = await import("./+server");
		mocks.query.mockResolvedValueOnce({ checkoutSnapshot: snapshot, refunded: true });
		await expect(GET(event())).rejects.toMatchObject({ status: 409 });
		mocks.query.mockResolvedValueOnce({
			checkoutSnapshot: { ...snapshot, items: [{ ...digital, productKind: "print" }] },
			refunded: false,
		});
		await expect(GET(event())).rejects.toMatchObject({ status: 404 });
		await expect(GET(event("session_id=cs_test_paid&item=00"))).rejects.toMatchObject({
			status: 400,
		});
		expect(mocks.paidFile).not.toHaveBeenCalled();
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
		expect(mocks.paidFile).not.toHaveBeenCalled();
	});

	it("preserves the snapshot-absent legacy Sanity slug stream", async () => {
		const { GET } = await import("./+server");
		mocks.query.mockResolvedValueOnce({ checkoutSnapshot: undefined, refunded: false });
		mocks.legacySanity.mockResolvedValue({ fileUrl: "https://cdn.sanity.io/legacy.zip" });
		const response = await GET(event());
		expect(mocks.legacySanity).toHaveBeenCalledWith(
			expect.stringContaining("slug.current == $slug"),
			{
				slug: "legacy",
			},
		);
		expect(fetch).toHaveBeenCalledWith("https://cdn.sanity.io/legacy.zip");
		expect(await response.text()).toBe("zip");
		expect(mocks.paidDownload).not.toHaveBeenCalled();
	});
});
