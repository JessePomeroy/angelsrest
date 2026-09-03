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

	it("preserves source URLs byte-exact", async () => {
		const { composeBorderedPrint } = await import("../sharpBorder");
		const opaque = "https://opaque.example/source.jpg?sealed=a_b-C#exact";
		await composeBorderedPrint(opaque, 0.25);
		const second = "https://cdn.example/source.jpg?w=100";
		await composeBorderedPrint(second, 0.25);
		expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([opaque, second]);
	});

	it("keys cross-tenant same-number outputs by exact session and redacts failures", async () => {
		const { composeBorderedPrint, uploadBorderedPrintToR2 } = await import("../sharpBorder");
		process.env.GALLERY_WORKER_URL = "https://worker.example";
		process.env.GALLERY_WORKER_TOKEN = "worker-secret";
		const firstSession = "cs_test_tenantAglobal1234";
		const sessions = [firstSession, "cs_live_tenantBglobal1234"];
		const urls = await Promise.all(
			sessions.map((id) => uploadBorderedPrintToR2(Buffer.from("image"), id, 0)),
		);
		expect(urls).toEqual(
			sessions.map((id) => `https://worker.example/image/prints/bordered/${id}/0.jpg`),
		);
		expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(
			sessions.map(
				(id) => `https://worker.example/upload/put?key=prints%2Fbordered%2F${id}%2F0.jpg`,
			),
		);
		await expect(uploadBorderedPrintToR2(Buffer.from("image"), "ORD-SAME", 0)).rejects.toThrow(
			"Invalid bordered print storage identity",
		);

		vi.mocked(fetch).mockResolvedValueOnce(new Response("secret body", { status: 404 }));
		await expect(composeBorderedPrint("https://opaque.example/?secret=1", 0.25)).rejects.toThrow(
			"Border source rejected (404)",
		);
		vi.mocked(fetch).mockResolvedValueOnce(new Response("raw private response", { status: 500 }));
		await expect(uploadBorderedPrintToR2(Buffer.from("image"), firstSession, 0)).rejects.toThrow(
			"Border output rejected (500)",
		);
	});
});
