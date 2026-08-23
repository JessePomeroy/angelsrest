import { describe, expect, test, vi } from "vitest";
import {
	fetchPublishedSanityBlogReconciliationSource,
	sanityBlogReconciliationSourceQuery,
} from "./sanityBlogReconciliationSource";

describe("Sanity Blog reconciliation source", () => {
	test("pins every document revision while retaining unexpected fields", () => {
		const query = sanityBlogReconciliationSourceQuery();
		expect(query.match(/\.\.\.,/g)).toHaveLength(3);
		expect(query.match(/\b_rev,/g)).toHaveLength(3);
		expect(query).toMatch(/\*\[_type == "author"\] \| order\(_id asc\)/);
		expect(query).toMatch(/\*\[_type == "category"\] \| order\(_id asc\)/);
		expect(query).toMatch(/\*\[_type == "post"\] \| order\(_id asc\)/);
	});

	test("forces one published-perspective read", async () => {
		const result = { authors: [], categories: [], posts: [] };
		const client = { fetch: vi.fn(async () => result) };
		await expect(fetchPublishedSanityBlogReconciliationSource(client as never)).resolves.toBe(
			result,
		);
		expect(client.fetch).toHaveBeenCalledWith(
			sanityBlogReconciliationSourceQuery(),
			{},
			{ perspective: "published" },
		);
	});
});
