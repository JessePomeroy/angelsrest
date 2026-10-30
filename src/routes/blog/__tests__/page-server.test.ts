import { beforeEach, describe, expect, it, vi } from "vitest";

const loadIndex = vi.hoisted(() => vi.fn());
vi.mock("$lib/server/current/blogContent.server", () => ({ blogContent: { loadIndex } }));

import { load } from "../+page.server";

beforeEach(() => vi.clearAllMocks());

describe("Blog page requests", () => {
	it.each([
		["", 1],
		["?page=2", 2],
		["?page=12", 12],
	])("loads %s as page %s", async (query, pageNumber) => {
		loadIndex.mockResolvedValue({ posts: [], pageNumber, totalCount: 0, hasNext: false });
		await load({ url: new URL(`https://example.test/blog${query}`) });
		expect(loadIndex).toHaveBeenCalledWith(pageNumber);
	});

	it.each([
		"?page=0",
		"?page=-1",
		"?page=1.5",
		"?page=",
		"?page=01",
		"?page=2&page=3",
		"?page=no",
	])("rejects malformed page %s", async (query) => {
		await expect(
			Promise.resolve().then(() => load({ url: new URL(`https://example.test/blog${query}`) })),
		).rejects.toMatchObject({ status: 404 });
		expect(loadIndex).not.toHaveBeenCalled();
	});
});
