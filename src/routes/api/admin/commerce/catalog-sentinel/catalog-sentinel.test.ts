import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	verify: vi.fn(),
	resolve: vi.fn(),
	resolveCatalogCheckout: vi.fn(),
	sanityFetch: vi.fn(),
	env: {
		WEBHOOK_SECRET: "server-only-secret",
		CHECKOUT_SNAPSHOT_MODE: "handle-v2",
		CHECKOUT_CATALOG_PROVIDER: "convex" as string | undefined,
		CATALOG_COMMERCE_CHECKOUT_RESOLVER_SECRET: "checkout-only-secret",
	},
	publicEnv: { PUBLIC_CONVEX_SITE_URL: "https://production.convex.site" },
}));

vi.mock("$env/dynamic/private", () => ({ env: mocks.env }));
vi.mock("$env/dynamic/public", () => ({ env: mocks.publicEnv }));
vi.mock("$lib/server/siteAdminAuthorization", () => ({
	verifySiteAdminRequest: mocks.verify,
}));
vi.mock("$lib/sanity/client", () => ({ client: { fetch: mocks.sanityFetch } }));
vi.mock("$lib/server/catalogCommerceClients", () => ({
	resolveCatalogCheckout: mocks.resolveCatalogCheckout,
}));
vi.mock("$lib/server/checkoutCommerce", () => ({
	parseCheckoutCatalogProvider: (value: unknown) =>
		value === "sanity" || value === "shadow" || value === "convex" ? value : "sanity",
	resolveCheckoutCommerce: mocks.resolve,
}));

import { r4ReadPurposes, r4ReadSignatureMessage } from "$lib/server/r4ReadAuthorization";
import { POST } from "./+server";

const authorizationBody = { authorization: "r4_checkout_catalog_sentinel_v1" };
const endpoint = "https://example.test/api/admin/commerce/catalog-sentinel";
const fixedSelection = {
	productId: "raw-nerve-1",
	isPrintSet: false,
	paperSlug: "archival-matte",
	sizeSlug: "4x6",
};
const item = {
	productId: "private-product-id",
	title: "Raw Nerve 1",
	unitPriceCents: 4200,
	productCategory: "prints",
	publicImage: "https://media.example/private-image.webp",
	legacyFulfillment: {
		isDigital: false,
		isPrintSet: false,
		paper: { name: "Archival Matte", subcategoryId: 1, width: 4, height: 6 },
		imageUrls: [],
	},
};

