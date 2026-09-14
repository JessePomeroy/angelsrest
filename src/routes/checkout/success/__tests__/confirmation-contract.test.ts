import type Stripe from "stripe";
import { render } from "svelte/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "$convex/api";
import type { CheckoutSnapshotItem } from "$lib/server/checkoutCatalog";
import { resolveCurrentCheckoutCommerce } from "$lib/server/current/currentCheckoutCommerce.server";
import { createDirectCheckoutSession } from "$lib/server/directCheckout";
import { load } from "../+page.server";
import Page from "../+page.svelte";

const boundary = vi.hoisted(() => ({
	create: vi.fn(),
	retrieve: vi.fn(),
	order: vi.fn(),
}));
vi.mock("$lib/server/stripeClient", () => ({
	getStripe: () => ({ checkout: { sessions: { retrieve: boundary.retrieve } } }),
}));
vi.mock("$lib/server/convexClient", () => ({
	getConvex: () => ({ query: boundary.order }),
}));

const sessionId = "cs_test_confirmation";
const digital: CheckoutSnapshotItem = {
	productKey: "private-product-id",
	revisionId: "private-revision-id",
	productKind: "digital_download",
	variantKey: "variant",
	materialOptionKey: null,
	sizeOptionKey: null,
	borderOptionKey: null,
	frameOptionKey: null,
};
const snapshot = (items: readonly CheckoutSnapshotItem[] = [digital]) => ({
	schemaVersion: 1,
	catalogProvider: "convex",
	items,
});
const siteSettings = {
	artistName: null,
	siteTitle: null,
	tagline: null,
	logoUrl: null,
	socialLinks: [],
	seo: { description: null, ogImageUrl: null, keywords: [] },
};
const shipping = {
	name: "Buyer",
	address: {
		line1: "123 Test St",
		line2: null,
		city: "Test City",
		state: "MI",
		postal_code: "12345",
		country: "US",
	},
};

function session(overrides: Record<string, unknown> = {}) {
	return {
		id: sessionId,
		customer_details: { email: "buyer@example.test" },
		collected_information: null,
		payment_status: "paid",
		amount_total: 1200,
		currency: "usd",
		line_items: { data: [{ description: "Digital zine", quantity: 1, amount_total: 1200 }] },
		metadata: {
			checkoutSnapshotVersion: "2",
			checkoutSnapshotHandle: "223e4567-e89b-42d3-a456-426614174000",
			commerceTenantSiteUrl: "angelsrest.online",
		},
		...overrides,
	};
}

async function confirmation(owner = true) {
	const event: Pick<Parameters<typeof load>[0], "url" | "cookies"> = {
		url: new URL(`https://angelsrest.online/checkout/success?session_id=${sessionId}`),
		cookies: {
			get: () => (owner ? sessionId : undefined),
			getAll: () => [],
			set: vi.fn(),
			delete: vi.fn(),
			serialize: () => "",
		},
	};
	const result = await load(event as Parameters<typeof load>[0]);
	const html = render(Page, { props: { data: { ...result, siteSettings } } }).body;
	return { result, html };
}

function downloadUrls(html: string) {
	return Array.from(
		html.matchAll(/href="(\/api\/download[^"]+)"/g),
		([, href]) => new URL(href.replaceAll("&amp;", "&"), "https://angelsrest.online"),
	);
}

