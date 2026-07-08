import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	convexQuery: vi.fn(),
}));

vi.mock("$lib/server/convexClient", () => ({
	getConvex: () => ({ query: mocks.convexQuery }),
}));

vi.mock("$convex/api", () => ({
	api: {
		orders: { lookup: "orders.lookup" },
	},
}));

vi.mock("$lib/config/site", () => ({
	SITE_DOMAIN: "angelsrest.online",
}));

import * as endpointModule from "../+server";
import { fallback, POST } from "../+server";

type RenderEndpoint = (
	event: never,
	eventState: never,
	mod: typeof endpointModule,
	state: never,
) => Promise<Response>;

const svelteKitEndpointRuntimeUrl = new URL(
	"../../../../../../node_modules/@sveltejs/kit/src/runtime/server/endpoint.js",
	import.meta.url,
);

function postRequest(body: unknown) {
	return {
		request: new Request("https://angelsrest.test/api/orders/lookup", {
			method: "POST",
			body: JSON.stringify(body),
		}),
	};
}

async function renderLookupEndpoint(method: string, body?: unknown) {
	const { render_endpoint } = (await import(svelteKitEndpointRuntimeUrl.href)) as {
		render_endpoint: RenderEndpoint;
	};
	const request = new Request("https://angelsrest.test/api/orders/lookup", {
		method,
		...(body === undefined
			? {}
			: {
					body: JSON.stringify(body),
					headers: { "Content-Type": "application/json" },
				}),
	});
	return render_endpoint(
		{
			request,
			url: new URL(request.url),
			route: { id: "/api/orders/lookup" },
		} as never,
		{} as never,
		endpointModule,
		{ depth: 0, prerender_default: false } as never,
	);
}

describe("order lookup API", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects non-POST lookups so email is not accepted in URLs", async () => {
		const response = fallback();

		await expect(response.json()).resolves.toEqual({ error: "Use POST to look up orders" });
		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("POST");
		expect(mocks.convexQuery).not.toHaveBeenCalled();
	});

	it("routes unsupported methods through SvelteKit endpoint fallback", async () => {
		for (const method of ["GET", "HEAD"]) {
			const response = await renderLookupEndpoint(method);

			expect(response.status).toBe(405);
			expect(response.headers.get("allow")).toBe("POST");
			if (method === "GET") {
				await expect(response.json()).resolves.toEqual({ error: "Use POST to look up orders" });
			}
		}
		expect(mocks.convexQuery).not.toHaveBeenCalled();
	});

	it("routes POST through SvelteKit endpoint dispatch", async () => {
		mocks.convexQuery.mockResolvedValue({
			orderNumber: "ORD-002",
			status: "processing",
		});

		const response = await renderLookupEndpoint("POST", {
			email: "buyer@example.com",
			orderNumber: "ORD-002",
		});

		await expect(response.json()).resolves.toEqual({
			order: { orderNumber: "ORD-002", status: "processing" },
		});
		expect(response.status).toBe(200);
		expect(mocks.convexQuery).toHaveBeenCalledWith("orders.lookup", {
			siteUrl: "angelsrest.online",
			email: "buyer@example.com",
			orderNumber: "ORD-002",
		});
	});

	it("looks up orders from POST body email and order number", async () => {
		mocks.convexQuery.mockResolvedValue({
			orderNumber: "ORD-001",
			status: "shipped",
		});

		const response = await POST(
			postRequest({ email: "buyer@example.com", orderNumber: "ORD-001" }) as never,
		);

		await expect(response.json()).resolves.toEqual({
			order: { orderNumber: "ORD-001", status: "shipped" },
		});
		expect(response.status).toBe(200);
		expect(mocks.convexQuery).toHaveBeenCalledWith("orders.lookup", {
			siteUrl: "angelsrest.online",
			email: "buyer@example.com",
			orderNumber: "ORD-001",
		});
	});

	it("rejects malformed POST bodies before querying Convex", async () => {
		const response = await POST(
			postRequest({ email: "not-an-email", orderNumber: "ORD-001" }) as never,
		);

		await expect(response.json()).resolves.toEqual({ error: "Invalid email" });
		expect(response.status).toBe(400);
		expect(mocks.convexQuery).not.toHaveBeenCalled();
	});
});
