import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toBuffer = vi.fn(async () => Buffer.from("bordered"));
vi.mock("sharp", () => ({
	default: () => ({ extend: () => ({ jpeg: () => ({ toBuffer }) }) }),
}));

describe("sharp border source policy", () => {
	beforeEach(() => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("image")),
		);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		delete process.env.GALLERY_WORKER_URL;
		delete process.env.GALLERY_WORKER_TOKEN;
	});

	it("preserves opaque capabilities byte-exact and rewrites only explicit Sanity sources", async () => {
		const { composeBorderedPrint } = await import("../sharpBorder");
		const opaque = "https://opaque.example/source.jpg?sealed=a_b-C#exact";
		await composeBorderedPrint(opaque, 0.25, "opaque_capability");
		await composeBorderedPrint(
			"https://cdn.sanity.io/images/project/data/source.jpg?w=100",
			0.25,
			"sanity_cdn",
		);
		expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
			opaque,
			"https://cdn.sanity.io/images/project/data/source.jpg?max=8000&q=100",
		]);
	});

	it("redacts source URLs and raw Worker response bodies from failures", async () => {
		const { composeBorderedPrint, uploadBorderedPrintToR2 } = await import("../sharpBorder");
		vi.mocked(fetch).mockResolvedValueOnce(new Response("secret body", { status: 404 }));
		await expect(
			composeBorderedPrint("https://opaque.example/?secret=1", 0.25, "opaque_capability"),
		).rejects.toThrow("Border source rejected (404)");
		process.env.GALLERY_WORKER_URL = "https://worker.example";
		process.env.GALLERY_WORKER_TOKEN = "worker-secret";
		vi.mocked(fetch).mockResolvedValueOnce(new Response("raw private response", { status: 500 }));
		await expect(uploadBorderedPrintToR2(Buffer.from("image"), "order", 0)).rejects.toThrow(
			"Border output rejected (500)",
		);
	});
});