// Exercise the real current authority, direct/handle builders, binding and
// Stripe metadata producer. Only catalog, provider and persistence seams are fake.
async function currentPurchase(kind: "digital_download" | "merchandise") {
	const now = Date.now();
	const reserve = vi.fn().mockResolvedValue({
		handle: "223e4567-e89b-42d3-a456-426614174000",
	});
	const bindSession = vi.fn();
	await createDirectCheckoutSession({
		body: { productId: "current-product" },
		stripe: { checkout: { sessions: { create: boundary.create } } } as unknown as Stripe,
		siteUrl: "https://angelsrest.online",
		bindSession,
		log: vi.fn(),
		resolveCommerce: (selections) =>
			resolveCurrentCheckoutCommerce(selections, {
				query: async () => ({
					schemaVersion: 2,
					slug: "current-product",
					productId: digital.productKey,
					revisionId: digital.revisionId,
					productKind: kind,
					variants: [{ key: "variant", materialOption: null, sizeOption: null }],
				}),
				resolve: async (item) => ({
					version: 1,
					purpose: "checkout",
					item,
					identity: {
						productId: item.productKey,
						revisionId: item.revisionId,
						productKind: kind,
						title: "Current product",
						slug: "current-product",
						variantKey: "variant",
					},
					commerce: { currency: "usd", amountCents: 1200, finish: null },
					media: [
						{
							key: "photo",
							role: "gallery",
							order: 0,
							altText: "",
							asset: {
								assetId: "123e4567-e89b-42d3-a456-426614174000",
								source: null,
								derivatives: {
									thumb: null,
									card: null,
									display1280: { contentType: "image/webp", width: 600, height: 800 },
									display2048: null,
									display2560: null,
								},
							},
						},
					],
				}),
			}),
		attemptIdentity: {
			attempt: "123e4567-e89b-42d3-a456-426614174000",
			attemptStartedAt: now,
			proofClass: "same_origin_host_proof",
		},
		hostGeneration: 1,
		now,
		reservationClient: { reserve, bind: vi.fn() },
		admissionClient: {
			begin: vi
				.fn()
				.mockResolvedValue({ handleHash: "a".repeat(64), stripeIdempotencyKey: "test-key" }),
			markCreating: vi.fn().mockResolvedValue(Math.floor(now / 1000) + 86100),
			markUncertain: vi.fn(),
			bind: vi.fn(),
			release: vi.fn(),
		},
	});
	expect(bindSession).toHaveBeenCalledWith(sessionId);
	const created: Stripe.Checkout.SessionCreateParams = boundary.create.mock.calls[0][0];
	expect(created.metadata).not.toHaveProperty("isDigital");
	expect(created.metadata).not.toHaveProperty("productSlug");
	boundary.retrieve.mockResolvedValue(
		session({
			metadata: created.metadata,
			collected_information: kind === "merchandise" ? { shipping_details: shipping } : null,
		}),
	);
	boundary.order.mockResolvedValue({
		checkoutSnapshot: snapshot(reserve.mock.calls[0][0].items),
		refunded: false,
	});
	return created;
}

