import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const freshPublishedClient = { fetch: vi.fn() };
	const publicCdnClient = {
		fetch: vi.fn(),
		withConfig: vi.fn(() => freshPublishedClient),
	};
	return {
		createClient: vi.fn(),
		freshPublishedClient,
		publicCdnClient,
	};
});

vi.mock("@sanity/client", () => ({ createClient: mocks.createClient }));
vi.mock("$env/dynamic/private", () => ({ env: {} }));
vi.mock("$env/dynamic/public", () => ({
	env: {
		PUBLIC_SANITY_DATASET: "production",
		PUBLIC_SANITY_PROJECT_ID: "project",
	},
}));
vi.mock("./client", () => ({ client: mocks.publicCdnClient }));

import { getFreshPublishedSanityClient, getSanityClient } from "./client.server";

describe("server-only Sanity client selection", () => {
	it("keeps normal loads on the CDN client and isolates the fresh diagnostic client", () => {
		expect(getSanityClient(false)).toBe(mocks.publicCdnClient);
		expect(getSanityClient(true)).toBe(mocks.publicCdnClient);
		expect(mocks.publicCdnClient.withConfig).not.toHaveBeenCalled();
		expect(mocks.createClient).not.toHaveBeenCalled();

		expect(getFreshPublishedSanityClient()).toBe(mocks.freshPublishedClient);
		expect(getFreshPublishedSanityClient()).toBe(mocks.freshPublishedClient);
		expect(mocks.publicCdnClient.withConfig).toHaveBeenCalledOnce();
		expect(mocks.publicCdnClient.withConfig).toHaveBeenCalledWith({
			useCdn: false,
			perspective: "published",
		});
	});
});
