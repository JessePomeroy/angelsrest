import type { SanityClient } from "@sanity/client";
import { describe, expect, test, vi } from "vitest";
import { fetchPublishedSanityCatalogSource, sanityCatalogSourceQuery } from "./sanityCatalogSource";

describe("Sanity catalog source projection", () => {
	test("projects every current catalog family and the exact private-file metadata boundary", () => {
		const query = sanityCatalogSourceQuery();

		expect(query).toContain('*[_type == "lumaProductV2"]');
		expect(query).toContain('*[_type == "lumaPrintSetV2"]');
		expect(query).toContain('*[_type == "product"]');
		expect(query).toContain('*[_type == "printCollection"]');
		expect(query).toContain('*[_type == "coupon"]');
		expect(query).toContain('"digitalFileRef": digitalFile.asset._ref');
		expect(query).toContain('"digitalFileAsset": digitalFile.asset->{');
		expect(query).toContain("originalFilename");
		expect(query).toContain("mimeType");
		expect(query).toContain("size");
		expect(query).not.toContain("asset->url");
	});

	test("uses the published perspective", async () => {
		const source = { prints: [], sets: [], general: [], collections: [], coupons: [] };
		const fetch = vi.fn().mockResolvedValue(source);
		const client = { fetch } as unknown as SanityClient;

		await expect(fetchPublishedSanityCatalogSource(client)).resolves.toBe(source);
		expect(fetch).toHaveBeenCalledWith(
			sanityCatalogSourceQuery(),
			{},
			{ perspective: "published" },
		);
	});
});