function request(body: unknown = authorizationBody, headers: Record<string, string> = {}) {
	return new Request(endpoint, {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

function resetResolutions(
	active = { provider: "convex", items: [item] },
	sanity = { provider: "sanity", items: [item] },
	convex = { provider: "convex", items: [item] },
) {
	mocks.resolve
		.mockReset()
		.mockResolvedValueOnce(active)
		.mockResolvedValueOnce(sanity)
		.mockResolvedValueOnce(convex);
}

afterEach(() => {
	vi.useRealTimers();
});

describe("deployed Checkout catalog sentinel", () => {
	beforeEach(() => {
		mocks.verify.mockReset().mockResolvedValue(true);
		mocks.env.CHECKOUT_CATALOG_PROVIDER = "convex";
		mocks.resolveCatalogCheckout.mockReset().mockResolvedValue({ version: 1 });
		mocks.sanityFetch.mockReset();
		resetResolutions();
	});

	it("requires membership or the fixed-purpose machine signature before any catalog read", async () => {
		mocks.verify.mockResolvedValue(false);
		await expect(POST({ request: request() })).rejects.toMatchObject({ status: 401 });
		expect(mocks.resolve).not.toHaveBeenCalled();
		expect(mocks.sanityFetch).not.toHaveBeenCalled();

		const rawBody = JSON.stringify(authorizationBody);
		const timestamp = String(Math.floor(Date.now() / 1_000));
		const unsigned = request();
		const signature = createHmac("sha256", mocks.env.WEBHOOK_SECRET)
			.update(
				r4ReadSignatureMessage(
					unsigned,
					r4ReadPurposes.checkoutCatalogSentinel,
					rawBody,
					timestamp,
				),
			)
			.digest("hex");
		const response = await POST({
			request: request(authorizationBody, {
				"x-r4-timestamp": timestamp,
				"x-r4-signature": signature,
			}),
		});
		expect(response.status).toBe(200);
	});

	it("uses only the audit-bound fixed selection and exact authorization body", async () => {
		await POST({ request: request() });
		expect(mocks.resolve).toHaveBeenCalledTimes(3);
		for (const call of mocks.resolve.mock.calls) expect(call[1]).toEqual([fixedSelection]);

		resetResolutions();
		await expect(
			POST({
				request: request({
					...authorizationBody,
					x: 1,
				}),
			}),
		).rejects.toMatchObject({ status: 400 });
		expect(mocks.resolve).not.toHaveBeenCalled();
	});

	it("returns only normalized active, binding, mode, and title-inclusive parity classes", async () => {
		const response = await POST({ request: request() });
		const text = await response.text();
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(JSON.parse(text)).toEqual({
			version: 1,
			checkoutCatalogProvider: "convex",
			checkoutCatalogConfiguration: "exact",
			activeResolutionProvider: "convex",
			activeProviderBinding: "exact",
			forcedProviderBinding: "exact",
			checkoutSnapshotMode: "handle-v2",
			parity: "match",
			resolution: "resolved",
		});
		for (const forbidden of [
			"raw-nerve-1",
			"private-product-id",
			"Raw Nerve 1",
			"4200",
			"private-image",
			"checkout-only-secret",
		]) {
			expect(text).not.toContain(forbidden);
		}
	});

	it("distinguishes absent and invalid provider configuration from explicit Sanity", async () => {
		mocks.env.CHECKOUT_CATALOG_PROVIDER = undefined;
		resetResolutions(
			{ provider: "sanity", items: [item] },
			{ provider: "sanity", items: [item] },
			{ provider: "convex", items: [item] },
		);
		await expect((await POST({ request: request() })).json()).resolves.toMatchObject({
			checkoutCatalogProvider: "sanity",
			checkoutCatalogConfiguration: "absent",
		});

		mocks.env.CHECKOUT_CATALOG_PROVIDER = "invalid";
		resetResolutions(
			{ provider: "sanity", items: [item] },
			{ provider: "sanity", items: [item] },
			{ provider: "convex", items: [item] },
		);
		await expect((await POST({ request: request() })).json()).resolves.toMatchObject({
			checkoutCatalogProvider: "sanity",
			checkoutCatalogConfiguration: "invalid",
		});
	});

	it("binds the active result to its named forced provider and compares titles", async () => {
		resetResolutions(
			{ provider: "convex", items: [{ ...item, title: "Drifted active title" }] },
			{ provider: "sanity", items: [item] },
			{ provider: "convex", items: [item] },
		);
		await expect((await POST({ request: request() })).json()).resolves.toMatchObject({
			activeProviderBinding: "mismatch",
			parity: "mismatch",
		});

		resetResolutions(
			{ provider: "convex", items: [{ ...item, title: "Convex title" }] },
			{ provider: "sanity", items: [item] },
			{ provider: "convex", items: [{ ...item, title: "Convex title" }] },
		);
		await expect((await POST({ request: request() })).json()).resolves.toMatchObject({
			activeProviderBinding: "exact",
			parity: "mismatch",
		});

		resetResolutions(
			{ provider: "sanity", items: [item] },
			{ provider: "sanity", items: [item] },
			{ provider: "convex", items: [item] },
		);
		await expect((await POST({ request: request() })).json()).resolves.toMatchObject({
			checkoutCatalogProvider: "convex",
			activeResolutionProvider: "sanity",
			activeProviderBinding: "mismatch",
			parity: "mismatch",
		});
	});

	it("uses the public Convex site and checkout-only resolver secret only for the forced diagnostic", async () => {
		await POST({ request: request() });
		const forcedDependencies = mocks.resolve.mock.calls[2]?.[2] as {
			provider: () => unknown;
			resolve: (snapshot: unknown, signal: AbortSignal) => Promise<unknown>;
		};
		expect(forcedDependencies.provider()).toBe("convex");
		const signal = new AbortController().signal;
		const snapshot = { productKey: "private" };
		await forcedDependencies.resolve(snapshot, signal);
		expect(mocks.resolveCatalogCheckout).toHaveBeenCalledWith(snapshot, {
			origin: "https://production.convex.site",
			bearer: "checkout-only-secret",
			signal,
		});
	});

	it("suppresses resolver errors and never returns raw fragments", async () => {
		mocks.resolve.mockReset().mockRejectedValue(new Error("raw token private-product-id"));
		await expect(POST({ request: request() })).rejects.toMatchObject({
			status: 503,
			body: { message: "Catalog sentinel unavailable" },
		});
	});

	it("aborts the shared Sanity signal and returns normalized 503 at the hard deadline", async () => {
		vi.useFakeTimers();
		let signal: AbortSignal | undefined;
		const pending = new Promise<never>(() => undefined);
		mocks.sanityFetch.mockImplementation(
			(_query: string, _params: Record<string, unknown>, options: { signal: AbortSignal }) => {
				signal = options.signal;
				return pending;
			},
		);
		mocks.resolve.mockReset().mockImplementation((fetcher) => fetcher("query", {}));
		const result = POST({ request: request() });
		const rejection = expect(result).rejects.toMatchObject({
			status: 503,
			body: { message: "Catalog sentinel unavailable" },
		});
		await vi.advanceTimersByTimeAsync(6_000);
		await rejection;
		expect(signal?.aborted).toBe(true);
	});
});