describe("current checkout producer to confirmation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		boundary.create.mockResolvedValue({ id: sessionId, url: "https://checkout.example.test/pay" });
		boundary.retrieve.mockResolvedValue(session());
		boundary.order.mockResolvedValue({ checkoutSnapshot: snapshot(), refunded: false });
		vi.stubGlobal(
			"fetch",
			vi.fn(() => {
				throw new Error("Unexpected live request");
			}),
		);
		vi.spyOn(console, "error").mockImplementation(() => {});
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("renders the paid current digital purchase's download without legacy metadata or shipping copy", async () => {
		const created = await currentPurchase("digital_download");
		expect(created.shipping_address_collection).toBeUndefined();
		const { result, html } = await confirmation();
		expect(boundary.order).toHaveBeenCalledWith(api.orders.resolvePaidDownloadOrder, {
			stripeSessionId: sessionId,
			webhookSecret: "test-webhook-secret",
		});
		const [url] = downloadUrls(html);
		expect(url?.searchParams.get("session_id")).toBe(sessionId);
		expect(url?.searchParams.get("item")).toBe("0");
		expect(url?.searchParams.has("slug")).toBe(false);
		expect(url?.searchParams.has("email")).toBe(false);
		expect(html).toContain("download now");
		expect(html).not.toContain("Made-to-order prints");
		expect(JSON.stringify(result)).not.toContain(digital.productKey);
		expect(JSON.stringify(result)).not.toContain(digital.revisionId);
		expect(JSON.stringify(result)).not.toContain("checkoutSnapshotHandle");
	});

	it("retains current physical confirmation and shipping details without a download", async () => {
		const created = await currentPurchase("merchandise");
		expect(created.shipping_address_collection).toEqual({ allowed_countries: ["US"] });
		const { html } = await confirmation();
		expect(downloadUrls(html)).toEqual([]);
		expect(html).toContain("123 Test St");
		expect(html).toContain("Made-to-order prints");
	});

	it("keeps original digital ordinals alongside physical items", async () => {
		boundary.order.mockResolvedValue({
			checkoutSnapshot: snapshot([{ ...digital, productKind: "merchandise" }, digital, digital]),
			refunded: false,
		});
		const { html } = await confirmation();
		expect(downloadUrls(html).map((url) => url.searchParams.get("item"))).toEqual(["1", "2"]);
		expect(html).toContain("Made-to-order prints");
	});

	it("does not read order authority or expose downloads before buyer verification", async () => {
		const { result, html } = await confirmation(false);
		expect(result.orderDetails).toBeNull();
		expect(boundary.order).not.toHaveBeenCalled();
		expect(downloadUrls(html)).toEqual([]);
		expect(html).not.toContain("buyer@example.test");
	});

	it("does not query or offer downloads for an unpaid session", async () => {
		boundary.retrieve.mockResolvedValue(session({ payment_status: "unpaid" }));
		const { html } = await confirmation();
		expect(boundary.order).not.toHaveBeenCalled();
		expect(downloadUrls(html)).toEqual([]);
		expect(html).not.toContain("Your payment was successful");
		expect(html).not.toContain("Made-to-order prints");
	});

	it.each([
		["missing or retired order", null],
		["legacy order without snapshot", { refunded: false }],
		[
			"unsupported snapshot",
			{ checkoutSnapshot: { ...snapshot(), catalogProvider: "retired" }, refunded: false },
		],
	])("offers neutral refresh/help for %s without guessing physical fulfillment", async (_name, order) => {
		boundary.order.mockResolvedValue(order);
		const { html } = await confirmation();
		expect(downloadUrls(html)).toEqual([]);
		expect(html).not.toContain("Made-to-order prints");
		expect(html).toContain("refresh order details");
		expect(html).toContain('href="/orders"');
	});

	it("preserves order details and recovery controls when authority is temporarily unavailable", async () => {
		boundary.order.mockRejectedValue(new Error("Synthetic backend unavailable"));
		const { html } = await confirmation();
		expect(html).toContain("buyer@example.test");
		expect(html).toContain("refresh order details");
		expect(downloadUrls(html)).toEqual([]);
		expect(html).not.toContain("Made-to-order prints");
	});

	it("suppresses refunded or refund-pending downloads without claiming a completed refund", async () => {
		boundary.order.mockResolvedValue({ checkoutSnapshot: snapshot(), refunded: true });
		const { html } = await confirmation();
		expect(downloadUrls(html)).toEqual([]);
		expect(html).toContain("downloads are unavailable");
		expect(html).not.toContain("has been refunded");
		expect(html).not.toContain("Made-to-order prints");
	});

	it("uses stored authority for older sessions, never their legacy slug or digital flag", async () => {
		boundary.retrieve.mockResolvedValue(
			session({ metadata: { isDigital: "false", productSlug: "old-slug" } }),
		);
		const { html } = await confirmation();
		expect(downloadUrls(html).map((url) => url.searchParams.get("item"))).toEqual(["0"]);
		expect(html).not.toContain("old-slug");
		expect(html).not.toContain("Made-to-order prints");
	});

	it("retains unmarked legacy physical shipping copy without authorizing a download", async () => {
		boundary.retrieve.mockResolvedValue(
			session({
				metadata: { isDigital: "false" },
				collected_information: { shipping_details: shipping },
			}),
		);
		boundary.order.mockResolvedValue({ refunded: false });
		const { html } = await confirmation();
		expect(downloadUrls(html)).toEqual([]);
		expect(html).toContain("123 Test St");
		expect(html).toContain("Made-to-order prints");
	});
});
