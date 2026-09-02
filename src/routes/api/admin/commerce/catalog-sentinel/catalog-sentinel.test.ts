import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	verify: vi.fn(),
	resolveCurrent: vi.fn(),
	resolveParity: vi.fn(),
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
vi.mock("$lib/server/currentCheckoutCommerce", () => ({
	resolveCurrentCheckoutCommerce: mocks.resolveCurrent,
}));
vi.mock("$lib/server/checkoutCommerce", () => ({
	parseCheckoutCatalogProvider: (value: unknown) =>
		value === "sanity" || value === "shadow" || value === "convex" ? value : "sanity",
	resolveCheckoutCommerce: mocks.resolveParity,
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

function resetDiagnostics(
	sanity = { provider: "sanity", items: [item] },
	convex = { provider: "convex", items: [item] },
) {
	mocks.resolveParity.mockReset().mockResolvedValueOnce(sanity).mockResolvedValueOnce(convex);
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
		mocks.resolveCurrent.mockReset().mockResolvedValue({ provider: "convex", items: [item] });
		resetDiagnostics();
	});

	it("requires membership or the fixed-purpose machine signature before any catalog read", async () => {
		mocks.verify.mockResolvedValue(false);
		await expect(POST({ request: request() })).rejects.toMatchObject({ status: 401 });
		expect(mocks.resolveCurrent).not.toHaveBeenCalled();
		expect(mocks.resolveParity).not.toHaveBeenCalled();

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
		expect(mocks.resolveCurrent).toHaveBeenCalledWith([fixedSelection], expect.any(Object));
		expect(mocks.resolveParity).toHaveBeenCalledTimes(2);
		for (const call of mocks.resolveParity.mock.calls) expect(call[1]).toEqual([fixedSelection]);

		mocks.resolveCurrent.mockClear();
		mocks.resolveParity.mockClear();
		await expect(POST({ request: request({ ...authorizationBody, x: 1 }) })).rejects.toMatchObject({
			status: 400,
		});
		expect(mocks.resolveCurrent).not.toHaveBeenCalled();
		expect(mocks.resolveParity).not.toHaveBeenCalled();
	});

	it("reports fixed Convex current authority and nests retired provider diagnostics", async () => {
		const response = await POST({ request: request() });
		const text = await response.text();
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(JSON.parse(text)).toEqual({
			version: 2,
			outcome: "healthy",
			currentCheckout: {
				catalogProvider: "convex",
				snapshotProtocol: "handle-v2",
				resolution: "resolved",
			},
			diagnostics: {
				legacyProviderConfiguration: {
					provider: "convex",
					configuration: "exact",
				},
				tenantBridgeAndIntakeSnapshotMode: "handle-v2",
				forcedProviderBinding: "exact",
				legacySanityConvexParity: "match",
				resolution: "resolved",
			},
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

	it("keeps retired provider flags diagnostic and unable to steer current authority", async () => {
		for (const [value, provider, configuration] of [
			["sanity", "sanity", "exact"],
			["shadow", "shadow", "exact"],
			[undefined, "sanity", "absent"],
			["invalid", "sanity", "invalid"],
		] as const) {
			mocks.env.CHECKOUT_CATALOG_PROVIDER = value;
			resetDiagnostics();
			const response = await POST({ request: request() });
			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toMatchObject({
				outcome: "healthy",
				currentCheckout: { catalogProvider: "convex", snapshotProtocol: "handle-v2" },
				diagnostics: {
					legacyProviderConfiguration: { provider, configuration },
				},
			});
		}
	});

	it("keeps Sanity mismatch or outage diagnostic without failing current checkout health", async () => {
		resetDiagnostics(
			{ provider: "sanity", items: [{ ...item, title: "Sanity drift" }] },
			{ provider: "convex", items: [item] },
		);
		await expect((await POST({ request: request() })).json()).resolves.toMatchObject({
			outcome: "healthy",
			diagnostics: { legacySanityConvexParity: "mismatch" },
		});

		mocks.resolveParity
			.mockReset()
			.mockRejectedValueOnce(new Error("raw token private-product-id"))
			.mockResolvedValueOnce({ provider: "convex", items: [item] });
		const unavailable = await POST({ request: request() });
		const text = await unavailable.text();
		expect(unavailable.status).toBe(200);
		expect(JSON.parse(text)).toMatchObject({
			outcome: "healthy",
			diagnostics: {
				forcedProviderBinding: "unavailable",
				legacySanityConvexParity: "unavailable",
				resolution: "unavailable",
			},
		});
		expect(text).not.toMatch(/raw token|private-product-id/);
	});

	it("returns a sanitized 503 only when current Convex checkout authority is unavailable", async () => {
		mocks.resolveCurrent.mockRejectedValueOnce(new Error("raw token private-product-id"));
		const response = await POST({ request: request() });
		const text = await response.text();
		expect(response.status).toBe(503);
		expect(JSON.parse(text)).toMatchObject({
			outcome: "unavailable",
			currentCheckout: {
				catalogProvider: "convex",
				snapshotProtocol: "handle-v2",
				resolution: "unavailable",
			},
		});
		expect(text).not.toMatch(/raw token|private-product-id/);
	});

	it("uses the checkout-only resolver secret for current and forced Convex diagnostics", async () => {
		await POST({ request: request() });
		const currentDependencies = mocks.resolveCurrent.mock.calls[0]?.[1] as {
			resolve: (snapshot: unknown, signal: AbortSignal) => Promise<unknown>;
		};
		const forcedDependencies = mocks.resolveParity.mock.calls[1]?.[2] as {
			provider: () => unknown;
			resolve: (snapshot: unknown, signal: AbortSignal) => Promise<unknown>;
		};
		expect(forcedDependencies.provider()).toBe("convex");
		const signal = new AbortController().signal;
		const snapshot = { productKey: "private" };
		await currentDependencies.resolve(snapshot, signal);
		await forcedDependencies.resolve(snapshot, signal);
		expect(mocks.resolveCatalogCheckout).toHaveBeenCalledTimes(2);
		for (const call of mocks.resolveCatalogCheckout.mock.calls) {
			expect(call).toEqual([
				snapshot,
				{
					origin: "https://production.convex.site",
					bearer: "checkout-only-secret",
					signal,
				},
			]);
		}
	});

	it("bounds a stalled legacy diagnostic and aborts it without delaying authority indefinitely", async () => {
		vi.useFakeTimers();
		let signal: AbortSignal | undefined;
		const pending = new Promise<never>(() => undefined);
		mocks.sanityFetch.mockImplementation(
			(_query: string, _params: Record<string, unknown>, options: { signal: AbortSignal }) => {
				signal = options.signal;
				return pending;
			},
		);
		mocks.resolveParity
			.mockReset()
			.mockImplementationOnce((fetcher) => fetcher("query", {}))
			.mockResolvedValueOnce({ provider: "convex", items: [item] });
		const result = POST({ request: request() });
		await vi.advanceTimersByTimeAsync(750);
		const response = await result;
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			outcome: "healthy",
			diagnostics: { resolution: "unavailable" },
		});
		expect(signal?.aborted).toBe(true);
	});
});
