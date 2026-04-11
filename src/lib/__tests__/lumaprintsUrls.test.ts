import { describe, expect, it } from "vitest";
import { prepareSanityUrlForPrint } from "../shop/lumaprintsUrls";

describe("prepareSanityUrlForPrint", () => {
	it("appends ?max=8000&q=100 to a clean Sanity URL", () => {
		const url = "https://cdn.sanity.io/images/proj/dataset/photo.jpg";
		expect(prepareSanityUrlForPrint(url)).toBe(
			"https://cdn.sanity.io/images/proj/dataset/photo.jpg?max=8000&q=100",
		);
	});

	it("strips existing query params before appending the print params", () => {
		const url =
			"https://cdn.sanity.io/images/proj/dataset/photo.jpg?w=1200&fm=webp&q=80";
		expect(prepareSanityUrlForPrint(url)).toBe(
			"https://cdn.sanity.io/images/proj/dataset/photo.jpg?max=8000&q=100",
		);
	});

	it("strips a single query param", () => {
		const url = "https://cdn.sanity.io/images/proj/dataset/photo.jpg?w=1200";
		expect(prepareSanityUrlForPrint(url)).toBe(
			"https://cdn.sanity.io/images/proj/dataset/photo.jpg?max=8000&q=100",
		);
	});

	it("is idempotent — applying twice gives the same result", () => {
		const url = "https://cdn.sanity.io/images/proj/dataset/photo.jpg";
		const once = prepareSanityUrlForPrint(url);
		const twice = prepareSanityUrlForPrint(once);
		expect(twice).toBe(once);
	});

	it("strips fragment identifiers in addition to query params", () => {
		const url =
			"https://cdn.sanity.io/images/proj/dataset/photo.jpg?w=1200#fragment";
		expect(prepareSanityUrlForPrint(url)).toBe(
			"https://cdn.sanity.io/images/proj/dataset/photo.jpg?max=8000&q=100",
		);
	});

	it("handles URLs with paths and dashes in the asset ID", () => {
		const url =
			"https://cdn.sanity.io/images/n7rvza4g/production/35e53b93f1276371b416953929a8efafe17dd786-5152x7728.jpg";
		expect(prepareSanityUrlForPrint(url)).toBe(
			"https://cdn.sanity.io/images/n7rvza4g/production/35e53b93f1276371b416953929a8efafe17dd786-5152x7728.jpg?max=8000&q=100",
		);
	});

	it("preserves the URL path exactly (no encoding shifts)", () => {
		const url =
			"https://cdn.sanity.io/images/n7rvza4g/production/40e97f0fd2f6d616b78c461fbc93a702fde58d87-5012x7518.jpg?q=95";
		const result = prepareSanityUrlForPrint(url);
		expect(result).toBe(
			"https://cdn.sanity.io/images/n7rvza4g/production/40e97f0fd2f6d616b78c461fbc93a702fde58d87-5012x7518.jpg?max=8000&q=100",
		);
		// Sanity-asset-ID dimensions in the filename are preserved
		expect(result).toContain("5012x7518");
	});

	it("works on non-Sanity URLs by passing through with the same transformation", () => {
		// Non-Sanity URLs are not the intended use case, but the function
		// should still produce a sensible result rather than throwing.
		const url = "https://example.com/photo.jpg?token=abc";
		expect(prepareSanityUrlForPrint(url)).toBe(
			"https://example.com/photo.jpg?max=8000&q=100",
		);
	});
});
