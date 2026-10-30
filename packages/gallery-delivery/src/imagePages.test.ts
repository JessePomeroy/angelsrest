import { expect, test } from "vitest";
import { iterateGalleryImagePages, mergeGalleryImagePages } from "./imagePages";
test("reads a manifest beyond 2,000 rows without a silent cap", async () => {
 const files: number[] = [];
 for await (const result of iterateGalleryImagePages(async cursor => { const start = Number(cursor ?? 0); const end = Math.min(start + 48, 2101); return { page: Array.from({length: end-start}, (_, i) => start+i), isDone: end === 2101, continueCursor: String(end) }; })) files.push(...result.page);
 expect(files).toHaveLength(2101); expect(files.at(-1)).toBe(2100);
});
test("rejects a repeated cursor and supports cancellation", async () => {
 const read = async () => ({ page: [], isDone: false, continueCursor: "same" });
 await expect(async () => { for await (const _ of iterateGalleryImagePages(read)) {} }).rejects.toThrow("did not advance");
 const controller = new AbortController(); controller.abort();
 await expect(async () => { for await (const _ of iterateGalleryImagePages(read, controller.signal)) {} }).rejects.toThrow();
});
test("merges pages by identity and replaces refreshed rows", () => {
 expect(mergeGalleryImagePages([{ id: "a", favorite: false }], [{ id: "a", favorite: true }, { id: "b", favorite: false }], row => row.id)).toEqual([{ id: "a", favorite: true }, { id: "b", favorite: false }]);
});
